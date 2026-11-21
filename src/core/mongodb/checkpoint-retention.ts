/**
 * Retention for LangGraph checkpoints stored in MongoDB.
 *
 * A run reads only the latest checkpoint of its thread (per namespace), so
 * every older checkpoint and its pending writes are history nothing reads.
 * They are deleted once older than `minAgeHours`. With `idleThreadDays`, a
 * thread with no new checkpoint for that long loses all of its checkpoints,
 * except the threads `protectedThreadIds` returns.
 */
export interface CheckpointRetentionOptions {
  /** Checkpoints younger than this are never deleted. Default 24. */
  minAgeHours?: number;
  /** Delete every checkpoint of a thread silent for this many days. Off when unset. */
  idleThreadDays?: number;
  /** Threads exempt from `idleThreadDays`, read once per run. */
  protectedThreadIds?: () => Promise<Iterable<string>>;
  /** How often UniversalGraphModule runs the retention. Default 360. */
  intervalMinutes?: number;
}

export interface CheckpointRetentionResult {
  checkpoints: number;
  writes: number;
  idleThreads: number;
}

interface CheckpointRef {
  _id: { getTimestamp(): Date };
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
}

/**
 * The part of a MongoDB `Db` the retention uses. Structural, so a `Db` from
 * any driver version fits; `_id`s are only read back from the documents.
 */
export interface RetentionCollection {
  find(
    filter: object,
    options: {
      projection: Record<string, 1>;
      sort?: Record<string, 1 | -1>;
    }
  ): AsyncIterable<CheckpointRef>;
  deleteMany(filter: object): Promise<{ deletedCount?: number }>;
}

export interface RetentionDb {
  collection(name: string): RetentionCollection;
}

export interface PruneCheckpointsParams extends CheckpointRetentionOptions {
  checkpointCollectionName?: string;
  checkpointWritesCollectionName?: string;
  now?: Date;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const BATCH_SIZE = 500;
const BATCH_PAUSE_MS = 300;
const KEY_PROJECTION = {
  thread_id: 1,
  checkpoint_ns: 1,
  checkpoint_id: 1,
} as const;

const keyOf = (doc: CheckpointRef) =>
  `${doc.thread_id}|${doc.checkpoint_ns}|${doc.checkpoint_id}`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Deletes by `filter(chunk)` in batches, pausing between them to spare the cluster. */
class BatchDeleter<T> {
  private batch: T[] = [];
  deleted = 0;

  constructor(
    private readonly collection: RetentionCollection,
    private readonly filter: (chunk: T[]) => object
  ) {}

  async add(item: T): Promise<void> {
    this.batch.push(item);
    if (this.batch.length >= BATCH_SIZE) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    const { deletedCount } = await this.collection.deleteMany(
      this.filter(this.batch)
    );
    this.deleted += deletedCount ?? 0;
    this.batch = [];
    await sleep(BATCH_PAUSE_MS);
  }
}

export async function pruneCheckpoints(
  db: RetentionDb,
  params: PruneCheckpointsParams = {}
): Promise<CheckpointRetentionResult> {
  const now = (params.now ?? new Date()).getTime();
  const oldBefore = now - (params.minAgeHours ?? 24) * HOUR_MS;
  const idleBefore =
    params.idleThreadDays === undefined
      ? undefined
      : now - params.idleThreadDays * DAY_MS;
  const createdAt = (doc: CheckpointRef) => doc._id.getTimestamp().getTime();

  const checkpoints = db.collection(
    params.checkpointCollectionName ?? "checkpoints"
  );
  const writes = db.collection(
    params.checkpointWritesCollectionName ?? "checkpoint_writes"
  );
  const byId = (ids: CheckpointRef["_id"][]) => ({ _id: { $in: ids } });

  // Sorted the way the saver reads: the first document of a group is the latest.
  const latest = new Set<string>();
  const lastActivity = new Map<string, number>();
  const olderCheckpoints = new BatchDeleter(checkpoints, byId);
  let group = "";
  const sorted = checkpoints.find(
    {},
    {
      projection: KEY_PROJECTION,
      sort: { thread_id: 1, checkpoint_ns: 1, checkpoint_id: -1 },
    }
  );
  for await (const doc of sorted) {
    const docGroup = `${doc.thread_id}|${doc.checkpoint_ns}`;
    if (docGroup !== group) {
      group = docGroup;
      latest.add(keyOf(doc));
      lastActivity.set(
        doc.thread_id,
        Math.max(createdAt(doc), lastActivity.get(doc.thread_id) ?? 0)
      );
      continue;
    }
    if (createdAt(doc) < oldBefore) await olderCheckpoints.add(doc._id);
  }
  await olderCheckpoints.flush();

  const idle = new Set<string>();
  if (idleBefore !== undefined) {
    const kept = new Set(await params.protectedThreadIds?.());
    for (const [threadId, at] of lastActivity) {
      if (at < idleBefore && !kept.has(threadId)) idle.add(threadId);
    }
  }
  const idleCheckpoints = new BatchDeleter(
    checkpoints,
    (threadIds: string[]) => ({
      thread_id: { $in: threadIds },
    })
  );
  for (const threadId of idle) await idleCheckpoints.add(threadId);
  await idleCheckpoints.flush();

  const staleWrites = new BatchDeleter(writes, byId);
  for await (const doc of writes.find({}, { projection: KEY_PROJECTION })) {
    if (createdAt(doc) >= oldBefore) continue;
    if (idle.has(doc.thread_id) || !latest.has(keyOf(doc))) {
      await staleWrites.add(doc._id);
    }
  }
  await staleWrites.flush();

  return {
    checkpoints: olderCheckpoints.deleted + idleCheckpoints.deleted,
    writes: staleWrites.deleted,
    idleThreads: idle.size,
  };
}

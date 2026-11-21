import { Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { pruneCheckpoints } from "../core/mongodb/checkpoint-retention";

const NOW = new Date("2026-11-21T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("pruneCheckpoints", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let seconds = 0;

  // A distinct second per document keeps the time-derived _ids unique.
  const idAt = (ago: number) =>
    ObjectId.createFromTime(
      Math.floor((NOW.getTime() - ago) / 1000) - seconds++
    );

  const seed = async (threadId: string, ages: number[]) => {
    const docs = ages.map((ago, i) => ({
      thread_id: threadId,
      checkpoint_ns: "",
      checkpoint_id: `${threadId}-${i + 1}`,
    }));
    await db
      .collection("checkpoints")
      .insertMany(docs.map((doc, i) => ({ _id: idAt(ages[i]), ...doc })));
    await db.collection("checkpoint_writes").insertMany(
      docs.map((doc, i) => ({
        _id: idAt(ages[i]),
        ...doc,
        task_id: "task",
        idx: 0,
      }))
    );
  };

  const remaining = async (collection: string, threadId: string) =>
    (
      await db
        .collection(collection)
        .find({ thread_id: threadId })
        .sort({ checkpoint_id: 1 })
        .toArray()
    ).map(doc => doc.checkpoint_id);

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  });

  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  beforeEach(async () => {
    db = client.db(`retention-${seconds}`);
    await seed("active", [3 * DAY, 2 * DAY, 1.5 * DAY]);
    await seed("fresh", [2 * DAY, HOUR]);
    await seed("recent", [10 * HOUR, HOUR]);
    await seed("idle", [200 * DAY, 190 * DAY]);
    await seed("waiting", [200 * DAY, 190 * DAY]);
  });

  it("keeps only the latest checkpoint of a thread and its writes", async () => {
    await pruneCheckpoints(db, { now: NOW });

    expect(await remaining("checkpoints", "active")).toEqual(["active-3"]);
    expect(await remaining("checkpoint_writes", "active")).toEqual([
      "active-3",
    ]);
  });

  it("leaves checkpoints younger than minAgeHours alone", async () => {
    await pruneCheckpoints(db, { now: NOW });

    expect(await remaining("checkpoints", "fresh")).toEqual(["fresh-2"]);
    expect(await remaining("checkpoints", "recent")).toEqual([
      "recent-1",
      "recent-2",
    ]);
    expect(await remaining("checkpoint_writes", "recent")).toEqual([
      "recent-1",
      "recent-2",
    ]);
  });

  it("keeps the latest checkpoint of an idle thread when idleThreadDays is unset", async () => {
    const result = await pruneCheckpoints(db, { now: NOW });

    expect(await remaining("checkpoints", "idle")).toEqual(["idle-2"]);
    expect(result.idleThreads).toBe(0);
  });

  it("drops an idle thread entirely unless it is protected", async () => {
    const result = await pruneCheckpoints(db, {
      now: NOW,
      idleThreadDays: 180,
      protectedThreadIds: async () => ["waiting"],
    });

    expect(await remaining("checkpoints", "idle")).toEqual([]);
    expect(await remaining("checkpoint_writes", "idle")).toEqual([]);
    expect(await remaining("checkpoints", "waiting")).toEqual(["waiting-2"]);
    expect(await remaining("checkpoint_writes", "waiting")).toEqual([
      "waiting-2",
    ]);
    expect(result).toEqual({ checkpoints: 6, writes: 6, idleThreads: 1 });
  });

  it("reads custom collection names", async () => {
    await db.collection("checkpoints").rename("cp");
    await db.collection("checkpoint_writes").rename("cpw");

    const result = await pruneCheckpoints(db, {
      now: NOW,
      checkpointCollectionName: "cp",
      checkpointWritesCollectionName: "cpw",
    });

    expect(result).toEqual({ checkpoints: 5, writes: 5, idleThreads: 0 });
  });
});

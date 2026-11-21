import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Connection } from "mongoose";
import { pruneCheckpoints } from "./checkpoint-retention";
import type { PruneCheckpointsParams } from "./checkpoint-retention";

export const CHECKPOINT_RETENTION_PARAMS = "CHECKPOINT_RETENTION_PARAMS";

const DEFAULT_INTERVAL_MINUTES = 360;
const FIRST_RUN_DELAY_MS = 15 * 60_000;

/** Runs {@link pruneCheckpoints} on the checkpointer's database on a schedule. */
@Injectable()
export class CheckpointRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CheckpointRetentionService.name);
  private firstRun?: NodeJS.Timeout;
  private schedule?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject("MONGO_CONNECTION") private readonly connection: Connection,
    @Inject(CHECKPOINT_RETENTION_PARAMS)
    private readonly params: PruneCheckpointsParams
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    const intervalMs =
      (this.params.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES) * 60_000;
    this.firstRun = setTimeout(() => void this.run(), FIRST_RUN_DELAY_MS);
    this.schedule = setInterval(() => void this.run(), intervalMs);
  }

  onModuleDestroy(): void {
    clearTimeout(this.firstRun);
    clearInterval(this.schedule);
  }

  async run(): Promise<void> {
    const db = this.connection.db;
    if (this.running || !db) return;
    this.running = true;
    const jobId = randomUUID();
    const startedAt = Date.now();
    try {
      const result = await pruneCheckpoints(db, this.params);
      this.logger.log({
        message: "Checkpoints pruned",
        jobId,
        ...result,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.logger.error(
        {
          message: "Checkpoint pruning failed",
          jobId,
          errorMessage: (error as Error).message,
        },
        (error as Error).stack
      );
    } finally {
      this.running = false;
    }
  }
}

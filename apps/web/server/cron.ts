import { sweepShowroomRemovals } from "./lib/showroomSweep";
import { runCazooHealthCheck } from "./lib/cazooHealth";
import { ObjectStorageService } from "./lib/objectStorage";
import { logger } from "./lib/logger";

export type ScheduledJob = "showroom-sweep" | "orphan-uploads" | "cazoo-health";

const ORPHAN_MAX_AGE_MS = 30 * 60 * 1000;

/** Jobs that used to run on setInterval inside the long-lived Express server. */
export async function runScheduledJob(job: ScheduledJob): Promise<unknown> {
  switch (job) {
    case "showroom-sweep":
      await sweepShowroomRemovals();
      return "done";
    case "orphan-uploads": {
      const deleted = await new ObjectStorageService().cleanupOrphanedUploads(ORPHAN_MAX_AGE_MS);
      logger.info({ deleted }, "Orphaned upload cleanup finished");
      return { deleted };
    }
    case "cazoo-health": {
      const result = await runCazooHealthCheck();
      return { status: result.status };
    }
    default:
      throw new Error(`Unknown job: ${String(job)}`);
  }
}

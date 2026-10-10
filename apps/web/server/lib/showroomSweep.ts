import { and, isNotNull, lte } from "drizzle-orm";
import { db, vehiclesTable } from "@workspace/db";
import { logger } from "./logger";

// Vehicles can be scheduled for automatic removal from the public website a set
// time after a sale (the "remove in 7 days" option). This periodic sweep clears
// the website flags once that time has passed so the stored state — and the
// dealer's back office — reflect the removal. The public showroom queries also
// exclude due vehicles directly, so visibility is already correct between sweeps.
export async function sweepShowroomRemovals(): Promise<void> {
  const removed = await db
    .update(vehiclesTable)
    .set({ showroomSold: false, showroomRemoveAt: null })
    .where(
      and(
        isNotNull(vehiclesTable.showroomRemoveAt),
        lte(vehiclesTable.showroomRemoveAt, new Date()),
      ),
    )
    .returning({ id: vehiclesTable.id });
  if (removed.length > 0) {
    logger.info(
      { count: removed.length },
      "Removed vehicles from the public website on schedule",
    );
  }
}


import { createHash } from "node:crypto";

// Hash persisted values, not timestamps: invoice-only writes and deposits must
// invalidate an open form even when no vehicle updatedAt change was recorded.
export function vehicleEditVersion(vehicle: unknown, invoice: unknown): string {
  return createHash("sha256").update(JSON.stringify([vehicle, invoice ?? null])).digest("hex");
}

export const staleVehicleMessage =
  "Someone else changed this vehicle or invoice. Nothing was saved. Refresh and review the latest details before saving again.";

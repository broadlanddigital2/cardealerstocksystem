// Access policy for stored files. Policies are stored in the `stored_objects`
// table (see objectStorage.ts).

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}

export function canAccessPolicy(
  policy: ObjectAclPolicy | null,
  userId: string | undefined,
  requestedPermission: ObjectPermission,
): boolean {
  if (!policy) return false;
  if (policy.visibility === "public" && requestedPermission === ObjectPermission.READ) {
    return true;
  }
  if (!userId) return false;
  return policy.owner === userId;
}

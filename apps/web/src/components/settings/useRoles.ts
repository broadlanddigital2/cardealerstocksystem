import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { ModuleKey } from "@/lib/modules";

export interface RoleRow {
  key: string;
  name: string;
  modules: ModuleKey[];
  isDefault: boolean;
  userCount: number;
}

export interface RolesResponse {
  siteModules: ModuleKey[];
  roles: RoleRow[];
  moved?: number;
}

export const ROLES_QUERY_KEY = ["roles"];

/** Every role (Staff first, then custom roles) plus the dealer's modules. */
export function useRoles() {
  return useQuery({
    queryKey: ROLES_QUERY_KEY,
    queryFn: () => customFetch<RolesResponse>("/api/roles"),
  });
}

/** Display name for a role key ("admin" -> "Admin"). */
export function roleName(key: string, roles: RoleRow[] | undefined): string {
  if (key === "admin") return "Admin";
  return roles?.find((r) => r.key === key)?.name ?? roles?.find((r) => r.isDefault)?.name ?? "Staff";
}

export function sendRoles(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  return customFetch<RolesResponse>(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

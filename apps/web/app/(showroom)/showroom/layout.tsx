import type { ReactNode } from "react";
import { ShowroomShell } from "@/components/app/ShowroomShell";

// Public, customer-facing showroom — rendered OUTSIDE the dealer auth provider so it needs no
// sign-in. On a customer domain (NEXT_PUBLIC_SHOWROOM_HOSTS) middleware.ts
// rewrites the site root to these routes.
export default function ShowroomLayout({ children }: { children: ReactNode }) {
  return <ShowroomShell>{children}</ShowroomShell>;
}

import type { ReactNode } from "react";
import { DealerProviders } from "@/components/app/DealerProviders";

export default function DealerLayout({ children }: { children: ReactNode }) {
  return <DealerProviders>{children}</DealerProviders>;
}

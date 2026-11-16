"use client";

import dynamic from "next/dynamic";
import { Protected } from "@/components/app/Protected";

const View = dynamic(() => import("@/views/CancelledInvoices"), { ssr: false });

export default function Page() {
  return (
    <Protected adminOnly modules={["reports"]}>
      <View />
    </Protected>
  );
}

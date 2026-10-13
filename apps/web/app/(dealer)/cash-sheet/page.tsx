"use client";

import dynamic from "next/dynamic";
import { Protected } from "@/components/app/Protected";

const View = dynamic(() => import("@/views/CashSheet"), { ssr: false });

export default function Page() {
  return (
    <Protected modules={["cash_sheet"]}>
      <View />
    </Protected>
  );
}

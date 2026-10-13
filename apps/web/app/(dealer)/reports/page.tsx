"use client";

import dynamic from "next/dynamic";
import { Protected } from "@/components/app/Protected";

const View = dynamic(() => import("@/views/Reports"), { ssr: false });

export default function Page() {
  return (
    <Protected modules={["reports"]}>
      <View />
    </Protected>
  );
}

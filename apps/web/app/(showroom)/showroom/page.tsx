"use client";

import dynamic from "next/dynamic";

const View = dynamic(() => import("@/views/Showroom"), { ssr: false });

export default function Page() {
  return <View />;
}

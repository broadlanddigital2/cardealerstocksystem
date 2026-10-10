"use client";

import dynamic from "next/dynamic";

const View = dynamic(() => import("@/views/ShowroomPolicies").then((m) => m.ShowroomCookies), { ssr: false });

export default function Page() {
  return <View />;
}

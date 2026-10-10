"use client";

import dynamic from "next/dynamic";

const NotFound = dynamic(() => import("@/views/not-found"), { ssr: false });

export default function NotFoundPage() {
  return <NotFound />;
}

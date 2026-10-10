"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { Protected } from "@/components/app/Protected";

const VehicleDetail = dynamic(() => import("@/views/VehicleDetail"), { ssr: false });

export default function Page() {
  const params = useParams<{ id: string }>();
  return (
    <Protected>
      <VehicleDetail id={params.id} />
    </Protected>
  );
}

"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const ShowroomVehicle = dynamic(() => import("@/views/ShowroomVehicle"), { ssr: false });

export default function Page() {
  const params = useParams<{ id: string }>();
  return <ShowroomVehicle id={params.id} />;
}

"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useUser } from "@/lib/auth";
import { useLocation } from "@/lib/router";

const Landing = dynamic(() => import("@/views/Landing"), { ssr: false });

export default function HomePage() {
  const { isSignedIn, isLoaded } = useUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation("/stock");
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || isSignedIn) return null;
  return <Landing />;
}

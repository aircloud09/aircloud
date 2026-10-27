"use client";

/**
 * The isometric office was built at /iso before it became the main page;
 * old links land on / instead.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function IsoRedirectPage(): React.ReactNode {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}

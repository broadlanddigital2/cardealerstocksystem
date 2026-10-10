"use client";

// Small compatibility layer so the views written for `wouter` run on the
// Next.js App Router unchanged: `Link`, and `useLocation()` returning
// `[pathname, navigate]`.
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, type ComponentProps } from "react";

export function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink {...props} />;
}

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

export function useLocation(): [string, Navigate] {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const navigate = useCallback<Navigate>(
    (to, opts) => {
      if (opts?.replace) router.replace(to);
      else router.push(to);
    },
    [router],
  );
  return [pathname, navigate];
}

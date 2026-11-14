"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { PendingIndicator } from "@/components/pending-indicator";
import { isPlainActivation } from "@/lib/is-plain-activation";

export function FilterLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clicked, setClicked] = useState(false);
  const pending = isPending || clicked;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-busy={pending || undefined}
      onClick={(event) => {
        if (!isPlainActivation(event)) return;
        event.preventDefault();
        setClicked(true);
        startTransition(() => {
          router.push(href);
        });
      }}
      className={
        active
          ? "relative inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
          : "relative inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-medium text-foreground ring-1 ring-foreground/10 hover:bg-muted"
      }
    >
      {children}
      <PendingIndicator pending={pending} label="Loading" />
    </Link>
  );
}

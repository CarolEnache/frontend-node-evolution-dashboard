"use client";

import { createContext, useCallback, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { PendingIndicator } from "@/components/pending-indicator";

const EntryCardPending = createContext<{
  pending: boolean;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
} | null>(null);

export function EntryCard({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    const timeout = pending ? window.setTimeout(reset, 12_000) : undefined;
    return () => {
      window.removeEventListener("pageshow", reset);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [pending]);

  const onLinkClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if ((event.button ?? 0) !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setPending(true);
  }, []);

  return (
    <EntryCardPending.Provider value={{ pending, onLinkClick }}>
      <li
        data-testid="entry-card"
        aria-busy={pending || undefined}
        className="relative rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10"
      >
        {children}
        {pending ? (
          <p className="mt-2 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <PendingIndicator pending label="Opening the source" />
            Opening the source
          </p>
        ) : null}
      </li>
    </EntryCardPending.Provider>
  );
}

export function EntrySourceLink({ href, children }: { href: string; children: ReactNode }) {
  const ctx = useContext(EntryCardPending);
  return (
    <a
      href={href}
      className="font-medium hover:underline focus-visible:underline"
      aria-busy={ctx?.pending || undefined}
      onClick={ctx?.onLinkClick}
    >
      {children}
    </a>
  );
}

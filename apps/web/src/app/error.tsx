"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PendingIndicator } from "@/components/pending-indicator";

export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  const message = error instanceof globalThis.Error ? error.message : "The dashboard couldn't read the timeline.";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <p className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">Evolution</p>
      <h1 className="font-[family-name:var(--font-heading)] text-4xl">The timeline did not load</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div>
        <Button
          type="button"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => {
            setPending(true);
            retry();
          }}
        >
          <PendingIndicator pending={pending} label="Retrying" />
          Try again
        </Button>
      </div>
    </div>
  );
}

"use client";

import { createContext, useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PendingIndicator } from "@/components/pending-indicator";

export const FilterFormPending = createContext(false);

export function FilterForm({ action, children }: { action: string; children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clicked, setClicked] = useState(false);
  const pending = isPending || clicked;

  useEffect(() => {
    const reset = () => setClicked(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (typeof value === "string" && value.trim() !== "") params.set(key, value);
    }
    const query = params.toString();
    const href = query ? `${action}?${query}` : action;
    setClicked(true);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <FilterFormPending.Provider value={pending}>
      <form
        action={action}
        method="get"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
        aria-busy={pending || undefined}
        onSubmit={onSubmit}
      >
        {children}
        <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending || undefined}>
          <PendingIndicator pending={pending} label="Applying filters" />
          Apply
        </Button>
      </form>
    </FilterFormPending.Provider>
  );
}

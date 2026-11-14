"use client";

import { useContext } from "react";
import { FilterFormPending } from "@/components/filter-form";

export function TagSelect({ tags, value }: { tags: string[]; value?: string }) {
  const pending = useContext(FilterFormPending);
  const options = [...tags];
  if (value && !options.includes(value)) options.push(value);
  options.sort((a, b) => a.localeCompare(b));

  return (
    <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs text-muted-foreground">
      Tag
      <select
        name="tag"
        defaultValue={value ?? ""}
        aria-busy={pending || undefined}
        data-testid="tag-select"
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm"
      >
        <option value="">All tags</option>
        {options.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
    </label>
  );
}

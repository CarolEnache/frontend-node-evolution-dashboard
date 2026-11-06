export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-card px-5 py-10 ring-1 ring-foreground/10">
      <h2 className="font-[family-name:var(--font-heading)] text-2xl">{title}</h2>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

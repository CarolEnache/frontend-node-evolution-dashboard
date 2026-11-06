export function DashboardSkeleton({ label = "Loading the dashboard" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="dashboard-skeleton"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6"
    >
      <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div aria-hidden="true" className="h-40 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

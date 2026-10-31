export function DashboardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6" aria-hidden="true">
      <div className="h-10 w-48 animate-pulse rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

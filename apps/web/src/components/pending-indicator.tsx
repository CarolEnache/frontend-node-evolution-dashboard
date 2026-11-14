export function PendingIndicator({
  pending,
  label,
}: {
  pending: boolean;
  label: string;
}) {
  return (
    <>
      <span
        className={`inline-block size-3 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin ${
          pending ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
        data-testid={pending ? "pending-indicator" : undefined}
      />
      {pending ? (
        <span className="sr-only" role="status" aria-live="polite">
          {label}
        </span>
      ) : null}
    </>
  );
}

import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard";
import { DashboardSkeleton } from "@/components/skeleton";
import type { QueryValue } from "@/lib/filters";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, QueryValue>>;
}) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

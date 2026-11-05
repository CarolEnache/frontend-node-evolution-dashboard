import { Suspense } from "react";
import { TimelineScreen } from "@/components/dashboard";
import { DashboardSkeleton } from "@/components/skeleton";
import type { QueryValue } from "@/lib/filters";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, QueryValue>>;
}) {
  return (
    <Suspense fallback={<DashboardSkeleton label="Loading the timeline" />}>
      <TimelineScreen searchParams={searchParams} />
    </Suspense>
  );
}

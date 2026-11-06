import { Suspense } from "react";
import type { Metadata } from "next";
import { WorthLearningScreen } from "@/components/dashboard";
import { DashboardSkeleton } from "@/components/skeleton";
import type { QueryValue } from "@/lib/filters";

export const metadata: Metadata = {
  title: "Worth learning — Evolution",
  description: "Entries flagged by the stand-in worth-learning heuristic across MDN, Can I Use, Node.js, TypeScript, and Next.js.",
};

export default function WorthLearningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, QueryValue>>;
}) {
  return (
    <Suspense fallback={<DashboardSkeleton label="Loading worth learning" />}>
      <WorthLearningScreen searchParams={searchParams} />
    </Suspense>
  );
}

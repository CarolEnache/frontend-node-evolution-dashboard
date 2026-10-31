import { GAP_LABELS, type Gap } from "@evolution/shared-types";
import { Badge } from "@/components/ui/badge";

const STYLES: Record<Gap, string> = {
  "already-know": "bg-emerald-100 text-emerald-950",
  adjacent: "bg-amber-100 text-amber-950",
  new: "bg-rose-100 text-rose-950",
};

export function GapBadge({ gap, similarity }: { gap?: Gap; similarity?: number }) {
  if (!gap) return <Badge variant="outline">Untagged</Badge>;
  const percent = typeof similarity === "number" ? `${Math.round(similarity * 100)}% similar to your profile` : undefined;
  return (
    <Badge className={STYLES[gap]} title={percent}>
      {GAP_LABELS[gap]}
      {typeof similarity === "number" ? <span className="font-mono text-[10px] opacity-80">{Math.round(similarity * 100)}%</span> : null}
    </Badge>
  );
}

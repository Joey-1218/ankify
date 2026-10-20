import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

/** Mirrors the lists page so the layout does not jump on first paint. */
export default function Loading() {
  return (
    <SkeletonGroup className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="space-y-4 rounded-xl border border-border p-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-1.5 w-full" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

import { notFound } from "next/navigation";
import { PageFrame } from "@/components/ui/page";
import { requirePageUser } from "@/server/auth";
import { loadStudyListDetail } from "@/server/study-lists/lists";
import { ListEntries } from "../../list-entries";
import { ListHeader } from "../../list-header";

export const dynamic = "force-dynamic";

/** A built-in list with the user's progress, followed or not. */
export default async function BuiltinListPage({ params }: { params: Promise<{ builtinId: string }> }) {
  const user = await requirePageUser();
  const { builtinId } = await params;
  const detail = await loadStudyListDetail(user.id, { kind: "builtin", builtinId });
  if (!detail) notFound();
  return (
    <PageFrame width="standard" className="space-y-6">
      <ListHeader list={detail.list} excludedCount={detail.excludedCount} />
      <ListEntries detail={detail} />
    </PageFrame>
  );
}

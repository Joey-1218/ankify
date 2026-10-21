import { notFound } from "next/navigation";
import { PageFrame } from "@/components/ui/page";
import { requirePageUser } from "@/server/auth";
import { loadStudyListDetail, MY_PROBLEMS_ID } from "@/server/study-lists/lists";
import { ListEntries } from "../list-entries";
import { ListHeader } from "../list-header";

export const dynamic = "force-dynamic";

/** One of the user's lists: a custom list, a followed built-in list by row id, or My problems. */
export default async function StudyListPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const detail = await loadStudyListDetail(user.id, id === MY_PROBLEMS_ID ? { kind: "my_problems" } : { kind: "list", id });
  if (!detail) notFound();
  return (
    <PageFrame width="standard" className="space-y-6">
      <ListHeader list={detail.list} excludedCount={detail.excludedCount} />
      <ListEntries detail={detail} />
    </PageFrame>
  );
}

import { PageFrame, PageHeader } from "@/components/ui/page";
import { requirePageUser } from "@/server/auth";
import { getRequestTranslations } from "@/server/i18n";
import { loadStudyListsOverview } from "@/server/study-lists/lists";
import { ListsOverview } from "./lists-overview";

export const dynamic = "force-dynamic";

/** Study lists: My problems, the user's lists, and the built-in lists to follow. */
export default async function ListsPage() {
  const user = await requirePageUser();
  const [t, overview] = await Promise.all([getRequestTranslations(), loadStudyListsOverview(user.id)]);
  return (
    <PageFrame width="standard" className="space-y-6">
      <PageHeader title={t.lists.title} description={t.lists.subtitle} />
      <ListsOverview overview={overview} />
    </PageFrame>
  );
}

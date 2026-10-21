import { requirePageUser } from "@/server/auth";
import { loadProblemsList } from "@/server/problems-list";
import { loadCustomLists } from "@/server/study-lists/lists";
import ProblemsPage from "./problems-client";
import { parseProblemsSort } from "./problems-sort";

export const dynamic = "force-dynamic";

export default async function ProblemsPageShell({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string | string[]; dir?: string | string[] }>;
}) {
  const user = await requirePageUser();
  const [initialData, customLists] = await Promise.all([loadProblemsList(user.id), loadCustomLists(user.id)]);
  return <ProblemsPage initialData={initialData} initialSort={parseProblemsSort(await searchParams)} customLists={customLists} />;
}

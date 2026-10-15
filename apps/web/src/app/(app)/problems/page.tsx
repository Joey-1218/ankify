import { requirePageUser } from "@/server/auth";
import { loadProblemsList } from "@/server/problems-list";
import ProblemsPage from "./problems-client";
import { parseProblemsSort } from "./problems-sort";

export const dynamic = "force-dynamic";

export default async function ProblemsPageShell({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string | string[]; dir?: string | string[] }>;
}) {
  const user = await requirePageUser();
  const initialData = await loadProblemsList(user.id);
  return <ProblemsPage initialData={initialData} initialSort={parseProblemsSort(await searchParams)} />;
}

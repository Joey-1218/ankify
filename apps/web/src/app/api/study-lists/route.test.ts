import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StudyListDetailDto, StudyListsOverviewDto, StudyListSummaryDto } from "@ankileet/contracts";
import { getDb, schema } from "@ankileet/db";
import { getRequestUser } from "@/server/auth";
import { createTestDb } from "@/server/test-db";
import { DELETE as deleteList, GET as getList, PATCH as patchList } from "./[id]/route";
import { DELETE as deleteItem } from "./[id]/items/[itemId]/route";
import { POST as postItem, PUT as putOrder } from "./[id]/items/route";
import { GET as getBuiltin } from "./builtin/[builtinId]/route";
import { GET as getOverview, POST as postList, PUT as putListOrder } from "./route";

// Route-level checks: authentication, validation, and status mapping. List
// rules are covered in server/study-lists/study-lists.test.ts.
vi.mock("@/server/auth", () => ({
  getRequestUser: vi.fn(),
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));

const testDb = createTestDb();
const user = { id: "lists-route-user", email: "lists-route@example.test", name: "Route" };

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`https://ankileet.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values(user);
});
afterAll(() => testDb.cleanup());

describe("study list routes", () => {
  it("require a signed-in user", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    expect((await getOverview(request("/api/study-lists"))).status).toBe(401);
    expect((await postList(request("/api/study-lists", "POST", { action: "create", requestId: crypto.randomUUID(), name: "x" }))).status).toBe(401);
    expect((await getList(request("/api/study-lists/my-problems"), params({ id: "my-problems" }))).status).toBe(401);
    expect((await getBuiltin(request("/api/study-lists/builtin/math"), params({ builtinId: "math" }))).status).toBe(401);
    expect((await deleteList(request("/api/study-lists/x", "DELETE"), params({ id: "x" }))).status).toBe(401);
    expect((await putListOrder(request("/api/study-lists", "PUT", { listIds: [] }))).status).toBe(401);
  });

  it("validate input and map errors to statuses", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(user as never);
    expect((await postList(request("/api/study-lists", "POST", "{"))).status).toBe(400);
    expect((await postList(request("/api/study-lists", "POST", { action: "create", requestId: crypto.randomUUID(), name: "   " }))).status).toBe(400);
    expect((await postList(request("/api/study-lists", "POST", { action: "follow", requestId: crypto.randomUUID(), builtinId: "nope" }))).status).toBe(404);
    expect((await patchList(request("/api/study-lists/missing", "PATCH", {}), params({ id: "missing" }))).status).toBe(400);
    expect((await patchList(request("/api/study-lists/missing", "PATCH", { active: false }), params({ id: "missing" }))).status).toBe(404);
    expect((await getList(request("/api/study-lists/missing"), params({ id: "missing" }))).status).toBe(404);
    expect((await getBuiltin(request("/api/study-lists/builtin/nope"), params({ builtinId: "nope" }))).status).toBe(404);
    const item = { source: "problem", problemId: "x", title: "Injected" };
    expect((await postItem(request("/api/study-lists/x/items", "POST", item), params({ id: "x" }))).status).toBe(400);
  });

  it("create a list, add and reorder items, and delete it", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(user as never);
    const requestId = crypto.randomUUID();
    const created = await postList(request("/api/study-lists", "POST", { action: "create", requestId, name: "Route list" }));
    expect(created.status).toBe(201);
    const { list } = (await created.json()) as { list: StudyListSummaryDto };
    expect(list).toMatchObject({ kind: "custom", name: { en: "Route list" }, active: true });
    expect((await postList(request("/api/study-lists", "POST", { action: "create", requestId, name: "Route list" }))).status).toBe(200);

    const builtin = (await (await getBuiltin(request("/api/study-lists/builtin/math"), params({ builtinId: "math" }))).json()) as StudyListDetailDto;
    const [first, second] = builtin.entries;
    for (const entry of [first!, second!]) {
      const added = await postItem(request(`/api/study-lists/${list.id}/items`, "POST", { source: "builtin", slug: entry.slug }), params({ id: list.id! }));
      expect(added.status).toBe(201);
    }
    let detail = (await (await getList(request(`/api/study-lists/${list.id}`), params({ id: list.id! }))).json()) as StudyListDetailDto;
    const ids = detail.entries.map((entry) => entry.itemId!);
    expect((await putOrder(request(`/api/study-lists/${list.id}/items`, "PUT", { itemIds: [ids[0]] }), params({ id: list.id! }))).status).toBe(409);
    expect((await putOrder(request(`/api/study-lists/${list.id}/items`, "PUT", { itemIds: [...ids].reverse() }), params({ id: list.id! }))).status).toBe(200);
    expect((await deleteItem(request("/", "DELETE"), params({ id: list.id!, itemId: ids[0]! }))).status).toBe(200);
    detail = (await (await getList(request(`/api/study-lists/${list.id}`), params({ id: list.id! }))).json()) as StudyListDetailDto;
    expect(detail.entries.map((entry) => entry.slug)).toEqual([second!.slug]);

    const overview = (await (await getOverview(request("/api/study-lists"))).json()) as StudyListsOverviewDto;
    expect(overview.lists.map((entry) => entry.kind)).toEqual(["my_problems", "custom"]);
    expect((await putListOrder(request("/api/study-lists", "PUT", { listIds: "x" }))).status).toBe(400);
    expect((await putListOrder(request("/api/study-lists", "PUT", { listIds: [] }))).status).toBe(409);
    expect((await putListOrder(request("/api/study-lists", "PUT", { listIds: [list.id] }))).status).toBe(200);
    expect((await deleteList(request("/", "DELETE"), params({ id: list.id! }))).status).toBe(200);
    expect((await deleteList(request("/", "DELETE"), params({ id: list.id! }))).status).toBe(404);
  });
});

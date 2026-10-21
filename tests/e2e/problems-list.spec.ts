import type { Locator, Page } from "@playwright/test";
import { API_ORIGIN, test, expect } from "./fixtures";

/** The whole row of the Problems list opens the problem; the title link keeps its own behavior. */
const LIST = `${API_ORIGIN}/problems`;
const DETAIL = `${API_ORIGIN}/problems/qa-problem-two-sum`;

async function openList(page: Page) {
  // In development the list refetches once after hydration and re-renders its rows.
  await page.goto(LIST, { waitUntil: "networkidle" });
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: /Two Sum/ }) });
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

/** The cells a click should open the problem from: not the title link, a selection checkbox, or the row's actions menu. */
function plainCells(page: Page, row: Locator) {
  return row
    .getByRole("cell")
    .filter({ hasNot: page.getByRole("link") })
    .filter({ hasNot: page.getByRole("checkbox") })
    .filter({ hasNot: page.getByRole("button") });
}

test("clicking anywhere on a problem row opens its detail page", async ({ context, panel }) => {
  void panel; // signs the context in
  const page = await context.newPage();
  const count = await plainCells(page, await openList(page)).count();
  expect(count).toBeGreaterThanOrEqual(5);
  for (let cell = 0; cell < count; cell += 1) {
    const row = await openList(page);
    await plainCells(page, row).nth(cell).click();
    await expect(page).toHaveURL(DETAIL);
  }
  await page.close();
});

test("the title link navigates once and still opens a new tab", async ({ context, panel }) => {
  void panel;
  const page = await context.newPage();
  let row = await openList(page);
  await row.getByRole("link", { name: /Two Sum/ }).click();
  await expect(page).toHaveURL(DETAIL);
  // A second navigation from the row would leave a duplicate history entry.
  await page.goBack();
  await expect(page).toHaveURL(LIST);

  row = await openList(page);
  const [opened] = await Promise.all([
    context.waitForEvent("page"),
    row.getByRole("link", { name: /Two Sum/ }).click({ modifiers: ["ControlOrMeta"] }),
  ]);
  await expect(opened).toHaveURL(DETAIL);
  await expect(page).toHaveURL(LIST);
  await opened.close();
  await page.close();
});

test("the title link opens the problem from the keyboard", async ({ context, panel }) => {
  void panel;
  const page = await context.newPage();
  const row = await openList(page);
  await row.getByRole("link", { name: /Two Sum/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(DETAIL);
  await page.close();
});

test("selecting text in a row does not navigate", async ({ context, panel }) => {
  void panel;
  const page = await context.newPage();
  const row = await openList(page);
  // The next-review cell: plain text, wide enough to drag across.
  const box = (await plainCells(page, row).nth(1).boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toBe("");
  // Give a stray navigation time to happen before asserting it did not.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(LIST);
  await page.close();
});

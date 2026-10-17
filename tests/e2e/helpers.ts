import type { Page } from "@playwright/test";
import { expect, type Api } from "./fixtures";
import { submit, type LeetcodeFixtureState } from "./leetcode-fixture";

// Playwright restarts its worker after a failure, which reloads this module.
// A fixed start would then reuse ids of problems already in the run's
// database, and a "new" problem would resolve to an existing one by its
// LeetCode id, so each load starts at its own offset.
let nextFrontendId = 10_000 + (Date.now() % 1_000_000) * 100;

/** A problem the QA deck has never seen, served by the LeetCode fixture. */
export function newProblem(state: LeetcodeFixtureState, name: string) {
  const slug = `e2e-${name}-${nextFrontendId}`;
  state.problems[slug] = { frontendId: nextFrontendId++, title: `E2E ${name}`, submissions: [] };
  return slug;
}

/** Expands the panel for the problem in the URL. It may auto-open when
 *  something needs attention, so converge on "expanded" instead of toggling. */
export async function openPanel(page: Page) {
  const slug = new URL(page.url()).pathname.split("/")[2];
  const pill = page.locator(`[data-ankileet-panel][data-slug="${slug}"] [data-key="pill"]`);
  await expect(async () => {
    if ((await pill.getAttribute("aria-expanded")) !== "true") await pill.click();
    await expect(pill).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Makes the page report LeetCode activity now, as regaining focus does. */
export async function focus(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

/** Submits Accepted and finishes the open review, so its rating is asked.
 *  (A review finished as not solved is rated Again without asking.) */
export async function finishWithRatingPending(page: Page, state: LeetcodeFixtureState, slug: string) {
  submit(state, slug, "Accepted");
  await focus(page);
  await expect(page.getByText("1 submission, 1 accepted")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("group", { name: "How did the review go?" })).toBeVisible();
}

/**
 * Verifies and saves the QA user's own DeepSeek key, answered by the e2e
 * server's fake provider. A key is stored only through verification.
 */
export async function useOwnKey(api: Api) {
  expect(await api("/api/settings/ai-key", { body: { provider: "deepseek", apiKey: "e2e-own-key" } })).toMatchObject({ ok: true });
}

/** Removes the QA user's own key. */
export async function removeOwnKey(api: Api) {
  await api("/api/settings/ai-key", { method: "DELETE" });
}

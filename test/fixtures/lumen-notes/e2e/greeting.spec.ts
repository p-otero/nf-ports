import { expect, test } from "@playwright/test";

test("shows the api greeting for this worktree", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#greeting")).toContainText("hello from lumen api");
  const expectedBranch = process.env.EXPECT_BRANCH;
  if (expectedBranch) await expect(page.locator("#greeting")).toContainText(`[${expectedBranch}]`);
});

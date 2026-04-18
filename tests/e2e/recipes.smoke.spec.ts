import { getMissingAuthReason } from "./helpers/env";
import { expectAnyVisible, isVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

test.describe("recipes smoke", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("recipes route loads and handles populated or empty states", async ({ page }) => {
    await openAppRoute(page, "/app/recipes");

    await expect(page.getByText(/^recipes$/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^new$/i })).toBeVisible();

    const emptyState = page.getByText(/no recipes yet/i);
    if (await isVisible(emptyState)) {
      await expect(emptyState).toBeVisible();
      await expect(page.getByText(/create your first recipe/i)).toBeVisible();
      return;
    }

    await expectAnyVisible(
      [
        page.getByText(/select a recipe to view details/i),
        page.getByText(/recipe cost/i),
        page.getByText(/selling price/i),
      ],
      "Expected recipe list/detail shell to render.",
    );
  });
});

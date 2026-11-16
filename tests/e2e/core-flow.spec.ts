import path from "path";
import { expect, test } from "@playwright/test";
import { DEMO_ACTIVE_PROJECT_TITLE, DEMO_EMPLOYEE } from "./fixtures/demo-accounts";
import { demoSignOut, loginEmployee, loginEmployer } from "./helpers/auth";

const PHOTO_FIXTURE = path.join(__dirname, "fixtures", "test-photo.png");

test.describe("NEXORA core flow (employee → employer)", () => {
  test("inklokken, foto uploaden en live zichtbaarheid bij werkgever", async ({ page }) => {
    await loginEmployee(page);
    await expect(page.getByTestId("employee-mobile-view")).toBeVisible();
    await expect(page.getByText(new RegExp(`Hallo ${DEMO_EMPLOYEE.displayName}`))).toBeVisible();

    const clockOut = page.getByTestId("clock-out-button");
    if (await clockOut.isVisible().catch(() => false)) {
      await clockOut.click();
      await page.waitForURL(/clocked=out|\/employee/);
      await expect(page.getByTestId("clock-in-form")).toBeVisible();
    }

    await expect(page.getByTestId("clock-in-button")).toBeVisible();
    await page.getByTestId("clock-in-button").click();
    await page.waitForURL(/clocked=in|\/employee/);
    await expect(page.getByTestId("active-shift-status")).toContainText("Aan het werk");
    await expect(page.getByTestId("clock-in-success")).toBeVisible();

    await expect(page.getByTestId("project-photo-upload")).toBeVisible();
    await page.getByTestId("project-photo-input").setInputFiles(PHOTO_FIXTURE);
    await page.getByTestId("project-photo-submit").click();
    await page.waitForURL(/photo=1/);
    await expect(page.getByTestId("photo-upload-success")).toContainText("Foto geüpload");

    await demoSignOut(page);
    await loginEmployer(page);
    await expect(page).toHaveURL(/\/employer/);

    await page.goto("/employer/projects");
    await page.getByRole("link", { name: DEMO_ACTIVE_PROJECT_TITLE }).click();
    await expect(page.getByTestId("employer-project-overview")).toBeVisible();

    const worker = page.locator('[data-testid="active-worker"]', {
      hasText: DEMO_EMPLOYEE.displayName,
    });
    await expect(worker).toBeVisible();

    const uploadedPhoto = page
      .locator(`[data-testid="project-photo"][data-photo-user="${DEMO_EMPLOYEE.displayName}"]`)
      .first();
    await expect(uploadedPhoto).toBeVisible();
    await expect(uploadedPhoto.locator("img")).toBeVisible();
  });
});

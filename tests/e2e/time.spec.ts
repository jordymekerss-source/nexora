import { expect, test } from "@playwright/test";
import { DEMO_EMPLOYEE, loginEmployee, loginEmployer } from "./helpers/auth";

test.describe("Urenregistratie", () => {
  test("medewerker ziet inklok-UI", async ({ page }) => {
    await loginEmployee(page);
    await expect(page.getByRole("heading", { name: "Inklokken" })).toBeVisible();
    const clockIn = page.getByTestId("clock-in-button");
    const clockOut = page.getByTestId("clock-out-button");
    await expect(clockIn.or(clockOut)).toBeVisible();
  });

  test("werkgever ziet urenoverzicht", async ({ page }) => {
    await loginEmployer(page);
    await page.goto("/dashboard/time");
    await expect(page.getByRole("heading", { name: /Uren/i })).toBeVisible();
    await expect(page.getByText(DEMO_EMPLOYEE.displayName).first()).toBeVisible();
  });
});

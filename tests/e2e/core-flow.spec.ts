import path from "path";
import { expect, test, type Page } from "@playwright/test";
import {
  DEMO_ACTIVE_PROJECT_TITLE,
  DEMO_EMPLOYEE,
  DEMO_EMPLOYER,
} from "./fixtures/demo-accounts";

const PHOTO_FIXTURE = path.join(__dirname, "fixtures", "test-photo.png");

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Inloggen" })).toBeVisible();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

async function demoSignOut(page: Page): Promise<void> {
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth/sign-out";
    document.body.appendChild(form);
    form.submit();
  });
  await page.waitForURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Inloggen" })).toBeVisible();
}

test.describe("NEXORA core flow (employee → employer)", () => {
  test("inklokken, foto uploaden en live zichtbaarheid bij werkgever", async ({
    page,
  }) => {
    // 1. Medewerker login
    await loginAs(page, DEMO_EMPLOYEE.email, DEMO_EMPLOYEE.password);

    // 2. Mobiele medewerkeromgeving
    await page.waitForURL(/\/employee/);
    await expect(page).toHaveURL(/\/employee/);
    await expect(page.getByTestId("employee-mobile-view")).toBeVisible();
    await expect(page.getByText(new RegExp(`Hallo ${DEMO_EMPLOYEE.displayName}`))).toBeVisible();

    // Seed kan al een open dienst hebben — eerst uitklokken voor deterministische inklok.
    const clockOut = page.getByTestId("clock-out-button");
    if (await clockOut.isVisible().catch(() => false)) {
      await clockOut.click();
      await page.waitForURL(/clocked=out|\/employee/);
      await expect(page.getByTestId("clock-in-form")).toBeVisible();
    }

    // 3. Inklokken → status "Aan het werk"
    await expect(page.getByTestId("clock-in-button")).toBeVisible();
    await page.getByTestId("clock-in-button").click();
    await page.waitForURL(/clocked=in|\/employee/);
    await expect(page.getByTestId("active-shift-status")).toContainText("Aan het werk");
    await expect(page.getByTestId("clock-in-success")).toBeVisible();

    // 4. Foto uploaden bij actief project
    await expect(page.getByTestId("project-photo-upload")).toBeVisible();
    await page.getByTestId("project-photo-input").setInputFiles(PHOTO_FIXTURE);
    await page.getByTestId("project-photo-submit").click();
    await page.waitForURL(/photo=1/);
    await expect(page.getByTestId("photo-upload-success")).toContainText("Foto geüpload");
    await expect(page.getByTestId("active-shift-status")).toContainText("Aan het werk");

    // 5. Uitloggen en inloggen als werkgever → /employer
    await demoSignOut(page);
    await loginAs(page, DEMO_EMPLOYER.email, DEMO_EMPLOYER.password);
    await page.waitForURL(/\/employer/);
    await expect(page).toHaveURL(/\/employer/);

    // Projectoverzicht met live status + foto
    await page.goto("/employer/projects");
    await page.getByRole("link", { name: DEMO_ACTIVE_PROJECT_TITLE }).click();
    await expect(page.getByTestId("employer-project-overview")).toBeVisible();

    // 6. Ingeklokte medewerker + geüploade foto zichtbaar
    const worker = page.locator('[data-testid="active-worker"]', {
      hasText: DEMO_EMPLOYEE.displayName,
    });
    await expect(worker).toBeVisible();
    await expect(page.getByTestId("project-photos-panel")).toBeVisible();
    const uploadedPhoto = page.locator(
      `[data-testid="project-photo"][data-photo-user="${DEMO_EMPLOYEE.displayName}"]`,
    );
    await expect(uploadedPhoto).toBeVisible();
    await expect(uploadedPhoto.locator("img")).toBeVisible();
  });
});

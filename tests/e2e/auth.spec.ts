import { expect, test } from "@playwright/test";
import {
  DEMO_EMPLOYEE,
  DEMO_EMPLOYER,
  demoSignOut,
  loginAs,
  loginEmployee,
  loginEmployer,
} from "./helpers/auth";

test.describe("Authenticatie", () => {
  test("medewerker kan inloggen en komt op /employee", async ({ page }) => {
    await loginEmployee(page);
    await expect(page.getByTestId("employee-mobile-view")).toBeVisible();
    await expect(page.getByText(new RegExp(`Hallo ${DEMO_EMPLOYEE.displayName}`))).toBeVisible();
  });

  test("werkgever kan inloggen en komt op /employer", async ({ page }) => {
    await loginEmployer(page);
    await expect(page).toHaveURL(/\/employer/);
  });

  test("ongeldige credentials blijven op login", async ({ page }) => {
    await loginAs(page, "onbekend@nexora.local", "verkeerd");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/Ongeldige e-mail of wachtwoord/i)).toBeVisible();
  });

  test("uitloggen wist sessie en blokkeert /employee", async ({ page }) => {
    await loginEmployee(page);
    await demoSignOut(page);
    await page.goto("/employee");
    await expect(page).toHaveURL(/\/login/);
  });

  test("werkgever-uitloggen blokkeert /employer/projects", async ({ page }) => {
    await loginEmployer(page);
    await demoSignOut(page);
    await page.goto("/employer/projects");
    await expect(page).toHaveURL(/\/login/);
  });
});

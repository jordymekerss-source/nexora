import { expect, test } from "@playwright/test";
import { demoSignOut, loginEmployee, loginEmployer } from "./helpers/auth";

test.describe("Beveiliging — directe toegang & rolgrenzen", () => {
  test("anonieme gebruiker wordt van beschermde routes geweerd", async ({ page }) => {
    await page.context().clearCookies();
    for (const path of [
      "/dashboard",
      "/employee",
      "/employer",
      "/employer/clients",
      "/employer/invoices",
      "/employer/quotes",
      "/dashboard/time",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("medewerker mag geen werkgever-CRM openen", async ({ page }) => {
    await loginEmployee(page);
    await page.goto("/employer/clients");
    // requireEmployerSession redirects non-employers to /dashboard
    await expect(page).not.toHaveURL(/\/employer\/clients$/);
    await expect(page).toHaveURL(/\/(dashboard|employee|login)/);
  });

  test("medewerker mag geen facturenlijst openen", async ({ page }) => {
    await loginEmployee(page);
    await page.goto("/employer/invoices");
    await expect(page).not.toHaveURL(/\/employer\/invoices$/);
  });

  test("werkgever mag geen medewerker-inklokpagina als employee-sessie gebruiken", async ({
    page,
  }) => {
    await loginEmployer(page);
    await page.goto("/employee");
    // requireEmployeeSession redirects employers away from /employee
    await expect(page).not.toHaveURL(/\/employee$/);
  });

  test("verlopen/ingetrokken demo-sessie na uitloggen", async ({ page }) => {
    await loginEmployer(page);
    await demoSignOut(page);
    await page.goto("/employer/quotes");
    await expect(page).toHaveURL(/\/login/);
  });
});

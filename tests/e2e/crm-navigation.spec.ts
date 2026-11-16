import { expect, test } from "@playwright/test";
import { loginEmployer } from "./helpers/auth";

test.describe("CRM & navigatie (werkgever)", () => {
  test.beforeEach(async ({ page }) => {
    await loginEmployer(page);
  });

  test("klantenpagina laadt", async ({ page }) => {
    await page.goto("/employer/clients");
    await expect(page.getByRole("heading", { name: "Klanten" })).toBeVisible();
  });

  test("offertespagina laadt", async ({ page }) => {
    await page.goto("/employer/quotes");
    await expect(page.getByRole("heading", { name: /Offerte/i })).toBeVisible();
  });

  test("facturenpagina laadt", async ({ page }) => {
    await page.goto("/employer/invoices");
    await expect(page.getByRole("heading", { name: /Facturatie|Factuur/i })).toBeVisible();
  });

  test("projectenpagina laadt", async ({ page }) => {
    await page.goto("/employer/projects");
    await expect(page.getByRole("heading", { name: "Projecten" })).toBeVisible();
  });

  test("planningpagina laadt", async ({ page }) => {
    await page.goto("/employer/planning");
    await expect(page.getByRole("heading", { name: /Planning/i })).toBeVisible();
  });
});

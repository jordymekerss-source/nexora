import { expect, type Page } from "@playwright/test";
import { DEMO_EMPLOYEE, DEMO_EMPLOYER } from "../fixtures/demo-accounts";

export { DEMO_EMPLOYEE, DEMO_EMPLOYER };

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Inloggen" })).toBeVisible();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

export async function loginEmployee(page: Page): Promise<void> {
  await loginAs(page, DEMO_EMPLOYEE.email, DEMO_EMPLOYEE.password);
  await page.waitForURL(/\/employee/);
}

export async function loginEmployer(page: Page): Promise<void> {
  await loginAs(page, DEMO_EMPLOYER.email, DEMO_EMPLOYER.password);
  await page.waitForURL(/\/employer/);
}

export async function demoSignOut(page: Page): Promise<void> {
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

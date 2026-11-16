import { describe, expect, it } from "vitest";
import { buildNavForSession } from "@/lib/navigation/nav-config";

describe("buildNavForSession", () => {
  it("hides disabled modules for employers", () => {
    const items = buildNavForSession({
      role: "employer",
      enabledModules: new Set(["projects", "time"]),
    });
    const hrefs = items.map((item) => item.href);
    expect(hrefs).toContain("/employer/projects");
    expect(hrefs).not.toContain("/employer/invoices");
    expect(hrefs).not.toContain("/employer/clients");
  });

  it("keeps employee field nav without employer CRM", () => {
    const items = buildNavForSession({
      role: "employee",
      enabledModules: new Set(["time", "projects"]),
    });
    const hrefs = items.map((item) => item.href);
    expect(hrefs).toContain("/employee");
    expect(hrefs).not.toContain("/employer/clients");
  });
});

import { test, expect } from "@playwright/test";

test("登录：429 提示等待时间，登录后展示弱配置警告条", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let authed = false;
  let locked = true;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (data: unknown, status = 200, headers = {}) =>
      route.fulfill({
        status,
        headers,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/api/_ping")
      return authed
        ? reply({
            ok: true,
            version: "browser-test",
            warnings: ["ADMIN_PASSWORD 少于 16 个字符"],
          })
        : reply({ error: "unauthorized" }, 401);
    if (path === "/api/login") {
      if (locked)
        return reply({ error: "too many attempts", retryAfter: 900 }, 429, {
          "Retry-After": "900",
        });
      authed = true;
      return reply({ ok: true });
    }
    if (path === "/api/sources") return reply({ sources: [] });
    return reply({});
  });

  await page.goto("/admin/");
  await page.fill("#login-pw", "whatever");
  await page.click("button[type=submit]");
  await expect(page.locator(".form-error")).toHaveText(
    "尝试次数过多，请 15 分钟后再试",
  );

  locked = false;
  await page.click("button[type=submit]");
  await expect(page.locator(".config-warning")).toContainText(
    "ADMIN_PASSWORD 少于 16 个字符",
  );
  expect(errors).toEqual([]);
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
let defaults: any;
try {
  defaults = JSON.parse(
    readFileSync(
      new URL("../../config/routing.default.json", import.meta.url),
      "utf8",
    ),
  );
} catch {
  throw new Error("无法读取默认规则 JSON");
}

test("分流表单：分组、排序、保存、JSON、错误、导出与窄屏", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let config = structuredClone(defaults) as any;
  let origin = "default";
  let failSave = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/api/_ping")
      return reply({ ok: true, version: "browser-test" });
    if (path === "/api/sources")
      return reply({
        sources: [
          { id: 1, name: "自建测试源", kind: "static" },
          { id: 2, name: "机场测试源", kind: "fetch" },
        ],
      });
    if (path === "/api/routing") {
      if (method === "PUT") {
        if (failSave) return reply({ error: "测试保存失败" }, 500);
        config = route.request().postDataJSON();
        origin = "saved";
      } else if (method === "DELETE") {
        config = structuredClone(defaults);
        origin = "default";
      }
      return reply({ config, origin, defaults });
    }
    if (path === "/api/routing/validate")
      return reply({
        config: route.request().postDataJSON(),
        hiddifyIssues: [],
      });
    if (path === "/api/routing/preview")
      return reply({
        index: 0,
        target: "REJECT",
        uncertain: false,
        note: "仅域名预览",
      });
    if (path === "/api/routing/hiddify")
      return reply(
        { error: "第 6 条规则的 GEOIP 不能直接导入 Hiddify 原生规则" },
        422,
      );
    return reply({ error: "未预期的 API 请求" }, 500);
  });
  await page.goto("/admin/#/routing");
  await expect(
    page.getByRole("heading", { name: "分流设置", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("使用仓库默认配置", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加策略组" }).click();
  await page.getByLabel("名称", { exact: true }).fill("自建专用");
  await page.getByLabel("自建测试源（手动节点）", { exact: false }).check();
  await page.getByRole("button", { name: "添加规则", exact: true }).click();
  await page.getByLabel("规则 7 内容", { exact: true }).fill("github.com");
  const groupId = await page
    .getByLabel("规则 7 动作", { exact: true })
    .locator("option")
    .last()
    .getAttribute("value");
  await page.getByLabel("规则 7 动作", { exact: true }).selectOption(groupId!);
  await page.getByRole("button", { name: "上移规则 7", exact: true }).click();
  await expect(page.getByLabel("规则 6 内容", { exact: true })).toHaveValue(
    "github.com",
  );
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    page.getByText("已保存的全局配置", { exact: true }),
  ).toBeVisible();
  expect(config.groups[0].sourceIds).toEqual([1]);
  expect(config.rules[5]).toMatchObject({
    value: "github.com",
    target: groupId,
  });
  // 从接口重新读取保存值，而不是仅停留在当前 DOM。
  await page.reload();
  await expect(page.getByLabel("规则 6 内容", { exact: true })).toHaveValue(
    "github.com",
  );
  await page.getByLabel("预览域名").fill("ads.example.org");
  await page.getByRole("button", { name: "预览匹配", exact: true }).click();
  await expect(page.getByText(/域名匹配第 1 条 → 拦截/)).toBeVisible();
  await page.getByText("编辑 JSON 草稿", { exact: true }).click();
  await page.getByLabel("分流配置 JSON").fill("{bad json");
  await page.getByRole("button", { name: "应用 JSON 到表单" }).click();
  await expect(page.getByRole("alert")).toHaveText("JSON 语法无效");
  await page
    .getByLabel("分流配置 JSON")
    .fill(JSON.stringify({ ...config, final: "REJECT" }));
  await page.getByRole("button", { name: "应用 JSON 到表单" }).click();
  await expect(page.getByLabel("兜底动作", { exact: true })).toHaveValue(
    "REJECT",
  );
  failSave = true;
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("测试保存失败");
  expect(config.final).toBe("PROXY");
  failSave = false;
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出配置 JSON" }).click();
  expect((await downloading).suggestedFilename()).toBe("routing.json");
  await page.getByRole("button", { name: "导出 Hiddify 规则" }).click();
  await expect(page.getByRole("alert")).toContainText("GEOIP");
  const bounds = await page
    .locator("html")
    .evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
    }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  await expect(page.locator(".routing-rule select").first()).toHaveCSS(
    "background-color",
    "rgb(30, 34, 43)",
  );
  await page.screenshot({
    path: test.info().outputPath("routing.png"),
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(
    page.getByText("使用仓库默认配置", { exact: true }),
  ).toBeVisible();
  expect(config).toEqual(defaults);
  expect(errors).toEqual([]);
});

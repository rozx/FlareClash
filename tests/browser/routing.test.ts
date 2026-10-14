import { test, expect, type Page } from "@playwright/test";
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

/** 内存版 API：校验时把含 "!" 的规则内容当作非法，预览按域名后缀匹配。 */
async function mockApi(page: Page) {
  const state = {
    config: structuredClone(defaults) as any,
    origin: "default",
    failSave: false,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    const invalid = (config: any) => {
      const i = config.rules.findIndex((r: any) => r.value.includes("!"));
      return i < 0 ? null : `第 ${i + 1} 条规则：域名格式无效`;
    };
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
        if (state.failSave) return reply({ error: "测试保存失败" }, 500);
        state.config = route.request().postDataJSON();
        state.origin = "saved";
      } else if (method === "DELETE") {
        state.config = structuredClone(defaults);
        state.origin = "default";
      }
      return reply({ config: state.config, origin: state.origin, defaults });
    }
    if (path === "/api/routing/validate") {
      const config = route.request().postDataJSON();
      const error = invalid(config);
      return error ? reply({ error }, 400) : reply({ config, hiddifyIssues: [] });
    }
    if (path === "/api/routing/preview") {
      const { config, domain } = route.request().postDataJSON();
      let uncertain = false;
      for (const [index, r] of config.rules.entries()) {
        if (!r.type.startsWith("DOMAIN")) {
          uncertain = true;
          continue;
        }
        if (domain === r.value || domain.endsWith(`.${r.value}`))
          return reply({ domain, index, target: r.target, uncertain, note: "" });
      }
      return reply({ domain, index: null, target: config.final, uncertain, note: "" });
    }
    if (path === "/api/routing/hiddify")
      return reply(
        { error: "第 6 条规则的 GEOIP 不能直接导入 Hiddify 原生规则" },
        422,
      );
    return reply({ error: "未预期的 API 请求" }, 500);
  });
  return state;
}

test("分流规则：批量添加、测试网址、节点组、保存与离开保护", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = await mockApi(page);
  await page.goto("/admin/#/routing");
  await expect(page.getByRole("heading", { name: "分流规则", exact: true })).toBeVisible();
  await expect(page.getByText("默认规则", { exact: true })).toBeVisible();
  // 没有修改时不显示保存栏
  await expect(page.getByRole("button", { name: "保存配置" })).toBeHidden();

  // 批量添加：完整网址取域名、域名、IP 段，插到最前
  const addBox = page.getByLabel("要添加的网址、域名或 IP 段");
  await addBox.fill("https://chat.openai.com/c/1\nopenai.com, 10.8.0.0/16");
  await page.getByRole("button", { name: "添加到最前" }).click();
  await expect(page.getByLabel("规则 1 内容", { exact: true })).toHaveValue("chat.openai.com");
  await expect(page.getByLabel("规则 2 内容", { exact: true })).toHaveValue("openai.com");
  await expect(page.getByLabel("规则 3 内容", { exact: true })).toHaveValue("10.8.0.0/16");
  await expect(page.getByLabel("规则 3 类型", { exact: true })).toHaveValue("IP-CIDR");
  await expect(page.getByLabel("规则 4 内容", { exact: true })).toHaveValue("local");
  await expect(addBox).toHaveValue("");
  await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();

  // 重复项跳过；无效项逐项报错且不改动草稿
  await addBox.fill("openai.com");
  await page.getByRole("button", { name: "添加到最前" }).click();
  await expect(page.getByText("这些规则已经存在，未添加")).toBeVisible();
  await addBox.fill("good.example.com bad!");
  await page.getByRole("button", { name: "添加到最前" }).click();
  await expect(page.getByText("「bad!」：域名格式无效")).toBeVisible();
  await expect(page.getByLabel("规则 1 内容", { exact: true })).toHaveValue("chat.openai.com");

  // 测试网址：接受完整网址并高亮命中的规则行
  await page.getByLabel("预览域名").fill("https://api.openai.com/v1");
  await page.getByRole("button", { name: "预览匹配", exact: true }).click();
  await expect(page.getByText("api.openai.com → 代理")).toBeVisible();
  await expect(page.locator('.rule-row[data-index="1"]')).toHaveClass(/is-hit/);
  await page.getByLabel("预览域名").fill("example.org");
  await page.getByRole("button", { name: "预览匹配", exact: true }).click();
  await expect(page.getByText("未命中任何规则，按兜底处理", { exact: false })).toBeVisible();
  await expect(page.locator('.rule-row[data-index="final"]')).toHaveClass(/is-hit/);

  // 调整顺序
  await page.getByRole("button", { name: "下移规则 1", exact: true }).click();
  await expect(page.getByLabel("规则 2 内容", { exact: true })).toHaveValue("chat.openai.com");

  // 节点组：未勾选源时保存被拦下，勾选后可作为规则去向
  await page.getByText("节点组（0）").click();
  await page.getByRole("button", { name: "新建节点组" }).click();
  await page.getByLabel("名称", { exact: true }).fill("自建专用");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByText("节点组「自建专用」还没有勾选任何源")).toBeVisible();
  await page.getByLabel("自建测试源（手动节点）", { exact: false }).check();
  const groupId = await page
    .getByLabel("规则 2 动作", { exact: true })
    .locator("option")
    .last()
    .getAttribute("value");
  await page.getByLabel("规则 2 动作", { exact: true }).selectOption(groupId!);
  await expect(page.getByText("被 1 条规则使用")).toBeVisible();

  // 未保存时切换页面：取消则留在本页且草稿不变
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "源管理" }).click();
  await expect(page).toHaveURL(/#\/routing$/);
  await expect(page.getByLabel("规则 2 内容", { exact: true })).toHaveValue("chat.openai.com");

  // 保存
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByText("已保存的自定义规则", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存配置" })).toBeHidden();
  expect(state.config.groups[0].sourceIds).toEqual([1]);
  expect(state.config.rules[1]).toMatchObject({
    type: "DOMAIN-SUFFIX",
    value: "chat.openai.com",
    target: groupId,
  });
  // 从接口重新读取保存值，而不是仅停留在当前 DOM。
  await page.reload();
  await expect(page.getByLabel("规则 2 内容", { exact: true })).toHaveValue("chat.openai.com");

  // 高级：JSON 编辑与导出
  await page.getByText("备份与导出", { exact: true }).click();
  await page.getByText("直接编辑 JSON", { exact: true }).click();
  await page.getByLabel("分流配置 JSON").fill("{bad json");
  await page.getByRole("button", { name: "应用 JSON 到表单" }).click();
  await expect(page.getByText("JSON 语法无效")).toBeVisible();
  await page
    .getByLabel("分流配置 JSON")
    .fill(JSON.stringify({ ...state.config, final: "REJECT" }));
  await page.getByRole("button", { name: "应用 JSON 到表单" }).click();
  await expect(page.getByLabel("兜底动作", { exact: true })).toHaveValue("REJECT");
  state.failSave = true;
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByText("测试保存失败")).toBeVisible();
  expect(state.config.final).toBe("PROXY");
  state.failSave = false;
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出配置 JSON" }).click();
  expect((await downloading).suggestedFilename()).toBe("routing.json");
  await page.getByRole("button", { name: "导出 Hiddify 规则" }).click();
  await expect(page.getByText(/GEOIP 不能直接导入/)).toBeVisible();

  // 窄屏不出现横向滚动，深色控件
  const bounds = await page
    .locator("html")
    .evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  await expect(page.locator(".rule-row select").first()).toHaveCSS(
    "background-color",
    "rgb(30, 34, 43)",
  );
  await page.screenshot({ path: test.info().outputPath("routing.png"), fullPage: true });

  // 撤销修改回到已保存版本；恢复默认
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "撤销修改" }).click();
  await expect(page.getByLabel("兜底动作", { exact: true })).toHaveValue("PROXY");
  // 折叠状态跨重绘保留：「备份与导出」仍展开
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(page.getByText("默认规则", { exact: true })).toBeVisible();
  expect(state.config).toEqual(defaults);
  expect(errors).toEqual([]);
});

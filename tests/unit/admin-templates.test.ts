import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../public/admin/templates.js";
import { parseRoutingConfig } from "../../src/lib/routing";

describe("常用服务模板", () => {
  it("ID 唯一、名称可作备注，且至少一条规则", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeLessThanOrEqual(64);
      expect(t.rules.length).toBeGreaterThan(0);
    }
  });

  it("每条规则都能原样通过服务端校验（一键添加不会报错）", () => {
    for (const t of TEMPLATES) {
      const rules = t.rules.map((r) => ({ ...r, target: t.suggested, note: t.name }));
      const parsed = parseRoutingConfig({ version: 1, groups: [], rules, final: "PROXY" });
      // 规范化后值不变：前端用它判断「已添加」
      expect(parsed.rules.map((r) => r.value), t.id).toEqual(t.rules.map((r) => r.value));
    }
  });

  it("模板内无重复规则", () => {
    for (const t of TEMPLATES) {
      const keys = t.rules.map((r) => `${r.type} ${r.value}`);
      expect(new Set(keys).size, t.id).toBe(keys.length);
    }
  });
});

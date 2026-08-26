import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildClashConfig } from "../../src/lib/clash-render";
import type { Proxy } from "../../src/lib/types";

const n = (name: string): Proxy => ({
  name,
  type: "ss",
  server: `${name}.example.com`,
  port: 443,
  cipher: "aes-128-gcm",
  password: "x",
});

interface Config {
  proxies?: Proxy[];
  "proxy-groups"?: { name: string; type: string; proxies: string[] }[];
  rules?: string[];
}

function parseConfig(yaml: string): Config {
  return parseYaml(yaml) as Config;
}

describe("buildClashConfig", () => {
  const nodes = [
    n("香港 01"),
    n("HK-02"),
    n("台湾 01"),
    n("JP Tokyo"),
    n("新加坡 SG"),
    n("US West"),
    n("Germany 01"),
    n("神秘节点"),
  ];
  const yaml = buildClashConfig(nodes);
  const cfg = parseConfig(yaml);

  it("输出含 proxies / proxy-groups / rules 三段", () => {
    expect(cfg.proxies).toHaveLength(8);
    expect(cfg["proxy-groups"]!.length).toBeGreaterThan(0);
    expect(cfg.rules!.length).toBeGreaterThan(0);
    expect(cfg.rules!.at(-1)).toBe("MATCH,🚀 节点选择");
  });

  it("地区分组：成员是节点名子集，空地区不出组", () => {
    const groups = new Map(cfg["proxy-groups"]!.map((g) => [g.name, g]));
    expect(groups.get("🇭🇰 香港")!.proxies).toEqual(["香港 01", "HK-02"]);
    expect(groups.get("🇯🇵 日本")!.proxies).toEqual(["JP Tokyo"]);
    expect(groups.get("🇪🇺 欧洲")!.proxies).toEqual(["Germany 01"]);
    // 没有英国单列（并入欧洲）
    expect(groups.has("🇬🇧 英国")).toBe(false);
    expect(groups.get("🌐 其余节点")!.proxies).toEqual(["神秘节点"]);
  });

  it("所有组引用均有效（节点名或其他组名或 DIRECT）", () => {
    const nodeNames = new Set(cfg.proxies!.map((p) => p.name));
    const groupNames = new Set(cfg["proxy-groups"]!.map((g) => g.name));
    for (const g of cfg["proxy-groups"]!) {
      expect(g.proxies.length, `组 ${g.name} 不能为空`).toBeGreaterThan(0);
      for (const ref of g.proxies) {
        const ok =
          nodeNames.has(ref) || groupNames.has(ref) || ref === "DIRECT";
        expect(ok, `组 ${g.name} 引用了无效目标 ${ref}`).toBe(true);
      }
    }
  });

  it("节点选择组含自动选择、各地区组与 DIRECT", () => {
    const select = cfg["proxy-groups"]!.find((g) => g.name === "🚀 节点选择")!;
    expect(select.proxies[0]).toBe("♻️ 自动选择");
    expect(select.proxies).toContain("🇭🇰 香港");
    expect(select.proxies).toContain("🌐 其余节点");
    expect(select.proxies.at(-1)).toBe("DIRECT");
  });

  it("自动选择组含全部节点", () => {
    const auto = cfg["proxy-groups"]!.find((g) => g.name === "♻️ 自动选择")!;
    expect(auto.proxies).toHaveLength(8);
  });

  it("空节点列表也能输出（组仅剩选择组与 DIRECT）", () => {
    const cfg0 = parseConfig(buildClashConfig([]));
    const auto = cfg0["proxy-groups"]!.find((g) => g.name === "♻️ 自动选择");
    expect(auto).toBeUndefined();
    const select = cfg0["proxy-groups"]!.find((g) => g.name === "🚀 节点选择")!;
    expect(select.proxies).toEqual(["DIRECT"]);
  });
});

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildClashConfig } from "../../src/lib/clash-render";
import { buildHiddifyRules, hiddifyIssues } from "../../src/lib/hiddify-rules";
import {
  clashRules,
  parseRoutingConfig,
  previewDomain,
  ruleProviders,
} from "../../src/lib/routing";
import { RULESETS } from "../../src/lib/rulesets";
import type { Proxy } from "../../src/lib/types";

const base = { version: 1, groups: [], rules: [], final: "PROXY" };
const node = (name: string): Proxy => ({
  name,
  type: "ss",
  server: "s.example.com",
  port: 443,
  cipher: "aes-128-gcm",
  password: "x",
});
const sample = () =>
  parseRoutingConfig({
    ...base,
    rules: [
      { type: "RULE-SET", value: "reject", target: "REJECT", note: " 广告 " },
      { type: "DOMAIN-SUFFIX", value: "openai.com", target: "region:us", note: "  " },
      { type: "DOMAIN-SUFFIX", value: "example.org", target: "region:hk" },
    ],
  });

describe("分流配置：远程规则集、地区去向、备注", () => {
  it("接受目录内规则集、地区去向与备注；空白备注省略", () => {
    const config = sample();
    expect(config.rules).toEqual([
      { type: "RULE-SET", value: "reject", target: "REJECT", note: "广告" },
      { type: "DOMAIN-SUFFIX", value: "openai.com", target: "region:us" },
      { type: "DOMAIN-SUFFIX", value: "example.org", target: "region:hk" },
    ]);
    expect(parseRoutingConfig({ ...base, final: "region:jp" }).final).toBe("region:jp");
  });

  it("拒绝未知规则集、未知地区与过长备注", () => {
    const rule = (r: object) => () =>
      parseRoutingConfig({
        ...base,
        rules: [{ type: "DOMAIN", value: "a.com", target: "PROXY", ...r }],
      });
    expect(rule({ type: "RULE-SET", value: "nope" })).toThrow("规则集不存在");
    expect(rule({ target: "region:mars" })).toThrow("规则目标不存在");
    expect(rule({ note: "x".repeat(65) })).toThrow("备注");
    expect(rule({ note: "a\nb" })).toThrow("备注");
  });

  it("Clash 规则行：RULE-SET、地区映射，缺地区组时回退节点选择，备注不输出", () => {
    const config = sample();
    expect(clashRules(config, new Set(["us", "hk"]))).toEqual([
      "RULE-SET,reject,REJECT",
      "DOMAIN-SUFFIX,openai.com,🇺🇸 美国",
      "DOMAIN-SUFFIX,example.org,🇭🇰 香港",
      "MATCH,🚀 节点选择",
    ]);
    expect(clashRules(config, new Set(["hk"]))[1]).toBe(
      "DOMAIN-SUFFIX,openai.com,🚀 节点选择",
    );
  });

  it("rule-providers 只包含被引用的规则集", () => {
    const reject = RULESETS.find((r) => r.id === "reject")!;
    expect(ruleProviders(sample())).toEqual({
      reject: {
        type: "http",
        behavior: "domain",
        url: reject.url,
        path: "./ruleset/reject.yaml",
        interval: 86400,
      },
    });
    expect(ruleProviders(parseRoutingConfig(base))).toEqual({});
  });

  it("完整 Clash 配置：输出 rule-providers，地区去向按实际生成的地区组映射", () => {
    const doc = parseYaml(buildClashConfig([node("US 01")], sample())) as any;
    expect(Object.keys(doc["rule-providers"])).toEqual(["reject"]);
    expect(doc.rules).toEqual([
      "RULE-SET,reject,REJECT",
      "DOMAIN-SUFFIX,openai.com,🇺🇸 美国",
      "DOMAIN-SUFFIX,example.org,🚀 节点选择",
      "MATCH,🚀 节点选择",
    ]);
    const plain = parseYaml(buildClashConfig([node("US 01")])) as any;
    expect(plain["rule-providers"]).toBeUndefined();
  });

  it("兜底指向地区：无该地区节点时同样回退", () => {
    const config = parseRoutingConfig({ ...base, final: "region:jp" });
    const doc = parseYaml(buildClashConfig([node("US 01")], config)) as any;
    expect(doc.rules.at(-1)).toBe("MATCH,🚀 节点选择");
    const jp = parseYaml(buildClashConfig([node("JP 01")], config)) as any;
    expect(jp.rules.at(-1)).toBe("MATCH,🇯🇵 日本");
  });

  it("Hiddify：拒绝规则集与地区去向；备注作为规则名", () => {
    expect(hiddifyIssues(sample())).toEqual([
      "第 1 条规则使用远程规则集，Hiddify 原生规则无法引用",
      "第 2 条规则指向地区组，Hiddify 只支持代理/直连/拦截",
      "第 3 条规则指向地区组，Hiddify 只支持代理/直连/拦截",
    ]);
    const exported = buildHiddifyRules(
      parseRoutingConfig({
        ...base,
        rules: [{ type: "DOMAIN", value: "a.com", target: "DIRECT", note: "ChatGPT" }],
      }),
    );
    expect(exported["1"][0]!["3"]).toBe("ChatGPT");
  });

  it("域名预览：前置规则集使结果不确定", () => {
    const r = previewDomain(sample(), "chat.openai.com");
    expect(r).toMatchObject({ index: 1, target: "region:us", uncertain: true });
  });

  it("规则集目录：ID 唯一，指向 Loyalsoldier release，建议去向合法", () => {
    const ids = RULESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULESETS) {
      expect(r.url).toBe(
        `https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/${r.id}.txt`,
      );
      expect(["domain", "ipcidr", "classical"]).toContain(r.behavior);
      expect(["PROXY", "DIRECT", "REJECT"]).toContain(r.suggested);
    }
  });
});

import { describe, expect, it } from "vitest";
import { parseClash } from "../../src/lib/clash-parse";

const VALID_YAML = `
proxies:
  - name: "HK-01"
    type: ss
    server: hk.example.com
    port: 443
    cipher: aes-128-gcm
    password: "pass"
  - name: "JP-01"
    type: trojan
    server: jp.example.com
    port: 8443
    password: "tj"
    sni: jp.example.com
proxy-groups: []
rules: []
`;

describe("parseClash", () => {
  it("解析正常 YAML，提取 proxies", () => {
    const r = parseClash(VALID_YAML);
    expect("error" in r && r.error).toBeFalsy();
    if (!("error" in r)) {
      expect(r.proxies).toHaveLength(2);
      expect(r.proxies[0]).toMatchObject({
        name: "HK-01",
        type: "ss",
        port: 443,
      });
      expect(r.proxies[1]).toMatchObject({
        name: "JP-01",
        type: "trojan",
        sni: "jp.example.com",
      });
      expect(r.skipped).toBe(0);
    }
  });

  it("缺少 proxies 数组时报错", () => {
    expect(parseClash("port: 7890\nmode: rule\n")).toEqual({
      error: "缺少 proxies 数组",
    });
    expect(parseClash("just a string")).toEqual({
      error: "YAML 根节点不是对象",
    });
  });

  it("非法节点被跳过，合法节点保留", () => {
    const r = parseClash(`
proxies:
  - name: ok
    type: ss
    server: a.com
    port: 1
  - name: no-port
    type: ss
    server: a.com
  - "not an object"
`);
    if ("error" in r) throw new Error(r.error);
    expect(r.proxies.map((p) => p.name)).toEqual(["ok"]);
    expect(r.skipped).toBe(2);
  });

  it("YAML 语法错误报错", () => {
    const r = parseClash("proxies: [unclosed");
    expect("error" in r).toBe(true);
  });

  it("全部节点非法时报错", () => {
    const r = parseClash("proxies:\n  - name: bad\n    type: ss\n");
    expect("error" in r).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { b64Encode } from "../../src/lib/b64";
import { detectFormat } from "../../src/lib/detect";

const CLASH_YAML = `
proxies:
  - name: "HK-01"
    type: ss
    server: hk.example.com
    port: 443
    cipher: aes-128-gcm
    password: "pass"
`;

const LINKS = [
  "ss://YWVzLTEyOC1nY206cGFzcw@hk.example.com:8388#hk",
  "trojan://pw@us.example.com:443#us",
].join("\n");

describe("detectFormat", () => {
  it("识别 Clash YAML 并报告节点数", () => {
    const r = detectFormat(CLASH_YAML);
    expect(r).toMatchObject({ format: "clash", skipped: 0 });
    if (!("error" in r)) expect(r.proxies).toHaveLength(1);
  });

  it("识别 base64 链接集合并报告节点数", () => {
    const r = detectFormat(b64Encode(LINKS));
    expect(r).toMatchObject({ format: "base64", skipped: 0 });
    if (!("error" in r)) expect(r.proxies).toHaveLength(2);
  });

  it("识别明文链接集合", () => {
    expect(detectFormat(LINKS)).toMatchObject({ format: "base64" });
  });

  it("HTML 错误页报错且带原因", () => {
    const r = detectFormat("<html><body><h1>403 Forbidden</h1></body></html>");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("Clash YAML");
  });

  it("空内容报错", () => {
    expect(detectFormat("   ")).toEqual({ error: "内容为空" });
  });

  it("无 proxies 的 YAML（如纯配置）报错", () => {
    expect("error" in detectFormat("port: 7890\nsocks-port: 7891\n")).toBe(
      true,
    );
  });
});

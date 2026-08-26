import { describe, expect, it } from "vitest";
import { renderBase64Sub } from "../../src/lib/base64-render";
import { b64Decode } from "../../src/lib/b64";
import { parseBase64Sub, parseShareLink } from "../../src/lib/link-parse";
import type { Proxy } from "../../src/lib/types";

const ss = (name: string): Proxy => ({
  name,
  type: "ss",
  server: `${name}.example.com`,
  port: 443,
  cipher: "aes-128-gcm",
  password: "pw",
});

const vmessLink = parseShareLink(
  "vmess://eyJ2IjoiMiIsInBzIjoibWUiLCJhZGQiOiJ2LmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjEyMyIsIm5ldCI6InRjcCJ9",
)!;

describe("renderBase64Sub", () => {
  it("可被解析器无损读回", () => {
    const input = [ss("节点A"), vmessLink, ss("节点B")];
    const r = renderBase64Sub(input);
    expect(r.skipped).toBe(0);
    expect(r.links).toBe(3);
    const back = parseBase64Sub(r.content);
    expect(back.proxies).toEqual(input);
    expect(back.skipped).toBe(0);
  });

  it("不可逆类型跳过并计数", () => {
    const socks: Proxy = {
      name: "s5",
      type: "socks5",
      server: "a.com",
      port: 1080,
    };
    const r = renderBase64Sub([ss("ok1"), socks, ss("ok2")]);
    expect(r.links).toBe(2);
    expect(r.skipped).toBe(1);
    const back = parseBase64Sub(r.content);
    expect(back.proxies.map((p) => p.name)).toEqual(["ok1", "ok2"]);
  });

  it("输出确实是 base64 包装的逐行链接", () => {
    const r = renderBase64Sub([ss("x")]);
    const text = b64Decode(r.content)!;
    expect(text.startsWith("ss://")).toBe(true);
    expect(text).not.toContain("\n");
  });
});

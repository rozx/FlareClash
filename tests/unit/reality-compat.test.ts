import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildClashConfig } from "../../src/lib/clash-render";
import { parseShareLink } from "../../src/lib/link-parse";
import type { Proxy } from "../../src/lib/types";

const REALITY_LINK =
  "vless://11111111-2222-4333-8444-555555555555@reality.example.test:8443?security=reality&encryption=none&flow=xtls-rprx-vision&sni=target.example.test&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=0123456789abcdef#Reality";

describe("分享链接解析 → Clash YAML 的 Reality 兼容性", () => {
  it("为 Reality + Vision 输出混合密钥交换开关并保留认证参数", () => {
    const proxy = parseShareLink(REALITY_LINK)!;
    expect(proxy).not.toBeNull();
    const config = parseYaml(buildClashConfig([proxy])) as { proxies: Proxy[] };
    expect(config.proxies[0]).toMatchObject({
      type: "vless",
      tls: true,
      flow: "xtls-rprx-vision",
      servername: "target.example.test",
      "client-fingerprint": "chrome",
      "reality-opts": {
        "public-key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "short-id": "0123456789abcdef",
        "support-x25519mlkem768": true,
      },
    });
  });

  it.each([
    ["security=tls", true],
    ["security=none", undefined],
    ["", undefined],
  ])("非 Reality 链接不新增兼容选项：%s", (query, expectedTls) => {
    const proxy = parseShareLink(
      `vless://11111111-2222-4333-8444-555555555555@proxy.example.test:443?${query}#普通节点`,
    )!;
    const config = parseYaml(buildClashConfig([proxy])) as { proxies: Proxy[] };
    expect(config.proxies).toHaveLength(1);
    const rendered = config.proxies[0]!;
    expect(rendered["reality-opts"]).toBeUndefined();
    expect(rendered.tls).toBe(expectedTls);
  });

  it("渲染不覆盖调用方显式指定的兼容选项", () => {
    const proxy = parseShareLink(REALITY_LINK)!;
    proxy["reality-opts"] = {
      "public-key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "short-id": "0123456789abcdef",
      "support-x25519mlkem768": false,
    };
    const config = parseYaml(buildClashConfig([proxy])) as { proxies: Proxy[] };
    expect(config.proxies).toHaveLength(1);
    expect(config.proxies[0]!["reality-opts"]).toMatchObject({
      "support-x25519mlkem768": false,
    });
  });
});

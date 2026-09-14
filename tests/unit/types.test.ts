import { describe, expect, it } from "vitest";
import { isProxy, REVERSIBLE_TYPES } from "../../src/lib/types";

describe("isProxy 类型守卫", () => {
  it("接受合法节点", () => {
    expect(
      isProxy({
        name: "HK-01",
        type: "ss",
        server: "a.com",
        port: 443,
        cipher: "aes-128-gcm",
      }),
    ).toBe(true);
    // 端口边界
    expect(isProxy({ name: "x", type: "vmess", server: "a", port: 1 })).toBe(
      true,
    );
    expect(
      isProxy({ name: "x", type: "vmess", server: "a", port: 65535 }),
    ).toBe(true);
    // 未知协议但结构合法（Clash 生态透传）
    expect(
      isProxy({ name: "x", type: "wireguard", server: "a", port: 51820 }),
    ).toBe(true);
  });

  it("拒绝非法节点", () => {
    expect(isProxy(null)).toBe(false);
    expect(isProxy("string")).toBe(false);
    expect(isProxy({})).toBe(false);
    expect(isProxy({ name: "", type: "ss", server: "a", port: 1 })).toBe(false);
    expect(isProxy({ name: "x", type: "", server: "a", port: 1 })).toBe(false);
    expect(isProxy({ name: "x", type: "ss", server: "", port: 1 })).toBe(false);
    expect(isProxy({ name: "x", type: "ss", server: "a", port: 0 })).toBe(
      false,
    );
    expect(isProxy({ name: "x", type: "ss", server: "a", port: 65536 })).toBe(
      false,
    );
    expect(isProxy({ name: "x", type: "ss", server: "a", port: 1.5 })).toBe(
      false,
    );
    expect(isProxy({ name: "x", type: "ss", server: "a", port: "443" })).toBe(
      false,
    );
  });

  it("可逆向类型集合", () => {
    expect([...REVERSIBLE_TYPES].sort()).toEqual([
      "hysteria2",
      "ss",
      "trojan",
      "vless",
      "vmess",
    ]);
  });
});

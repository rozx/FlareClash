import { describe, expect, it } from "vitest";
import {
  clientKey,
  configWarnings,
  GLOBAL_POLICY,
  IP_POLICY,
  lockDurationMs,
  retryAfterSeconds,
} from "../../src/lib/login-throttle";
import { passwordMatches, verifySession } from "../../src/auth";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("clientKey", () => {
  it("IPv4 原样", () => {
    expect(clientKey("203.0.113.7")).toBe("ip:203.0.113.7");
  });

  it("IPv6 归并到 /64", () => {
    expect(clientKey("2001:db8:1:2::1")).toBe("ip:2001:db8:1:2::/64");
    expect(clientKey("2001:0db8:0001:0002:ffff:1:2:3")).toBe(
      "ip:2001:db8:1:2::/64",
    );
    expect(clientKey("2001:DB8:1:2:a::b")).toBe("ip:2001:db8:1:2::/64");
  });

  it("压缩位于前缀内的 IPv6 正确展开", () => {
    expect(clientKey("2001:db8::1")).toBe("ip:2001:db8:0:0::/64");
    expect(clientKey("::1")).toBe("ip:0:0:0:0::/64");
  });

  it("IPv4 映射地址按 IPv4 处理", () => {
    expect(clientKey("::ffff:198.51.100.4")).toBe("ip:198.51.100.4");
  });

  it("缺失或畸形 → unknown", () => {
    expect(clientKey(null)).toBe("ip:unknown");
    expect(clientKey("")).toBe("ip:unknown");
    expect(clientKey("not an ip")).toBe("ip:unknown");
  });
});

describe("lockDurationMs", () => {
  it("单 IP 逐次翻倍，上限 24 小时", () => {
    expect(lockDurationMs(0, IP_POLICY)).toBe(15 * MIN);
    expect(lockDurationMs(1, IP_POLICY)).toBe(30 * MIN);
    expect(lockDurationMs(2, IP_POLICY)).toBe(60 * MIN);
    expect(lockDurationMs(7, IP_POLICY)).toBe(24 * HOUR);
    expect(lockDurationMs(1000, IP_POLICY)).toBe(24 * HOUR);
  });

  it("全局固定 1 小时", () => {
    expect(lockDurationMs(0, GLOBAL_POLICY)).toBe(HOUR);
    expect(lockDurationMs(5, GLOBAL_POLICY)).toBe(HOUR);
  });
});

describe("retryAfterSeconds", () => {
  it("向上取整且至少 1 秒", () => {
    expect(retryAfterSeconds(10_500, 10_000)).toBe(1);
    expect(retryAfterSeconds(10_000 + 15 * MIN, 10_000)).toBe(900);
    expect(retryAfterSeconds(10_000, 10_000)).toBe(1);
  });
});

describe("configWarnings", () => {
  it("强配置无提示", () => {
    expect(
      configWarnings({ ADMIN_PASSWORD: "x".repeat(16), AUTH_SECRET: "s" }),
    ).toEqual([]);
  });

  it("短密码与缺 AUTH_SECRET 各一条", () => {
    expect(configWarnings({ ADMIN_PASSWORD: "short" })).toHaveLength(2);
    expect(
      configWarnings({ ADMIN_PASSWORD: "short", AUTH_SECRET: "s" }),
    ).toHaveLength(1);
  });
});

describe("passwordMatches", () => {
  it("相等才通过，长度不同不抛错", async () => {
    expect(await passwordMatches("abc", "abc")).toBe(true);
    expect(await passwordMatches("abd", "abc")).toBe(false);
    expect(await passwordMatches("", "abc")).toBe(false);
    expect(await passwordMatches("abcdef", "abc")).toBe(false);
  });
});

describe("verifySession 畸形签名", () => {
  it("非 base64 签名返回 false 而非抛错", async () => {
    await expect(
      verifySession(`${Date.now() + 60_000}.!!!`, { adminPassword: "pw" }),
    ).resolves.toBe(false);
  });
});

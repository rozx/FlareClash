import {
  createExecutionContext,
  env,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import { ensureSchema } from "./schema";

const GOOD = "test-admin-pass";

async function call(path: string, init: RequestInit, bindings: object = env) {
  const ctx = createExecutionContext();
  const r = await app.request(path, init, bindings, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}

function login(password: string, ip?: string, bindings: object = env) {
  return call(
    "/api/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ip ? { "CF-Connecting-IP": ip } : {}),
      },
      body: JSON.stringify({ password }),
    },
    bindings,
  );
}

async function failTimes(n: number, ip: string) {
  for (let i = 0; i < n; i++) {
    const r = await login("wrong", ip);
    expect(r.status).toBe(401);
  }
}

async function attemptRows() {
  const { results } = await env.DB.prepare(
    "SELECT * FROM login_attempts ORDER BY key",
  ).all();
  return results;
}

beforeEach(async () => {
  await reset();
  await ensureSchema();
});

describe("登录防爆破：单 IP", () => {
  it("5 次失败后锁定，正确密码也 429，其他 IP 不受影响", async () => {
    await failTimes(5, "203.0.113.1");
    const locked = await login(GOOD, "203.0.113.1");
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Set-Cookie")).toBeNull();
    const retry = Number(locked.headers.get("Retry-After"));
    expect(retry).toBeGreaterThan(890);
    expect(retry).toBeLessThanOrEqual(900);

    const other = await login(GOOD, "203.0.113.2");
    expect(other.status).toBe(200);
  });

  it("IPv6 同一 /64 共享计数", async () => {
    for (let i = 1; i <= 5; i++) {
      const r = await login("wrong", `2001:db8:1:2::${i}`);
      expect(r.status).toBe(401);
    }
    expect((await login(GOOD, "2001:db8:1:2:ffff::9")).status).toBe(429);
    expect((await login(GOOD, "2001:db8:1:3::1")).status).toBe(200);
  });

  it("锁定期满后再次触发，时长翻倍", async () => {
    await failTimes(5, "203.0.113.1");
    await env.DB.prepare(
      "UPDATE login_attempts SET locked_until = ? WHERE key = 'ip:203.0.113.1'",
    )
      .bind(Date.now() - 1)
      .run();

    await failTimes(5, "203.0.113.1");
    const locked = await login(GOOD, "203.0.113.1");
    expect(locked.status).toBe(429);
    const retry = Number(locked.headers.get("Retry-After"));
    expect(retry).toBeGreaterThan(1790);
    expect(retry).toBeLessThanOrEqual(1800);
  });

  it("登录成功清零该 IP 计数", async () => {
    await failTimes(4, "203.0.113.1");
    expect((await login(GOOD, "203.0.113.1")).status).toBe(200);
    await failTimes(4, "203.0.113.1");
    expect((await login(GOOD, "203.0.113.1")).status).toBe(200);
  });

  it("并发爆破至多 5 次进入比对", async () => {
    const rs = await Promise.all(
      Array.from({ length: 20 }, () => login("wrong", "203.0.113.1")),
    );
    const statuses = rs.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(
      15,
    );
    expect((await login(GOOD, "203.0.113.1")).status).toBe(429);
  });

  it("锁定期内请求零 D1 写入、零 KV 写入", async () => {
    await failTimes(5, "203.0.113.1");
    const before = await attemptRows();
    expect((await login(GOOD, "203.0.113.1")).status).toBe(429);
    expect((await login("wrong", "203.0.113.1")).status).toBe(429);
    expect(await attemptRows()).toEqual(before);
    expect((await env.KV.list()).keys).toHaveLength(0);
  });
});

describe("登录防爆破：全局", () => {
  it("累计 50 次失败后暂停登录，已有会话不受影响", async () => {
    const ok = await login(GOOD, "198.51.100.200");
    expect(ok.status).toBe(200);
    const cookie = (ok.headers.get("Set-Cookie") ?? "").split(";")[0]!;

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => failTimes(5, `198.51.100.${i}`)),
    );

    const blocked = await login(GOOD, "198.51.100.99");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(3500);

    const r = await call("/api/sources", { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
  });
});

describe("会话 cookie", () => {
  it("畸形签名 → 401 而非 500", async () => {
    const r = await call("/api/sources", {
      headers: { Cookie: `fc_session=${Date.now() + 60_000}.!!!` },
    });
    expect(r.status).toBe(401);
  });
});

describe("_ping 配置提示", () => {
  async function pingWith(bindings: object) {
    const ok = await login(
      (bindings as { ADMIN_PASSWORD: string }).ADMIN_PASSWORD,
      undefined,
      bindings,
    );
    expect(ok.status).toBe(200);
    const cookie = (ok.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const r = await call("/api/_ping", { headers: { Cookie: cookie } }, bindings);
    return ((await r.json()) as { warnings: string[] }).warnings;
  }

  it("强配置无提示", async () => {
    expect(
      await pingWith({ ...env, ADMIN_PASSWORD: "a-long-enough-password" }),
    ).toEqual([]);
  });

  it("短密码、缺 AUTH_SECRET 给出提示且不阻断登录", async () => {
    const warnings = await pingWith({
      ...env,
      ADMIN_PASSWORD: "short",
      AUTH_SECRET: undefined,
    });
    expect(warnings).toHaveLength(2);
  });
});

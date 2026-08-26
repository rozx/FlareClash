import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "../../src/auth";

const OPTS = { authSecret: "test-secret", adminPassword: "pw", now: 1_000_000 };

describe("签名会话", () => {
  it("签发 → 校验往返", async () => {
    const token = await signSession(OPTS);
    expect(await verifySession(token, OPTS)).toBe(true);
  });

  it("AUTH_SECRET 缺省时由 ADMIN_PASSWORD 派生", async () => {
    const token = await signSession({ adminPassword: "pw", now: OPTS.now });
    expect(
      await verifySession(token, { adminPassword: "pw", now: OPTS.now }),
    ).toBe(true);
    expect(
      await verifySession(token, { adminPassword: "other", now: OPTS.now }),
    ).toBe(false);
  });

  it("密钥不同 → 拒绝", async () => {
    const token = await signSession(OPTS);
    expect(await verifySession(token, { ...OPTS, authSecret: "evil" })).toBe(
      false,
    );
    // AUTH_SECRET 存在时密码不参与派生，换密码不影响校验
    expect(await verifySession(token, { ...OPTS, adminPassword: "evil" })).toBe(
      true,
    );
    expect(
      await verifySession(token, {
        ...OPTS,
        authSecret: undefined,
        adminPassword: "evil",
      }),
    ).toBe(false);
  });

  it("篡改 exp / 签名 → 拒绝", async () => {
    const token = await signSession(OPTS);
    const [exp, sig] = token.split(".");
    // 延长 exp
    expect(await verifySession(`${Number(exp) + 99999}.${sig}`, OPTS)).toBe(
      false,
    );
    // 换签名
    expect(await verifySession(`${exp}.${sig!.slice(0, -2)}xx`, OPTS)).toBe(
      false,
    );
    // 乱格式
    expect(await verifySession("garbage", OPTS)).toBe(false);
    expect(await verifySession("123.notaSignature!!", OPTS)).toBe(false);
    expect(await verifySession(undefined, OPTS)).toBe(false);
  });

  it("过期 → 拒绝", async () => {
    const token = await signSession({ ...OPTS, now: 0 });
    expect(
      await verifySession(token, { ...OPTS, now: 8 * 24 * 3600 * 1000 }),
    ).toBe(false);
  });
});

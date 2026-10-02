import { describe, expect, it } from "vitest";
import { b64Encode, b64UrlEncode } from "../../src/lib/b64";
import {
  parseBase64Sub,
  parseShareLink,
  toShareLink,
} from "../../src/lib/link-parse";
import type { Proxy } from "../../src/lib/types";

// ── 构造真实样例 ──────────────────────────────────────────────────

const VMESS_JSON = {
  v: "2",
  ps: "日本东京 01",
  add: "jp1.example.com",
  port: "443",
  id: "b831381d-6324-4d53-ad4f-8cda48b30811",
  aid: "0",
  scy: "auto",
  net: "ws",
  type: "none",
  host: "cdn.example.com",
  path: "/vmess",
  tls: "tls",
  sni: "jp1.example.com",
};
const VMESS_LINK = `vmess://${b64Encode(JSON.stringify(VMESS_JSON))}`;

const SS_USERINFO = b64UrlEncode("aes-128-gcm:pass:word"); // 密码含冒号
const SS_SIP002 = `ss://${SS_USERINFO}@hk.example.com:8388#%E9%A6%99%E6%B8%AF01`;
const SS_LEGACY = `ss://${b64Encode("aes-256-gcm:legacy@legacy.example.com:1234")}#legacy`;
const SS_PLUGIN = `ss://${b64UrlEncode("aes-128-gcm:p")}@hk.example.com:8388?plugin=${encodeURIComponent("simple-obfs;obfs=http;obfs-host=cdn.example.com")}#obfs`;

const TROJAN_LINK =
  "trojan://pass%40word@us.example.com:443?sni=us.example.com&type=ws&path=%2Ftrojan&host=cdn.example.com#%E7%BE%8E%E5%9B%BD01";

const HY2_LINK =
  "hysteria2://authpass@hk.example.com:443?sni=hk.example.com&insecure=1&obfs=salamander&obfs-password=ob123#%F0%9F%87%AD%F0%9F%87%B0";

const VLESS_REALITY_LINK =
  "vless://11111111-2222-4333-8444-555555555555@derp.example.com:8443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=0123456789abcdef&type=tcp#%F0%9F%87%AD%F0%9F%87%B0-Reality";
const VLESS_TLS_WS_LINK =
  "vless://b831381d-6324-4d53-ad4f-8cda48b30811@jp.example.com:443?encryption=none&security=tls&sni=jp.example.com&type=ws&path=%2Fvless&host=cdn.example.com#vless-ws";

// ── vmess ────────────────────────────────────────────────────────

describe("parseShareLink: vmess", () => {
  it("解析常见字段", () => {
    const p = parseShareLink(VMESS_LINK)!;
    expect(p).toBeTruthy();
    expect(p).toMatchObject({
      name: "日本东京 01",
      type: "vmess",
      server: "jp1.example.com",
      port: 443,
      uuid: "b831381d-6324-4d53-ad4f-8cda48b30811",
      alterId: 0,
      cipher: "auto",
      network: "ws",
      tls: true,
      servername: "jp1.example.com",
    });
    expect(p["ws-opts"]).toEqual({
      path: "/vmess",
      headers: { Host: "cdn.example.com" },
    });
  });

  it("缺 id / add / port 返回 null", () => {
    const bad = { ...VMESS_JSON, id: undefined };
    expect(
      parseShareLink(`vmess://${b64Encode(JSON.stringify(bad))}`),
    ).toBeNull();
    expect(parseShareLink(`vmess://${b64Encode("not json")}`)).toBeNull();
    expect(parseShareLink("vmess://!!!illegal-base64!!!")).toBeNull();
  });
});

// ── ss ───────────────────────────────────────────────────────────

describe("parseShareLink: ss", () => {
  it("SIP002：base64 userinfo + 密码含冒号", () => {
    const p = parseShareLink(SS_SIP002)!;
    expect(p).toMatchObject({
      name: "香港01",
      type: "ss",
      server: "hk.example.com",
      port: 8388,
      cipher: "aes-128-gcm",
      password: "pass:word",
    });
  });

  it("legacy：整体 base64", () => {
    const p = parseShareLink(SS_LEGACY)!;
    expect(p).toMatchObject({
      name: "legacy",
      type: "ss",
      server: "legacy.example.com",
      port: 1234,
      cipher: "aes-256-gcm",
      password: "legacy",
    });
  });

  it("plugin 透传", () => {
    const p = parseShareLink(SS_PLUGIN)!;
    expect(p.plugin).toBe("simple-obfs;obfs=http;obfs-host=cdn.example.com");
  });

  it("明文 userinfo（非 base64）也可解析", () => {
    const p = parseShareLink("ss://aes-128-gcm:plainpw@h.com:1#x")!;
    expect(p).toMatchObject({
      cipher: "aes-128-gcm",
      password: "plainpw",
      port: 1,
    });
  });

  it("非法输入返回 null", () => {
    expect(parseShareLink("ss://no-at-no-b64#x")).toBeNull();
    expect(parseShareLink("ss://:@:0#x")).toBeNull();
  });
});

// ── trojan / hysteria2 ───────────────────────────────────────────

describe("parseShareLink: trojan", () => {
  it("解析常见字段", () => {
    const p = parseShareLink(TROJAN_LINK)!;
    expect(p).toMatchObject({
      name: "美国01",
      type: "trojan",
      server: "us.example.com",
      port: 443,
      password: "pass@word",
      sni: "us.example.com",
    });
    expect(p["ws-opts"]).toEqual({
      path: "/trojan",
      headers: { Host: "cdn.example.com" },
    });
  });

  it("grpc 参数", () => {
    const p = parseShareLink(
      "trojan://pw@grpc.example.com:443?type=grpc&path=svc&peer=grpc.example.com#grpc",
    )!;
    expect(p["grpc-opts"]).toEqual({ "grpc-service-name": "svc" });
    expect(p.sni).toBe("grpc.example.com");
  });

  it("缺端口 / 缺密码返回 null", () => {
    expect(parseShareLink("trojan://pw@h.com#x")).toBeNull();
    expect(parseShareLink("trojan://@h.com:1#x")).toBeNull();
  });
});

describe("parseShareLink: hysteria2 / hy2", () => {
  it("解析常见字段", () => {
    const p = parseShareLink(HY2_LINK)!;
    expect(p).toMatchObject({
      name: "🇭🇰",
      type: "hysteria2",
      server: "hk.example.com",
      port: 443,
      password: "authpass",
      sni: "hk.example.com",
      "skip-cert-verify": true,
      obfs: "salamander",
      "obfs-password": "ob123",
    });
  });

  it("hy2:// 前缀等价", () => {
    const p = parseShareLink(HY2_LINK.replace("hysteria2://", "hy2://"))!;
    expect(p.type).toBe("hysteria2");
  });
});

// ── vless ────────────────────────────────────────────────────────

describe("parseShareLink: vless", () => {
  it("IPv6 和 ALPN 往返不丢失", () => {
    const p = parseShareLink(
      "vless://test-user@[2001:db8::1]:443?security=tls&alpn=h2%2Chttp%2F1.1#ipv6",
    )!;
    expect(p.alpn).toEqual(["h2", "http/1.1"]);
    const link = toShareLink(p)!;
    expect(link).toContain("@[2001:db8::1]:443");
    expect(parseShareLink(link)).toEqual(p);
  });
  it.each([
    "security=reality",
    "security=unknown",
    "type=xhttp",
    "encryption=unsupported",
  ])("拒绝不完整或不支持的安全/传输配置：%s", (query) => {
    expect(
      parseShareLink(`vless://test-user@proxy.example.com:443?${query}`),
    ).toBeNull();
  });
  it("拒绝将缺少 uuid 或 Reality 公钥的 Clash 节点输出为链接", () => {
    const base = {
      name: "broken",
      type: "vless",
      server: "proxy.example.com",
      port: 443,
    };
    expect(toShareLink(base)).toBeNull();
    expect(
      toShareLink({ ...base, uuid: "test-user", "reality-opts": {} }),
    ).toBeNull();
  });
  it("Reality 全参数解析", () => {
    const p = parseShareLink(VLESS_REALITY_LINK)!;
    expect(p).toMatchObject({
      name: "🇭🇰-Reality",
      type: "vless",
      server: "derp.example.com",
      port: 8443,
      uuid: "11111111-2222-4333-8444-555555555555",
      flow: "xtls-rprx-vision",
      tls: true,
      servername: "www.microsoft.com",
      "client-fingerprint": "chrome",
    });
    // tcp 不写入 network 字段（Clash 默认即 tcp）
    expect(p.network).toBeUndefined();
    expect(p["reality-opts"]).toEqual({
      "public-key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "short-id": "0123456789abcdef",
      "support-x25519mlkem768": true,
    });
  });

  it("TLS + ws 传输层解析", () => {
    const p = parseShareLink(VLESS_TLS_WS_LINK)!;
    expect(p).toMatchObject({
      name: "vless-ws",
      type: "vless",
      network: "ws",
      tls: true,
      servername: "jp.example.com",
    });
    expect(p["ws-opts"]).toEqual({
      path: "/vless",
      headers: { Host: "cdn.example.com" },
    });
    expect(p["reality-opts"]).toBeUndefined();
  });

  it("grpc 参数", () => {
    const p = parseShareLink(
      "vless://uuid-1@grpc.example.com:443?security=tls&type=grpc&serviceName=svc&sni=g.example.com#g",
    )!;
    expect(p["grpc-opts"]).toEqual({ "grpc-service-name": "svc" });
    expect(p.network).toBe("grpc");
  });

  it("无 security 时不开 tls", () => {
    const p = parseShareLink("vless://uuid-1@h.com:80#bare")!;
    expect(p.tls).toBeUndefined();
    expect(p["reality-opts"]).toBeUndefined();
  });

  it("缺端口 / 缺 uuid 返回 null", () => {
    expect(parseShareLink("vless://uuid@h.com#x")).toBeNull();
    expect(parseShareLink("vless://@h.com:1#x")).toBeNull();
  });
});

// ── 逆向 + 往返 ──────────────────────────────────────────────────

describe("toShareLink 往返", () => {
  const cases: [string, string][] = [
    ["vmess", VMESS_LINK],
    ["ss sip002", SS_SIP002],
    ["ss legacy", SS_LEGACY],
    ["ss plugin", SS_PLUGIN],
    ["trojan", TROJAN_LINK],
    ["hysteria2", HY2_LINK],
    ["vless reality", VLESS_REALITY_LINK],
    ["vless ws", VLESS_TLS_WS_LINK],
  ];

  for (const [label, link] of cases) {
    it(`Proxy 级往返无损（${label}）`, () => {
      const p1 = parseShareLink(link)!;
      const out = toShareLink(p1)!;
      expect(out).toBeTruthy();
      const p2 = parseShareLink(out)!;
      expect(p2).toEqual(p1);
    });
  }

  it("vmess 链接级往返（标准输入）", () => {
    const p = parseShareLink(VMESS_LINK)!;
    const link2 = toShareLink(p)!;
    // 重新构造的 JSON 字段一致（顺序可能不同），解析回 Proxy 相等
    expect(parseShareLink(link2)).toEqual(p);
  });

  it("不可逆类型返回 null", () => {
    const socks = {
      name: "x",
      type: "socks5",
      server: "a.com",
      port: 1080,
    } as Proxy;
    expect(toShareLink(socks)).toBeNull();
  });
});

// ── parseBase64Sub ───────────────────────────────────────────────

describe("parseBase64Sub", () => {
  it("base64 包装的混合协议集合", () => {
    const plain = [
      VMESS_LINK,
      SS_SIP002,
      TROJAN_LINK,
      HY2_LINK,
      VLESS_REALITY_LINK,
    ].join("\n");
    const r = parseBase64Sub(b64Encode(plain));
    expect(r.proxies.map((p) => p.type)).toEqual([
      "vmess",
      "ss",
      "trojan",
      "hysteria2",
      "vless",
    ]);
    expect(r.skipped).toBe(0);
  });

  it("明文逐行链接也能解析", () => {
    const r = parseBase64Sub(`${SS_SIP002}\n${TROJAN_LINK}`);
    expect(r.proxies).toHaveLength(2);
  });

  it("坏行跳过不炸整源", () => {
    const r = parseBase64Sub(
      b64Encode(`${SS_SIP002}\nnot-a-link\nss://broken#x`),
    );
    expect(r.proxies).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });
});

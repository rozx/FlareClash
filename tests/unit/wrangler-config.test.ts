import { describe, expect, it } from "vitest";
import {
  lineDiff,
  parseRemoteConfig,
  renderWranglerConfig,
} from "../../scripts/wrangler-config.js";

/** 结构同 wrangler.toml.example（裁剪注释） */
const TEMPLATE = `name = "flareclash"
main = "src/index.ts"
compatibility_date = "2025-06-01"

[assets]
directory = "./public"

# D1
[[d1_databases]]
binding = "DB"
database_name = "flareclash"
database_id = "<your-d1-database-id>"
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "KV"
id = "<your-kv-namespace-id>"

[vars]
# 默认缓存有效期
CACHE_TTL_DEFAULT = "1800"
MIN_FETCH_INTERVAL = "900"
`;

/** wrangler versions view --json 的结构（ID 均为虚构） */
function version(bindings: object[], runtime: object = {}) {
  return {
    id: "v1",
    resources: {
      script_runtime: { compatibility_date: "2025-06-01", ...runtime },
      bindings,
    },
  };
}

const BINDINGS = [
  { name: "ADMIN_PASSWORD", type: "secret_text" },
  { name: "CACHE_TTL_DEFAULT", type: "plain_text", text: "1800" },
  { name: "DB", type: "d1", id: "d1-uuid", database_id: "d1-uuid" },
  { name: "KV", type: "kv_namespace", namespace_id: "kv-id" },
  { name: "MIN_FETCH_INTERVAL", type: "plain_text", text: "900" },
];
const D1_LIST = [{ uuid: "d1-uuid", name: "flareclash-prod" }];

describe("parseRemoteConfig", () => {
  it("按类型拆出变量、密钥名、D1（含库名）与 KV", () => {
    const remote = parseRemoteConfig(version(BINDINGS), D1_LIST);
    expect(remote).toEqual({
      compatibilityDate: "2025-06-01",
      compatibilityFlags: [],
      vars: { CACHE_TTL_DEFAULT: "1800", MIN_FETCH_INTERVAL: "900" },
      secrets: ["ADMIN_PASSWORD"],
      d1: [{ binding: "DB", id: "d1-uuid", name: "flareclash-prod" }],
      kv: [{ binding: "KV", id: "kv-id" }],
      unsupported: [],
    });
  });

  it("无法写入模板的绑定类型记入 unsupported", () => {
    const remote = parseRemoteConfig(
      version([...BINDINGS, { name: "FILES", type: "r2_bucket" }]),
      D1_LIST,
    );
    expect(remote.unsupported).toEqual(["FILES（r2_bucket）"]);
  });
});

describe("renderWranglerConfig", () => {
  it("用线上值填充模板，保留注释与本地专属段", () => {
    const { content, errors } = renderWranglerConfig(
      TEMPLATE,
      parseRemoteConfig(version(BINDINGS), D1_LIST),
    );
    expect(errors).toEqual([]);
    expect(content).toContain('database_id = "d1-uuid"');
    expect(content).toContain('database_name = "flareclash-prod"');
    expect(content).toContain('id = "kv-id"');
    expect(content).toContain('directory = "./public"');
    expect(content).toContain('migrations_dir = "migrations"');
    expect(content).toContain("# 默认缓存有效期");
    expect(content).not.toContain("<your-");
  });

  it("变量以线上为准：改值、线上多出的追加、线上没有的注释掉", () => {
    const { content } = renderWranglerConfig(
      TEMPLATE,
      parseRemoteConfig(
        version([
          BINDINGS[2]!,
          BINDINGS[3]!,
          { name: "CACHE_TTL_DEFAULT", type: "plain_text", text: "600" },
          { name: "FETCH_USER_AGENT", type: "plain_text", text: 'a "b" c' },
        ]),
        D1_LIST,
      ),
    );
    expect(content).toContain('CACHE_TTL_DEFAULT = "600"');
    expect(content).toContain('FETCH_USER_AGENT = "a \\"b\\" c"');
    expect(content).toMatch(/^# MIN_FETCH_INTERVAL = "900"/m);
    expect(content).not.toMatch(/^MIN_FETCH_INTERVAL/m);
  });

  it("兼容日期与兼容标志取线上值", () => {
    const { content } = renderWranglerConfig(
      TEMPLATE,
      parseRemoteConfig(
        version(BINDINGS, {
          compatibility_date: "2026-01-01",
          compatibility_flags: ["nodejs_compat"],
        }),
        D1_LIST,
      ),
    );
    expect(content).toContain('compatibility_date = "2026-01-01"');
    expect(content).toContain('compatibility_flags = ["nodejs_compat"]');
  });

  it("绑定对不上或类型不支持时报错，不生成残缺配置", () => {
    const { errors } = renderWranglerConfig(
      TEMPLATE,
      parseRemoteConfig(
        version([
          BINDINGS[2]!,
          { name: "CACHE", type: "kv_namespace", namespace_id: "x" },
          { name: "FILES", type: "r2_bucket" },
        ]),
        D1_LIST,
      ),
    );
    expect(errors).toEqual([
      "线上没有 KV 绑定 KV",
      "模板缺少线上 KV 绑定 CACHE",
      "模板无法表达线上绑定：FILES（r2_bucket）",
    ]);
  });
});

describe("lineDiff", () => {
  it("只输出增删行", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual(["- b", "+ B", "+ d"]);
    expect(lineDiff("same", "same")).toEqual([]);
  });
});

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  lineDiff,
  parseRemoteConfig,
  renderWranglerConfig,
} from "./wrangler-config.js";

/**
 * 从 Cloudflare 拉取线上 Worker 的实际配置，按 wrangler.toml.example 生成 wrangler.toml。
 *
 * 背景：wrangler.toml 不入库，换机器或重新 clone 后只能手填；填错的变量/兼容日期
 * 会在 deploy 时静默覆盖线上值（wrangler 只在线上最后一次改动来自 Dashboard 时才提示差异）。
 *
 * 用法：
 *   node scripts/pull-config.js           生成 wrangler.toml；已存在且有差异时拒绝覆盖
 *   node scripts/pull-config.js --force   有差异也覆盖
 *   node scripts/pull-config.js --check   只对比，不写文件；有差异退出码 1（部署前自检）
 *
 * 拉取范围：兼容日期/标志、D1/KV 资源 ID 与库名、[vars]。密钥只列名字。
 * 路由与自定义域 wrangler CLI 读不到，不处理：配置里不写 routes 时 deploy 不改动线上路由，
 * 但会默认开启 workers.dev。
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const templatePath = path.join(root, "wrangler.toml.example");
const outPath = path.join(root, "wrangler.toml");

const args = process.argv.slice(2);
const check = args.includes("--check");
const force = args.includes("--force");

function fail(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

/** 运行 wrangler 子命令并解析 --json 输出；stderr 只在失败时展示。 */
function wranglerJson(...cmd) {
  try {
    const out = execFileSync(process.execPath, [wranglerBin, ...cmd, "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch (e) {
    fail(`wrangler ${cmd.join(" ")} 失败：\n${e.stderr || e.stdout || e.message}`);
  }
}

const template = readFileSync(templatePath, "utf8");
const name = template.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
if (!name) fail("wrangler.toml.example 缺少 name");

console.log(`读取线上 Worker「${name}」的当前部署…`);
const status = wranglerJson("deployments", "status", "--name", name);
const versions = status?.versions ?? [];
if (versions.length !== 1)
  fail(`当前部署包含 ${versions.length} 个版本（灰度中？），无法确定以哪个版本为准`);
const versionId = versions[0].version_id;
const version = wranglerJson("versions", "view", versionId, "--name", name);
const d1List = wranglerJson("d1", "list");

const remote = parseRemoteConfig(version, d1List);
const { content, errors, warnings } = renderWranglerConfig(template, remote);
for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length > 0) fail(`无法生成配置：\n  ${errors.join("\n  ")}`);

console.log(`线上版本 ${versionId}（兼容日期 ${remote.compatibilityDate}）`);
console.log(`密钥（仅名字，值不会被拉取）：${remote.secrets.join(", ") || "无"}`);
console.log("注意：路由/自定义域不在拉取范围内，不写 routes 时 deploy 不会改动它们。");

if (existsSync(outPath)) {
  const diff = lineDiff(readFileSync(outPath, "utf8"), content);
  if (diff.length === 0) {
    console.log("✓ 本地 wrangler.toml 与线上一致");
    process.exit(0);
  }
  console.log(`\n本地 wrangler.toml 与线上不一致（- 本地 / + 线上）：\n${diff.join("\n")}\n`);
  if (check) fail("配置有差异，部署会覆盖线上值");
  if (!force) fail("未覆盖本地文件；确认以线上为准后加 --force 重新执行");
} else if (check) {
  fail("本地没有 wrangler.toml，先执行 npm run config:pull");
}

writeFileSync(outPath, content);
console.log(`✓ 已写入 ${path.relative(process.cwd(), outPath) || "wrangler.toml"}`);

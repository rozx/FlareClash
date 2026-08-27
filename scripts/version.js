import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * 跨平台包装 wrangler 并注入部署版本（git short hash）。
 *
 * 背景：原 package.json 用 POSIX-only 的命令替换
 * `--define 'COMMIT_HASH:"'"$(git rev-parse --short HEAD)"'"'`，
 * 在 Windows cmd 下失效，且无 .git 时静默得到空版本。
 * 本脚本：读 git short hash（失败/为空回退 "dev"），以
 * `--define COMMIT_HASH:"<hash>"` 追加到 wrangler 参数；
 * 直接用 node 运行 wrangler 的 bin（不经 shell），避免跨平台引号问题。
 *
 * 用法：node scripts/version.js <wrangler 子命令及参数...>
 */

const DEV = "dev";

function gitShortHash() {
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out || DEV; // 空输出同样回退
  } catch {
    return DEV; // 无 .git / git 不可用
  }
}

const version = gitShortHash();
const args = [
  ...process.argv.slice(2),
  "--define",
  `COMMIT_HASH:${JSON.stringify(version)}`,
];

const wranglerBin = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

const r = spawnSync(process.execPath, [wranglerBin, ...args], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);

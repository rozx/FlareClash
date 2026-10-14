/**
 * 线上配置 → wrangler.toml 的纯函数部分（无 node 依赖，供单测直接导入）。
 * CLI 入口见 scripts/pull-config.js。
 */

/** TOML 基本字符串：JSON 转义序列是 TOML 的子集（JSON.stringify 不输出 `\/`） */
const tomlValue = (v) =>
  Array.isArray(v) ? `[${v.map(tomlValue).join(", ")}]` : JSON.stringify(v);

/**
 * 解析 `wrangler versions view --json` 与 `wrangler d1 list --json` 的输出。
 * 密钥只记名字（API 不返回值）；模板表达不了的绑定类型记入 unsupported。
 */
export function parseRemoteConfig(version, d1Databases) {
  const runtime = version?.resources?.script_runtime ?? {};
  const remote = {
    compatibilityDate: runtime.compatibility_date,
    compatibilityFlags: runtime.compatibility_flags ?? [],
    vars: {},
    secrets: [],
    d1: [],
    kv: [],
    unsupported: [],
  };
  for (const b of version?.resources?.bindings ?? []) {
    if (b.type === "plain_text") remote.vars[b.name] = b.text;
    else if (b.type === "secret_text") remote.secrets.push(b.name);
    else if (b.type === "d1") {
      const id = b.database_id ?? b.id;
      remote.d1.push({
        binding: b.name,
        id,
        name: d1Databases.find((d) => d.uuid === id)?.name,
      });
    } else if (b.type === "kv_namespace")
      remote.kv.push({ binding: b.name, id: b.namespace_id });
    else if (b.type !== "assets") remote.unsupported.push(`${b.name}（${b.type}）`);
  }
  return remote;
}

const HEADER_RE = /^\s*(\[\[?[^\]]+\]\]?)\s*(#.*)?$/;
const keyRe = (key) =>
  new RegExp(
    `^(\\s*${key}\\s*=\\s*)("(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\]|[^\\s#]+)(.*)$`,
  );

function getKey(lines, key) {
  for (const line of lines) {
    const m = line.match(keyRe(key));
    if (m) return JSON.parse(m[2]);
  }
  return undefined;
}

/** 替换键值；不存在时插到 after 键之后（缺省插到段首行之后）。 */
function setKey(lines, key, value, after) {
  const re = keyRe(key);
  const i = lines.findIndex((l) => re.test(l));
  if (i >= 0) {
    lines[i] = lines[i].replace(re, (_, pre, _old, post) => pre + tomlValue(value) + post);
    return;
  }
  const j = after ? lines.findIndex((l) => keyRe(after).test(l)) : 0;
  lines.splice(j + 1, 0, `${key} = ${tomlValue(value)}`);
}

/** [vars] 以线上为准：改值；线上没有的注释掉；线上多出的追加到段内最后一个键之后。 */
function syncVars(lines, vars) {
  const seen = new Set();
  let last = 0;
  lines.forEach((line, i) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) return;
    last = i;
    const key = m[1];
    if (key in vars) {
      seen.add(key);
      lines[i] = line.replace(keyRe(key), (_, pre, _old, post) => pre + tomlValue(vars[key]) + post);
    } else lines[i] = `# ${line.trim()}  # 线上未设置，已注释`;
  });
  const extra = Object.keys(vars)
    .filter((k) => !seen.has(k))
    .map((k) => `${k} = ${tomlValue(vars[k])}`);
  lines.splice(last + 1, 0, ...extra);
}

/**
 * 以 wrangler.toml.example 为骨架，用线上值填充：兼容日期/标志、D1/KV 资源 ID、[vars]。
 * 模板里的 main/[assets]/migrations_dir/注释等本地专属内容原样保留。
 * 返回 errors 非空时 content 不可用于部署。
 */
export function renderWranglerConfig(template, remote) {
  const errors = [];
  const warnings = [];
  const sections = [{ header: null, lines: [] }];
  for (const line of template.split("\n")) {
    const m = line.match(HEADER_RE);
    if (m) sections.push({ header: m[1].replace(/\s+/g, ""), lines: [line] });
    else sections.at(-1).lines.push(line);
  }

  const top = sections[0].lines;
  if (remote.compatibilityDate)
    setKey(top, "compatibility_date", remote.compatibilityDate, "main");
  if (remote.compatibilityFlags.length > 0)
    setKey(top, "compatibility_flags", remote.compatibilityFlags, "compatibility_date");

  const kinds = [
    { header: "[[d1_databases]]", label: "D1", list: remote.d1, idKey: "database_id" },
    { header: "[[kv_namespaces]]", label: "KV", list: remote.kv, idKey: "id" },
  ];
  for (const kind of kinds) {
    const used = new Set();
    for (const s of sections.filter((s) => s.header === kind.header)) {
      const binding = getKey(s.lines, "binding");
      const r = kind.list.find((x) => x.binding === binding);
      if (!r) {
        errors.push(`线上没有 ${kind.label} 绑定 ${binding}`);
        continue;
      }
      used.add(binding);
      setKey(s.lines, kind.idKey, r.id, "binding");
      if (kind.label === "D1") {
        if (r.name) setKey(s.lines, "database_name", r.name, "binding");
        else warnings.push(`未查到 D1 ${r.id} 的库名，保留模板中的 database_name`);
      }
    }
    for (const r of kind.list)
      if (!used.has(r.binding))
        errors.push(`模板缺少线上 ${kind.label} 绑定 ${r.binding}`);
  }

  const varsSection = sections.find((s) => s.header === "[vars]");
  if (varsSection) syncVars(varsSection.lines, remote.vars);
  else if (Object.keys(remote.vars).length > 0) {
    const lines = ["[vars]"];
    syncVars(lines, remote.vars);
    sections.push({ header: "[vars]", lines: ["", ...lines] });
  }

  for (const u of remote.unsupported) errors.push(`模板无法表达线上绑定：${u}`);

  return {
    content: sections.flatMap((s) => s.lines).join("\n"),
    errors,
    warnings,
  };
}

/** 极简行级 diff（LCS），只返回 "- 旧行" / "+ 新行"。 */
export function lineDiff(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1]))
      out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  return out;
}

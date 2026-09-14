import { formatExpire, formatInterval, formatUsage } from "./format.js";

/**
 * FlareClash 管理后台 SPA（无构建，原生 ES module，纯 DOM 构造，无 innerHTML）
 * 规格 admin-ui：登录 / 源管理 / token 管理
 */

const app = document.getElementById("app");

/** 部署版本（commit hash）：启动时从 /api/_ping 获取，页脚展示 */
let APP_VERSION = "";

// ── 工具 ────────────────────────────────────────────

/** DOM 构造器：attrs 支持 class、text、on 事件与布尔属性，children 为节点或文本 */
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (typeof v === "boolean")
      // 布尔 DOM 属性；驼峰属性（如 readOnly）需从小写名映射，否则只是无效 expando
      n[k === "readonly" ? "readOnly" : k] = v;
    else n.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

function badge(text, kind) {
  return el("span", { class: `badge ${kind}`, text });
}

function fmtTime(ms) {
  return ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = el("div", { id: "toast" });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2200);
}

async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg ?? "已复制");
  } catch {
    toast("复制失败，请手动复制");
  }
}

/** 统一 API 调用：401 一律回登录页（规格：会话过期引导回登录） */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (res.status === 401) {
    renderLogin();
    throw new Error("unauthorized");
  }
  return res;
}

async function apiJson(path, opts = {}) {
  const res = await api(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function openDialog(title, ...content) {
  const d = el("dialog", {}, el("h3", { text: title }), ...content);
  document.body.appendChild(d);
  d.showModal();
  d.addEventListener("close", () => d.remove());
  return d;
}

function field(labelText, input) {
  return el(
    "label",
    { class: "field" },
    el("span", { text: labelText }),
    input,
  );
}

// ── 登录视图 ────────────────────────────────────────

function renderLogin() {
  location.hash = "";
  const err = el("div", { class: "form-error" });
  const pw = el("input", {
    type: "password",
    id: "login-pw",
    autocomplete: "current-password",
    required: true,
  });
  const form = el(
    "form",
    {
      class: "login-card",
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw.value }),
        });
        if (res.ok) {
          // 登录成功后补取部署版本（页脚展示），再进主界面
          const r2 = await fetch("/api/_ping").catch(() => null);
          const d = r2?.ok ? await r2.json().catch(() => ({})) : {};
          if (typeof d.version === "string" && d.version)
            APP_VERSION = d.version;
          renderMain();
        } else
          err.textContent =
            res.status === 401 ? "密码错误" : `登录失败（${res.status}）`;
      },
    },
    el("h1", { text: "FlareClash" }),
    el("p", { text: "输入管理员密码进入后台" }),
    field("密码", pw),
    err,
    el("button", {
      type: "submit",
      class: "primary",
      text: "登录",
      style: "width:100%",
    }),
  );
  app.replaceChildren(el("div", { class: "login-wrap" }, form));
}

// ── 主框架 ──────────────────────────────────────────

function renderMain() {
  app.replaceChildren(
    el(
      "header",
      { class: "topbar" },
      el("span", { class: "logo", text: "⚡ FlareClash" }),
      el(
        "nav",
        {},
        el("a", { href: "#/sources", text: "源管理", "data-route": "sources" }),
        el("a", {
          href: "#/tokens",
          text: "Token 管理",
          "data-route": "tokens",
        }),
      ),
      el("button", {
        id: "logout-btn",
        class: "small",
        text: "退出",
        onclick: async () => {
          await api("/api/logout", { method: "POST" }).catch(() => {});
          renderLogin();
        },
      }),
    ),
    el("main", { id: "page" }),
    el(
      "footer",
      { class: "page-footer" },
      "FlareClash · by ",
      el("a", {
        href: "https://github.com/rozx",
        target: "_blank",
        rel: "noreferrer",
        text: "rozx",
      }),
      " · ",
      el("a", {
        href: "https://github.com/rozx/FlareClash",
        target: "_blank",
        rel: "noreferrer",
        text: "GitHub",
      }),
      APP_VERSION
        ? el("span", { class: "mono", text: ` · ${APP_VERSION}` })
        : null,
    ),
  );
  window.addEventListener("hashchange", route);
  route();
}

function route() {
  const page = document.getElementById("page");
  if (!page) return;
  const r = location.hash.replace(/^#\/?/, "") || "sources";
  for (const a of document.querySelectorAll("nav a")) {
    a.classList.toggle("active", a.dataset.route === r);
  }
  if (r === "tokens") renderTokensPage(page);
  else renderSourcesPage(page);
}

// ── 源管理页 ────────────────────────────────────────

function sourceHealthCell(s) {
  const cell = el("td");
  if (s.last_fetch_status === "ok") {
    cell.append(badge("正常", "ok"), ` ${fmtTime(s.last_fetch_at)}`);
  } else if (s.last_fetch_status === "error") {
    cell.append(badge("失败", "err"), ` ${fmtTime(s.last_fetch_at)}`);
    if (s.last_fetch_error) cell.title = s.last_fetch_error;
  } else {
    cell.append(badge("未探测", "muted"));
  }
  return cell;
}

function sourceRowActions(s) {
  return el(
    "td",
    { style: "white-space:nowrap" },
    el("button", { class: "small", text: "探测", onclick: () => probeOne(s) }),
    " ",
    el("button", {
      class: "small",
      text: "编辑",
      onclick: () => sourceDialog(s),
    }),
    " ",
    el("button", {
      class: "small danger",
      text: "删除",
      onclick: () => deleteSource(s), // 内部含二次确认
    }),
  );
}

async function renderSourcesPage(page) {
  let sources;
  try {
    ({ sources } = await apiJson("/api/sources"));
  } catch (ex) {
    if (ex.message !== "unauthorized")
      page.replaceChildren(
        el("div", { class: "empty", text: `加载失败：${ex.message}` }),
      );
    return;
  }
  const table = el(
    "table",
    {},
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        ...[
          "名称",
          "格式",
          "节点前缀",
          "健康状态",
          "用量（已用 / 总量）",
          "到期",
          "更新间隔",
          "绑定 token",
          "操作",
        ].map((h) => el("th", { text: h })),
      ),
    ),
    el(
      "tbody",
      {},
      ...sources.map((s) =>
        el(
          "tr",
          {},
          el("td", { text: s.name }),
          el("td", {}, s.format ? badge(s.format, "muted") : "—"),
          el("td", { text: s.prefix ?? "（源名）" }),
          sourceHealthCell(s),
          el("td", {
            class: "mono",
            text: formatUsage(s.subscription_meta),
          }),
          el("td", { text: formatExpire(s.subscription_meta) }),
          el("td", { text: formatInterval(s.subscription_meta) }),
          el("td", { text: String(s.token_count) }),
          sourceRowActions(s),
        ),
      ),
    ),
  );
  page.replaceChildren(
    el(
      "div",
      { class: "card" },
      el(
        "div",
        { class: "actions" },
        el("button", {
          class: "primary",
          text: "＋ 新建源",
          onclick: () => sourceDialog(null),
        }),
      ),
      sources.length === 0
        ? el("div", {
            class: "empty",
            text: "还没有源订阅，点击「新建源」开始",
          })
        : el("div", { class: "table-scroll" }, table),
    ),
  );
}

function sourceDialog(src) {
  const isEdit = !!src;
  const isStatic = src?.kind === "static";
  const nameIn = el("input", {
    type: "text",
    name: "name",
    required: true,
    value: src?.name ?? "",
  });
  const kindSel = el(
    "select",
    {
      name: "kind",
      onchange: () => {
        const st = kindSel.value === "static";
        urlField.style.display = st ? "none" : "";
        ttlField.style.display = st ? "none" : "";
        contentField.style.display = st ? "" : "none";
        urlIn.required = !st;
        contentIn.required = st;
        urlIn.disabled = st;
        ttlIn.disabled = st;
        contentIn.disabled = !st;
      },
    },
    el("option", {
      value: "fetch",
      text: "URL 订阅（回源+缓存）",
      selected: !isStatic,
    }),
    el("option", {
      value: "static",
      text: "手动节点（静态，不回源）",
      selected: isStatic,
    }),
  );
  const urlIn = el("input", {
    type: "url",
    name: "url",
    required: !isStatic,
    disabled: isStatic,
    value: src?.url ?? "",
    placeholder: "https://...",
  });
  const contentIn = el("textarea", {
    name: "content",
    rows: 5,
    required: isStatic,
    disabled: !isStatic,
    placeholder: "每行一条分享链接（vless/vmess/ss/trojan/hysteria2）",
  });
  contentIn.value = src?.content ?? "";
  const prefixIn = el("input", {
    type: "text",
    name: "prefix",
    value: src?.prefix ?? "",
  });
  const ttlIn = el("input", {
    type: "number",
    name: "cacheTtl",
    disabled: isStatic,
    min: 60,
    max: 86400,
    value: src?.cache_ttl ?? 1800,
  });

  const err = el("div", { class: "form-error" });
  const probeOut = el("div", { class: "probe-result", style: "display:none" });
  let created = false;
  let d; // 先声明，提交回调里引用
  const footer = el("div", { class: "footer" });
  const submitBtn = el("button", {
    type: "submit",
    class: "primary",
    text: isEdit ? "保存" : "创建并探测",
  });
  footer.append(
    el("button", { type: "button", text: "取消", onclick: () => d.close() }),
    submitBtn,
  );

  const urlField = field("上游 URL *（http/https）", urlIn);
  const ttlField = field("缓存有效期（秒，默认 1800）", ttlIn);
  const contentField = field("节点内容 *（每行一条分享链接）", contentIn);
  if (isStatic) {
    urlField.style.display = "none";
    ttlField.style.display = "none";
  } else {
    contentField.style.display = "none";
  }

  const form = el(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        if (created) {
          d.close();
          renderSourcesPage(document.getElementById("page"));
          return;
        }
        const payload = {
          name: nameIn.value.trim(),
          kind: kindSel.value,
          url: kindSel.value === "fetch" ? urlIn.value.trim() : undefined,
          content:
            kindSel.value === "static" ? contentIn.value.trim() : undefined,
          prefix: prefixIn.value.trim() || null,
          cacheTtl: Number(ttlIn.value) || 1800,
        };
        try {
          if (isEdit) {
            await apiJson(`/api/sources/${src.id}`, {
              method: "PATCH",
              body: JSON.stringify(payload),
            });
            toast("已保存");
            d.close();
            renderSourcesPage(document.getElementById("page"));
          } else {
            const { probe } = await apiJson("/api/sources", {
              method: "POST",
              body: JSON.stringify({ ...payload, probe: true }),
            });
            // 规格：新建后展示探测结果（成功/失败、格式、节点数）
            probeOut.style.display = "block";
            probeOut.className = probe?.ok
              ? "probe-result ok"
              : "probe-result err";
            probeOut.textContent = probe?.ok
              ? `✓ 探测成功：${probe.format} 格式，${probe.nodeCount} 个节点`
              : `✗ 探测失败：${probe?.error ?? "未知原因"}（源已创建，可稍后编辑或删除）`;
            if (probe?.ok) {
              submitBtn.textContent = "完成";
              created = true;
            }
          }
        } catch (ex) {
          err.textContent = ex.message;
        }
      },
    },
    field("名称 *", nameIn),
    field("源类型", kindSel),
    urlField,
    contentField,
    field("节点名前缀（留空使用源名）", prefixIn),
    ttlField,
    probeOut,
    err,
    footer,
  );
  d = openDialog(isEdit ? "编辑源" : "新建源", form);
}

async function probeOne(src) {
  toast(`正在探测「${src.name}」…`);
  try {
    const { probe } = await apiJson(`/api/sources/${src.id}/probe`, {
      method: "POST",
    });
    if (probe.ok)
      toast(
        `✓ ${probe.format} · ${probe.nodeCount} 节点（${probe.origin ?? "本地解析"}）`,
      );
    else toast(`✗ 探测失败：${probe.error}`);
    renderSourcesPage(document.getElementById("page"));
  } catch (ex) {
    if (ex.message !== "unauthorized") toast(`✗ ${ex.message}`);
  }
}

async function deleteSource(src) {
  // 规格：删除需二次确认
  if (
    !confirm(`确定删除源「${src.name}」？其缓存与所有 token 绑定也会一并删除。`)
  )
    return;
  await apiJson(`/api/sources/${src.id}`, { method: "DELETE" });
  toast("已删除");
  renderSourcesPage(document.getElementById("page"));
}

// ── Token 管理页 ────────────────────────────────────

/** 值卡片控件：名称 + 说明 + 只读文本框 + 右上角复制按钮（编辑弹窗与创建成功输出共用）
 *  文本框支持全选/手动复制，click 即全选，readonly 防误改 */
function valueCard({ name, desc, value, toastMsg }) {
  const input = el("input", {
    type: "text",
    class: "mono",
    readonly: true,
    value,
    onclick: () => input.select(),
  });
  return el(
    "div",
    { class: "url-group" },
    el(
      "div",
      { class: "url-group-head" },
      el("div", { class: "url-group-name", text: name }),
      el("button", {
        type: "button",
        class: "small",
        text: "复制",
        onclick: () => copyText(value, toastMsg),
      }),
    ),
    desc ? el("div", { class: "url-group-desc", text: desc }) : null,
    input,
  );
}

/** Token 凭据卡片：valueCard 的 Token 专用封装（编辑弹窗与创建成功输出共用） */
function credentialCard(value) {
  return valueCard({
    name: "Token",
    desc: "订阅凭据，即地址中 /sub/ 之后的部分；泄露后任何人可凭它拉取订阅",
    value,
    toastMsg: "Token 已复制",
  });
}

/** token 的三格式订阅地址卡片组（编辑弹窗与创建成功输出共用） */
function subUrlCards(subBase, tokenStr) {
  return [
    valueCard({
      name: "自动识别",
      desc: "按客户端 User-Agent 自动选择输出格式",
      value: `${subBase}/${tokenStr}`,
      toastMsg: "自动识别 URL 已复制",
    }),
    valueCard({
      name: "Clash / Mihomo",
      desc: "YAML 确定性格式",
      value: `${subBase}/clash/${tokenStr}`,
      toastMsg: "Clash URL 已复制",
    }),
    valueCard({
      name: "Hiddify / 通用",
      desc: "Base64 链接列表",
      value: `${subBase}/base64/${tokenStr}`,
      toastMsg: "Base64 URL 已复制",
    }),
  ];
}

function tokenStatusCell(t) {
  const cell = el("td");
  if (t.enabled !== 1) cell.append(badge("已禁用", "muted"));
  else if (t.expires_at && t.expires_at < Date.now())
    cell.append(badge("已过期", "warn"));
  else cell.append(badge("启用", "ok"));
  return cell;
}

function tokenRowActions(t, sources) {
  // 全部地址在编辑弹窗展示；列表行仅保留自动识别 URL 快捷复制，避免操作列出框
  const adaptiveUrl = `${location.origin}/sub/${t.token}`;
  return el(
    "td",
    { style: "white-space:nowrap" },
    el("button", {
      class: "small",
      text: "复制自动识别 URL",
      onclick: () => copyText(adaptiveUrl, "自动识别 URL 已复制"),
    }),
    " ",
    el("button", {
      class: "small",
      text: "编辑",
      onclick: () => tokenDialog(t, sources),
    }),
    " ",
    el("button", {
      class: "small",
      text: t.enabled === 1 ? "禁用" : "启用",
      onclick: async () => {
        await apiJson(`/api/tokens/${t.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: t.enabled !== 1 }),
        });
        toast(t.enabled === 1 ? "已禁用" : "已启用");
        renderTokensPage(document.getElementById("page"));
      },
    }),
    " ",
    el("button", {
      class: "small danger",
      text: "删除",
      onclick: async () => {
        // 规格：删除需二次确认
        if (
          !confirm(
            `确定删除 token「${t.name || t.token.slice(0, 8)}」？使用它的客户端将立即失效。`,
          )
        )
          return;
        await apiJson(`/api/tokens/${t.id}`, { method: "DELETE" });
        toast("已删除");
        renderTokensPage(document.getElementById("page"));
      },
    }),
  );
}

async function renderTokensPage(page) {
  let tokens, sources;
  try {
    [{ tokens }, { sources }] = await Promise.all([
      apiJson("/api/tokens"),
      apiJson("/api/sources"),
    ]);
  } catch (ex) {
    if (ex.message !== "unauthorized")
      page.replaceChildren(
        el("div", { class: "empty", text: `加载失败：${ex.message}` }),
      );
    return;
  }
  const sourceName = (id) => sources.find((s) => s.id === id)?.name ?? `#${id}`;
  const table = el(
    "table",
    {},
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        ...["名称", "状态", "绑定源", "最后使用", "过期时间", "操作"].map((h) =>
          el("th", { text: h }),
        ),
      ),
    ),
    el(
      "tbody",
      {},
      ...tokens.map((t) =>
        el(
          "tr",
          {},
          el("td", { text: t.name || "（未命名）" }),
          tokenStatusCell(t),
          el("td", { text: t.source_ids.map(sourceName).join("、") || "—" }),
          el("td", { class: "mono", text: fmtTime(t.last_used_at) }),
          el("td", {
            class: "mono",
            text: t.expires_at ? fmtTime(t.expires_at) : "永不过期",
          }),
          tokenRowActions(t, sources),
        ),
      ),
    ),
  );
  page.replaceChildren(
    el(
      "div",
      { class: "card" },
      el(
        "div",
        { class: "actions" },
        el("button", {
          class: "primary",
          text: "＋ 新建 Token",
          onclick: () => tokenDialog(null, sources),
        }),
      ),
      tokens.length === 0
        ? el("div", { class: "empty", text: "还没有 access token" })
        : el("div", { class: "table-scroll" }, table),
    ),
  );
}

function tokenDialog(t, sources) {
  const isEdit = !!t;
  const nameIn = el("input", {
    type: "text",
    name: "name",
    value: t?.name ?? "",
    placeholder: "如：老王",
  });
  const dtLocal = t?.expires_at
    ? new Date(t.expires_at - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
  const expIn = el("input", {
    type: "datetime-local",
    name: "expiresAt",
    value: dtLocal,
  });
  const checks = el(
    "div",
    { class: "checks" },
    ...sources.map((s) =>
      el(
        "label",
        {},
        el("input", {
          type: "checkbox",
          name: "sid",
          value: String(s.id),
          checked: t?.source_ids?.includes(s.id),
        }),
        ` ${s.name}`,
      ),
    ),
    ...(sources.length === 0
      ? [el("span", { class: "empty", text: "请先创建源订阅" })]
      : []),
  );

  // 编辑模式：展示 token 本体与全部订阅地址（列表行仅保留自动识别 URL 快捷复制）
  const subBase = `${location.origin}/sub`;
  const urlsSection = isEdit
    ? el(
        "div",
        { class: "token-urls" },
        el("div", { class: "token-urls-title", text: "凭据与订阅地址" }),
        credentialCard(t.token),
        ...subUrlCards(subBase, t.token),
      )
    : null;

  const err = el("div", { class: "form-error" });
  const successOut = el("div", {
    class: "probe-result ok",
    style: "display:none",
  });
  let created = false;
  let d; // 先声明，提交回调里引用
  const footer = el("div", { class: "footer" });
  const submitBtn = el("button", {
    type: "submit",
    class: "primary",
    text: isEdit ? "保存" : "创建",
  });
  footer.append(
    el("button", { type: "button", text: "取消", onclick: () => d.close() }),
    submitBtn,
  );

  const form = el(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        if (created) {
          d.close();
          renderTokensPage(document.getElementById("page"));
          return;
        }
        const sourceIds = [...checks.querySelectorAll("input:checked")].map(
          (x) => Number(x.value),
        );
        const expiresAt = expIn.value ? new Date(expIn.value).getTime() : null;
        const payload = { name: nameIn.value.trim(), expiresAt, sourceIds };
        try {
          if (isEdit) {
            await apiJson(`/api/tokens/${t.id}`, {
              method: "PATCH",
              body: JSON.stringify(payload),
            });
            toast("已保存");
            d.close();
            renderTokensPage(document.getElementById("page"));
          } else {
            const { token } = await apiJson("/api/tokens", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            // 创建成功后展示 token 与确定性格式 URL，避免依赖客户端 User-Agent
            successOut.replaceChildren(
              el("div", { text: "✓ 创建成功！复制对应地址发给使用者：" }),
              credentialCard(token.token),
              ...subUrlCards(`${location.origin}/sub`, token.token),
            );
            successOut.style.display = "block";
            submitBtn.textContent = "完成";
            created = true;
          }
        } catch (ex) {
          err.textContent = ex.message;
        }
      },
    },
    field("备注名（给谁用的）", nameIn),
    field("过期时间（留空 = 永不过期）", expIn),
    field("绑定的源（可多选）", checks),
    urlsSection,
    successOut,
    err,
    footer,
  );
  d = openDialog(isEdit ? "编辑 Token" : "新建 Token", form);
}

// ── 启动 ────────────────────────────────────────────

(async () => {
  const res = await fetch("/api/_ping").catch(() => null);
  if (res && res.ok) {
    // 顺带取部署版本（未注入时后端返回 "dev"）供页脚展示
    const data = await res.json().catch(() => ({}));
    if (typeof data.version === "string" && data.version)
      APP_VERSION = data.version;
    renderMain();
  } else renderLogin();
})();

/** 网站分流编辑器：纯 DOM；草稿只在明确保存后写入 D1。 */

const RULE_TYPES = [
  ["DOMAIN-SUFFIX", "域名及子域名"],
  ["DOMAIN", "仅该域名"],
  ["DOMAIN-KEYWORD", "包含关键词"],
  ["IP-CIDR", "IPv4 段"],
  ["IP-CIDR6", "IPv6 段"],
  ["GEOIP", "国家/地区 IP"],
];
const ADD_MODES = [
  ["auto", "自动识别"],
  ["DOMAIN-SUFFIX", "域名及子域名"],
  ["DOMAIN", "仅该域名"],
  ["DOMAIN-KEYWORD", "包含关键词"],
  ["IP", "IP 段"],
  ["GEOIP", "国家/地区 IP"],
];
const MODE_HINTS = {
  auto: "域名会同时匹配它的所有子域名（填 google.com 即包含 www.google.com）；IP 段如 10.0.0.0/8；粘贴完整网址会自动取域名。",
  "DOMAIN-SUFFIX": "匹配该域名及其所有子域名。",
  DOMAIN: "只匹配完全相同的域名，不含子域名。",
  "DOMAIN-KEYWORD": "域名中包含该关键词即命中，如 google 会命中 google.com.hk。",
  IP: "IPv4 或 IPv6 网段，如 10.0.0.0/8；单个 IP 自动补全掩码。",
  GEOIP: "两位国家/地区代码，如 CN、US。仅 Clash 支持，Hiddify 无法导入。",
};
const PLACEHOLDERS = {
  "DOMAIN-SUFFIX": "example.com",
  DOMAIN: "www.example.com",
  "DOMAIN-KEYWORD": "google",
  "IP-CIDR": "10.0.0.0/8",
  "IP-CIDR6": "fd00::/8",
  GEOIP: "CN",
};
const HINTS = {
  "DOMAIN-SUFFIX local": "局域网主机名",
  "IP-CIDR 127.0.0.0/8": "本机",
  "IP-CIDR 10.0.0.0/8": "局域网",
  "IP-CIDR 172.16.0.0/12": "局域网",
  "IP-CIDR 192.168.0.0/16": "局域网",
  "IP-CIDR6 ::1/128": "本机",
  "IP-CIDR6 fc00::/7": "局域网",
  "GEOIP CN": "中国大陆 IP",
};

/** 内置常见规则的中文说明；其余返回空串。 */
export function ruleHint(rule) {
  return HINTS[`${rule.type} ${rule.value}`] ?? "";
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/;
const IPV6 = /^[0-9a-f]*:[0-9a-f:.]*(\/\d{1,3})?$/i;

/** 网址/带端口或路径的输入 → 主机名；去掉通配前缀与末尾点。 */
function hostOf(raw) {
  let host = raw;
  if (/:\/\/|[/?#:]/.test(raw)) {
    try {
      host = new URL(/:\/\//.test(raw) ? raw : `http://${raw}`).hostname;
    } catch {
      host = raw;
    }
  }
  return host
    .replace(/^\*?\./, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

/**
 * 解析「添加规则」输入：换行/逗号/空格分隔多项，按匹配方式得到规则类型与内容。
 * 自动识别只区分域名与 IP 段，不把两位字母当国家代码（cn 也可能是 .cn 后缀）。
 * 最终合法性由服务端校验。
 */
export function parseEntries(text, mode) {
  return text
    .split(/[\s,，、;；]+/)
    .filter(Boolean)
    .map((raw) => {
      if (mode === "GEOIP") return { raw, type: "GEOIP", value: raw.toUpperCase() };
      if (mode === "DOMAIN-KEYWORD")
        return { raw, type: "DOMAIN-KEYWORD", value: raw.toLowerCase() };
      if (mode === "auto" || mode === "IP") {
        if (IPV4.test(raw))
          return { raw, type: "IP-CIDR", value: raw.includes("/") ? raw : `${raw}/32` };
        if (IPV6.test(raw))
          return { raw, type: "IP-CIDR6", value: raw.includes("/") ? raw : `${raw}/128` };
        if (mode === "IP") return { raw, type: "IP-CIDR", value: raw };
      }
      return { raw, type: mode === "DOMAIN" ? "DOMAIN" : "DOMAIN-SUFFIX", value: hostOf(raw) };
    });
}

const targetKind = (t) =>
  t === "PROXY" ? "proxy" : t === "DIRECT" ? "direct" : t === "REJECT" ? "reject" : "group";

export async function renderRoutingPage(page, { el, apiJson, field, toast }) {
  page.replaceChildren(el("p", { class: "empty", text: "正在读取分流配置…" }));
  let loaded, sources;
  const ticket = Symbol();
  page._routingTicket = ticket;
  const active = () =>
    page.isConnected &&
    page._routingTicket === ticket &&
    location.hash.replace(/^#\/?/, "") === "routing";
  try {
    [loaded, { sources }] = await Promise.all([
      apiJson("/api/routing"),
      apiJson("/api/sources"),
    ]);
  } catch (e) {
    if (active())
      page.replaceChildren(el("p", { class: "form-error", text: e.message }));
    return;
  }
  if (!active()) return;

  let draft = structuredClone(loaded.config),
    dirty = false,
    busy = false;
  // 重绘时保留的界面状态（重绘会重建全部 DOM）
  const ui = {
    addText: "",
    addMode: "auto",
    addTarget: "PROXY",
    previewText: "",
    groupsOpen: draft.groups.length > 0,
    advancedOpen: false,
  };
  let status, pageError, addError, saveBar, compatibility;

  // 站内切页 / 关闭页面前确认未保存修改（app.js route() 调用 _canLeave）
  page._canLeave = () =>
    !dirty || confirm("分流规则有未保存的修改，离开后会丢失。确定离开吗？");
  window.onbeforeunload = (e) => {
    if (active() && dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  };

  const targetOptions = () => [
    ["PROXY", "代理"],
    ["DIRECT", "直连"],
    ["REJECT", "拦截"],
    ...draft.groups.map((g) => [g.id, `📂 ${g.name || "未命名节点组"}`]),
  ];
  const targetLabel = (id) => targetOptions().find(([v]) => v === id)?.[1] ?? id;
  function select(options, value, onChange, label) {
    const input = el(
      "select",
      { "aria-label": label, onchange: (e) => onChange(e.target.value) },
      ...options.map(([v, name]) => el("option", { value: v, text: name })),
    );
    input.value = value;
    return input;
  }
  function target(value, onChange, label) {
    const input = select(targetOptions(), value, onChange, label);
    input.dataset.target = "true";
    return input;
  }
  function refreshTargets() {
    for (const input of page.querySelectorAll("select[data-target]")) {
      const value = input.value;
      input.replaceChildren(
        ...targetOptions().map(([v, name]) => el("option", { value: v, text: name })),
      );
      input.value = value;
    }
  }
  const usesOf = (id) =>
    draft.rules.filter((r) => r.target === id).length + (draft.final === id ? 1 : 0);
  const usageText = (n) => (n ? `被 ${n} 条规则使用` : "还没有规则使用它");
  /** 规则去向变化后刷新节点组的引用计数（不重绘，避免输入框失焦）。 */
  function refreshUsage() {
    for (const span of page.querySelectorAll("[data-group-usage]"))
      span.textContent = usageText(usesOf(span.dataset.groupUsage));
  }
  const btn = (text, fn, attrs = {}) =>
    el("button", { type: "button", text, onclick: fn, ...attrs });

  function issues() {
    const messages = [];
    draft.rules.forEach((r, i) => {
      if (r.type === "GEOIP") messages.push(`第 ${i + 1} 条（国家/地区 IP）`);
      if (!["PROXY", "DIRECT", "REJECT"].includes(r.target))
        messages.push(`第 ${i + 1} 条（去向是节点组）`);
    });
    if (!["PROXY", "DIRECT", "REJECT"].includes(draft.final))
      messages.push("兜底（去向是节点组）");
    return messages;
  }
  function updateStatus() {
    const [text, kind] = busy
      ? ["处理中…", "muted"]
      : dirty
        ? ["有未保存修改", "warn"]
        : loaded.origin === "saved"
          ? ["已保存的自定义规则", "ok"]
          : ["默认规则", "muted"];
    status.textContent = text;
    status.className = `badge ${kind}`;
    saveBar.hidden = !dirty;
    const warnings = issues();
    compatibility.textContent = warnings.length
      ? `暂不能导出：${warnings.join("、")} Hiddify 不支持。需要先调整这些规则，导出不会自动删除或改写它们。`
      : "当前规则都能导出为 Hiddify 原生规则。";
    compatibility.className = warnings.length ? "routing-note warning" : "routing-note";
  }
  function changed() {
    dirty = true;
    updateStatus();
  }
  function download(name, data) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = el("a", { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function action(work, errorEl = pageError) {
    if (busy) return;
    busy = true;
    pageError.textContent = "";
    addError.textContent = "";
    updateStatus();
    const controls = [...page.querySelectorAll("input,select,textarea,button")].map(
      (n) => [n, n.disabled],
    );
    controls.forEach(([n]) => {
      n.disabled = true;
    });
    try {
      await work();
    } catch (e) {
      if (active()) errorEl.textContent = e.message;
    } finally {
      busy = false;
      controls.forEach(([n, disabled]) => {
        n.disabled = disabled;
      });
      if (active()) updateStatus();
    }
  }
  const validate = (config) =>
    apiJson("/api/routing/validate", {
      method: "POST",
      body: JSON.stringify(config),
    });

  /** 批量添加：新规则插到最前，先经服务端校验，错误映射回输入项。 */
  function addRules() {
    const entries = parseEntries(ui.addText, ui.addMode);
    if (!entries.length) {
      addError.textContent = "请先输入要添加的网址、域名或 IP 段";
      return;
    }
    if (draft.rules.length + entries.length > 256) {
      addError.textContent = `规则最多 256 条，当前已有 ${draft.rules.length} 条`;
      return;
    }
    action(async () => {
      const n = entries.length;
      let result;
      try {
        result = await validate({
          ...draft,
          rules: [
            ...entries.map(({ type, value }) => ({ type, value, target: ui.addTarget })),
            ...draft.rules,
          ],
        });
      } catch (e) {
        const m = e.message.match(/^第 (\d+) 条规则：(.*)$/);
        if (!m) throw e;
        const idx = Number(m[1]);
        throw new Error(
          idx <= n
            ? `「${entries[idx - 1].raw}」：${m[2]}`
            : `列表中第 ${idx - n} 条规则有误，请先修正：${m[2]}`,
        );
      }
      if (!active()) return;
      const key = (r) => `${r.type} ${r.value}`;
      const existing = result.config.rules.slice(n);
      const seen = new Set(existing.map(key));
      const added = result.config.rules.slice(0, n).filter((r) => {
        if (seen.has(key(r))) return false;
        seen.add(key(r));
        return true;
      });
      draft = { ...result.config, rules: [...added, ...existing] };
      const skipped = n - added.length;
      ui.addText = "";
      if (added.length) dirty = true;
      draw();
      toast(
        added.length
          ? `已添加 ${added.length} 条规则${skipped ? `，跳过 ${skipped} 条重复` : ""}；记得保存`
          : "这些规则已经存在，未添加",
      );
    }, addError);
  }

  function addCard() {
    const input = el("textarea", {
      rows: 2,
      "aria-label": "要添加的网址、域名或 IP 段",
      placeholder: "例如：openai.com、https://www.youtube.com、10.8.0.0/16\n可一次粘贴多个，用换行、逗号或空格分隔",
      oninput: (e) => {
        ui.addText = e.target.value;
      },
      onkeydown: (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addRules();
      },
    });
    input.value = ui.addText;
    const hint = el("p", { class: "routing-note", text: MODE_HINTS[ui.addMode] });
    return el(
      "section",
      { class: "card routing-add" },
      el("h2", { text: "添加规则" }),
      input,
      el(
        "div",
        { class: "routing-add-controls" },
        field(
          "匹配方式",
          select(
            ADD_MODES,
            ui.addMode,
            (v) => {
              ui.addMode = v;
              hint.textContent = MODE_HINTS[v];
            },
            "匹配方式",
          ),
        ),
        field(
          "去向",
          target(
            ui.addTarget,
            (v) => {
              ui.addTarget = v;
            },
            "新规则去向",
          ),
        ),
        btn("添加到最前", addRules, { class: "primary" }),
      ),
      hint,
      addError,
    );
  }

  function ruleRow(r, i) {
    const row = el("div", {
      class: `rule-row target-${targetKind(r.target)}`,
      role: "listitem",
      "data-index": String(i),
    });
    const hint = el("small", { class: "rule-hint", text: ruleHint(r) });
    const value = el("input", {
      type: "text",
      value: r.value,
      maxlength: 253,
      placeholder: PLACEHOLDERS[r.type],
      "aria-label": `规则 ${i + 1} 内容`,
      oninput: (e) => {
        r.value = e.target.value;
        hint.textContent = ruleHint(r);
        changed();
      },
    });
    const move = (to) => {
      [draft.rules[to], draft.rules[i]] = [draft.rules[i], draft.rules[to]];
      dirty = true;
      draw(`${to < i ? "上移" : "下移"}规则 ${to + 1}`);
    };
    row.append(
      el("span", { class: "rule-index", text: String(i + 1) }),
      select(
        RULE_TYPES,
        r.type,
        (v) => {
          r.type = v;
          value.placeholder = PLACEHOLDERS[v];
          hint.textContent = ruleHint(r);
          changed();
        },
        `规则 ${i + 1} 类型`,
      ),
      el("div", { class: "rule-value" }, value, hint),
      target(
        r.target,
        (v) => {
          r.target = v;
          row.className = `rule-row target-${targetKind(v)}`;
          refreshUsage();
          changed();
        },
        `规则 ${i + 1} 动作`,
      ),
      el(
        "div",
        { class: "rule-actions" },
        btn("↑", () => move(i - 1), {
          class: "small",
          disabled: i === 0,
          title: "上移",
          "aria-label": `上移规则 ${i + 1}`,
        }),
        btn("↓", () => move(i + 1), {
          class: "small",
          disabled: i === draft.rules.length - 1,
          title: "下移",
          "aria-label": `下移规则 ${i + 1}`,
        }),
        btn(
          "✕",
          () => {
            draft.rules.splice(i, 1);
            dirty = true;
            draw();
          },
          { class: "small danger", title: "删除", "aria-label": `删除规则 ${i + 1}` },
        ),
      ),
    );
    return row;
  }

  function finalRow() {
    const row = el("div", {
      class: `rule-row rule-final target-${targetKind(draft.final)}`,
      role: "listitem",
      "data-index": "final",
    });
    row.append(
      el("span", { class: "rule-index", text: "∗" }),
      el(
        "div",
        { class: "rule-final-label" },
        el("strong", { text: "其他所有流量" }),
        el("small", { class: "rule-hint", text: "以上规则都没命中时（兜底，始终最后）" }),
      ),
      target(
        draft.final,
        (v) => {
          draft.final = v;
          row.className = `rule-row rule-final target-${targetKind(v)}`;
          refreshUsage();
          changed();
        },
        "兜底动作",
      ),
      el("span", { class: "rule-actions" }),
    );
    return row;
  }

  function rulesCard() {
    return el(
      "section",
      { class: "card" },
      el("h2", { text: `规则列表（${draft.rules.length}）` }),
      el("p", {
        class: "routing-note",
        text: "从上往下逐条匹配，命中第一条就停止。用 ↑ ↓ 调整优先级。",
      }),
      el(
        "div",
        { class: "rule-table", role: "list", "aria-label": "分流规则" },
        el(
          "div",
          { class: "rule-row rule-head", "aria-hidden": "true" },
          el("span", { text: "#" }),
          el("span", { text: "匹配方式" }),
          el("span", { text: "内容" }),
          el("span", { text: "去向" }),
          el("span", {}),
        ),
        ...(draft.rules.length
          ? draft.rules.map(ruleRow)
          : [el("p", { class: "empty", text: "还没有规则，所有流量都按下方兜底处理。" })]),
        finalRow(),
      ),
    );
  }

  function previewCard() {
    const input = el("input", {
      type: "text",
      value: ui.previewText,
      placeholder: "例如：https://www.example.com",
      "aria-label": "预览域名",
      oninput: (e) => {
        ui.previewText = e.target.value;
      },
    });
    const result = el("p", { role: "status", class: "routing-preview" });
    const run = (e) => {
      e.preventDefault();
      const domain = hostOf(ui.previewText.trim());
      if (!domain) return;
      action(async () => {
        const r = await apiJson("/api/routing/preview", {
          method: "POST",
          body: JSON.stringify({ config: draft, domain }),
        });
        if (!active()) return;
        for (const n of page.querySelectorAll(".rule-row.is-hit")) n.classList.remove("is-hit");
        const row = page.querySelector(
          `.rule-row[data-index="${r.index === null ? "final" : r.index}"]`,
        );
        row?.classList.add("is-hit");
        row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        result.replaceChildren(
          el("strong", { text: `${r.domain} → ${targetLabel(r.target)}` }),
          el("span", {
            text:
              r.index === null
                ? "（未命中任何规则，按兜底处理）"
                : `（命中第 ${r.index + 1} 条：${draft.rules[r.index]?.value ?? ""}）`,
          }),
          el("small", {
            class: "routing-note",
            text: r.uncertain
              ? "只按域名规则判断，不做 DNS 解析；它前面还有 IP/国家规则，实际结果取决于解析出的 IP。"
              : "只按域名规则判断，不做 DNS 解析。",
          }),
        );
      });
    };
    return el(
      "form",
      { class: "card routing-test", onsubmit: run },
      el("h2", { text: "测试网址" }),
      el("p", { class: "routing-note", text: "输入网址，看看按当前规则（含未保存修改）会走哪里。" }),
      el(
        "div",
        { class: "routing-inline" },
        input,
        el("button", { type: "submit", text: "预览匹配" }),
      ),
      result,
    );
  }

  function groupCard(g, index) {
    const name = el("input", {
      type: "text",
      value: g.name,
      maxlength: 64,
      placeholder: "如：美国自建",
      oninput: (e) => {
        g.name = e.target.value;
        changed();
        refreshTargets();
      },
    });
    const missing = g.sourceIds.filter((id) => !sources.some((s) => s.id === id));
    return el(
      "fieldset",
      { class: "routing-group" },
      el("legend", { text: g.name || `节点组 ${index + 1}` }),
      el(
        "div",
        { class: "routing-group-head" },
        field("名称", name),
        field(
          "选择方式",
          select(
            [
              ["select", "手动选择节点"],
              ["url-test", "自动选延迟最低"],
            ],
            g.mode,
            (v) => {
              g.mode = v;
              changed();
            },
            "选择方式",
          ),
        ),
      ),
      el("p", { class: "routing-note", text: "包含这些源的节点：" }),
      el(
        "div",
        { class: "routing-sources" },
        ...sources.map((s) =>
          el(
            "label",
            {},
            el("input", {
              type: "checkbox",
              checked: g.sourceIds.includes(s.id),
              onchange: (e) => {
                g.sourceIds = e.target.checked
                  ? [...g.sourceIds, s.id]
                  : g.sourceIds.filter((id) => id !== s.id);
                changed();
              },
            }),
            ` ${s.name}（${s.kind === "static" ? "手动节点" : "URL 订阅"}）`,
          ),
        ),
      ),
      missing.length
        ? el("p", {
            class: "form-error",
            text: `包含已删除的源（ID ${missing.join(", ")}），保存会失败；请重新勾选或删除本组。`,
          })
        : null,
      el(
        "div",
        { class: "routing-group-foot" },
        el("span", {
          class: "routing-note",
          "data-group-usage": g.id,
          text: usageText(usesOf(g.id)),
        }),
        btn(
          "删除节点组",
          () => {
            const uses = usesOf(g.id);
            if (uses) {
              pageError.textContent = `节点组「${g.name}」仍被 ${uses} 条规则使用，请先把这些规则的去向改掉。`;
              return;
            }
            draft.groups.splice(index, 1);
            dirty = true;
            draw();
          },
          { class: "small danger" },
        ),
      ),
    );
  }

  function groupsCard() {
    return el(
      "details",
      {
        class: "card routing-section",
        open: ui.groupsOpen,
        ontoggle: (e) => {
          ui.groupsOpen = e.currentTarget.open;
        },
      },
      el(
        "summary",
        {},
        el("h2", { text: `节点组（${draft.groups.length}）` }),
        el("span", { class: "muted", text: "可选 · 仅 Clash" }),
      ),
      el("p", {
        class: "routing-note",
        text: "想让某些网站固定走指定源的节点（例如 ChatGPT 只走美国自建节点）时，先在这里建组，再把规则的去向设成它。每个 token 只会拿到自己绑定的源里的节点；组里没有可用节点时订阅会报错，不会自动改成直连。",
      }),
      ...draft.groups.map(groupCard),
      btn(
        "新建节点组",
        () => {
          draft.groups.push({
            id: `g_${crypto.randomUUID().slice(0, 8)}`,
            name: "新节点组",
            mode: "select",
            sourceIds: [],
          });
          ui.groupsOpen = true;
          dirty = true;
          draw();
        },
        { disabled: draft.groups.length >= 32 },
      ),
    );
  }

  function advancedCard() {
    const jsonInput = el("textarea", {
      class: "routing-json",
      spellcheck: "false",
      "aria-label": "分流配置 JSON",
    });
    jsonInput.value = JSON.stringify(draft, null, 2);
    const applyJson = (text, sourceLabel) =>
      action(async () => {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error(`${sourceLabel}语法无效`);
        }
        const result = await validate(parsed);
        if (!active()) return;
        draft = result.config;
        dirty = true;
        draw();
        toast("已载入草稿，保存后生效");
      });
    const file = el("input", {
      type: "file",
      accept: ".json,application/json",
      hidden: true,
      "aria-label": "导入 JSON 文件",
      onchange: async () => {
        const selected = file.files?.[0];
        if (!selected) return;
        if (selected.size > 65536) {
          pageError.textContent = "JSON 文件不能超过 64 KiB";
          return;
        }
        applyJson(await selected.text(), "JSON 文件");
      },
    });
    return el(
      "details",
      {
        class: "card routing-section",
        open: ui.advancedOpen,
        ontoggle: (e) => {
          ui.advancedOpen = e.currentTarget.open;
        },
      },
      el(
        "summary",
        {},
        el("h2", { text: "备份与导出" }),
        el("span", { class: "muted", text: "高级" }),
      ),
      el(
        "div",
        { class: "routing-subsection" },
        el("h3", { text: "配置 JSON" }),
        el("p", {
          class: "routing-note",
          text: "导出当前草稿做备份，或从 JSON 载入（只更新草稿，保存后才生效）。仓库默认规则在 config/routing.default.json，网站保存的规则不会回写仓库。",
        }),
        el(
          "div",
          { class: "routing-toolbar" },
          btn("导出配置 JSON", () =>
            action(async () => {
              const result = await validate(draft);
              if (active()) download("routing.json", result.config);
            }),
          ),
          btn("从文件导入…", () => file.click()),
          file,
        ),
        // toggle 是延迟事件，不能用它回填文本，否则可能覆盖刚输入的 JSON。
        el(
          "details",
          {},
          el("summary", {
            text: "直接编辑 JSON",
            onclick: (e) => {
              if (!e.currentTarget.parentElement.open)
                jsonInput.value = JSON.stringify(draft, null, 2);
            },
          }),
          jsonInput,
          btn("应用 JSON 到表单", () => applyJson(jsonInput.value, "JSON ")),
        ),
      ),
      el(
        "div",
        { class: "routing-subsection" },
        el("h3", { text: "Hiddify" }),
        compatibility,
        btn("导出 Hiddify 规则", () =>
          action(async () => {
            const result = await apiJson("/api/routing/hiddify", {
              method: "POST",
              body: JSON.stringify(draft),
            });
            if (active()) download("hiddify-rules.json", result);
          }),
        ),
        el(
          "details",
          {},
          el("summary", { text: "导入说明" }),
          el("p", {
            class: "routing-note",
            text: "Hiddify 的节点订阅仍用 Base64 链接；规则要在客户端「路由规则」页从这个 JSON 文件单独导入，每次改完需要重新导入。导入会替换客户端原有规则列表，请先备份。「代理」表示客户端当前选中的节点。导出成功只代表格式正确，不代表实际线路已按规则分流。",
          }),
        ),
      ),
      el(
        "div",
        { class: "routing-subsection" },
        el("h3", { text: "恢复默认" }),
        el("p", {
          class: "routing-note",
          text: "删除网站上保存的规则，回到仓库默认规则（局域网与中国大陆 IP 直连，其他走代理）。",
        }),
        btn(
          "恢复默认",
          () => {
            if (!confirm("恢复仓库默认规则？这会删除已保存的自定义规则和当前草稿。")) return;
            action(async () => {
              const result = await apiJson("/api/routing", { method: "DELETE" });
              if (!active()) return;
              draft = result.config;
              loaded = { ...loaded, config: structuredClone(result.config), origin: "default" };
              dirty = false;
              draw();
              toast("已恢复默认规则");
            });
          },
          { class: "danger" },
        ),
      ),
    );
  }

  function draw(focusLabel) {
    if (!active()) return;
    status = el("span", { role: "status", "aria-live": "polite" });
    pageError = el("p", { class: "form-error", role: "alert" });
    addError = el("p", { class: "form-error", role: "alert" });
    compatibility = el("p");
    saveBar = el(
      "div",
      { class: "routing-savebar" },
      el("span", { text: "有未保存的修改" }),
      el(
        "div",
        { class: "routing-toolbar" },
        btn("撤销修改", () => {
          if (!confirm("放弃所有未保存的修改？")) return;
          draft = structuredClone(loaded.config);
          dirty = false;
          draw();
        }),
        btn(
          "保存配置",
          () =>
            action(async () => {
              const empty = draft.groups.find((g) => !g.sourceIds.length);
              if (empty)
                throw new Error(`节点组「${empty.name || "未命名"}」还没有勾选任何源，请勾选或删除后再保存`);
              const result = await apiJson("/api/routing", {
                method: "PUT",
                body: JSON.stringify(draft),
              });
              if (!active()) return;
              draft = result.config;
              loaded = { ...loaded, config: structuredClone(result.config), origin: "saved" };
              dirty = false;
              draw();
              toast("已保存；Clash 更新订阅后生效，Hiddify 需重新导入规则");
            }),
          { class: "primary" },
        ),
      ),
    );
    page.replaceChildren(
      el(
        "div",
        { class: "routing-page" },
        el(
          "div",
          { class: "routing-heading" },
          el(
            "div",
            {},
            el("h1", { text: "分流规则" }),
            el("p", {
              class: "muted",
              text: "决定访问每个网站时走代理、直连还是拦截。",
            }),
          ),
          status,
        ),
        addCard(),
        rulesCard(),
        previewCard(),
        groupsCard(),
        advancedCard(),
        // 固定在视口底部：页面级错误与保存栏始终可见
        el("div", { class: "routing-dock" }, pageError, saveBar),
      ),
    );
    updateStatus();
    if (focusLabel) page.querySelector(`[aria-label="${focusLabel}"]`)?.focus();
  }
  draw();
}

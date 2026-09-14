/** 网站分流编辑器：纯 DOM；草稿只在明确保存后写入 D1。 */
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
  let status, error, jsonInput, compatibility;
  const types = [
    "DOMAIN",
    "DOMAIN-SUFFIX",
    "DOMAIN-KEYWORD",
    "IP-CIDR",
    "IP-CIDR6",
    "GEOIP",
  ];
  const labels = {
    DOMAIN: "完整域名",
    "DOMAIN-SUFFIX": "域名及子域名",
    "DOMAIN-KEYWORD": "域名关键词",
    "IP-CIDR": "IPv4 网段",
    "IP-CIDR6": "IPv6 网段",
    GEOIP: "国家 IP（Clash）",
  };
  const targetOptions = () => [
    ["PROXY", "代理 · 节点选择"],
    ["DIRECT", "直连"],
    ["REJECT", "拦截"],
    ...draft.groups.map((g) => [g.id, `${g.name || "未命名组"} · Clash`]),
  ];
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
        ...targetOptions().map(([v, name]) =>
          el("option", { value: v, text: name }),
        ),
      );
      input.value = value;
    }
  }
  function issues() {
    const messages = [];
    draft.rules.forEach((r, i) => {
      if (r.type === "GEOIP")
        messages.push(`第 ${i + 1} 条 GEOIP 不可直接导入 Hiddify`);
      if (r.target.startsWith("g_"))
        messages.push(`第 ${i + 1} 条使用 Clash 专属策略组`);
    });
    if (draft.final.startsWith("g_"))
      messages.push("兜底使用 Clash 专属策略组");
    return messages;
  }
  function updateStatus() {
    status.textContent = busy
      ? "正在处理…"
      : dirty
        ? "有未保存修改"
        : loaded.origin === "saved"
          ? "已保存的全局配置"
          : "使用仓库默认配置";
    const warnings = issues();
    compatibility.textContent = warnings.length
      ? `Hiddify 导出前需处理：${warnings.join("；")}。不会自动删除或降级这些规则。`
      : "当前规则可导出 Hiddify 原生格式；仍需在客户端单独导入并确认生效。";
    compatibility.className = warnings.length
      ? "routing-note warning"
      : "routing-note";
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
  async function action(work) {
    if (busy) return;
    busy = true;
    error.textContent = "";
    updateStatus();
    const controls = [
      ...page.querySelectorAll("input,select,textarea,button"),
    ].map((n) => [n, n.disabled]);
    controls.forEach(([n]) => {
      n.disabled = true;
    });
    try {
      await work();
    } catch (e) {
      if (active()) error.textContent = e.message;
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
  function draw() {
    if (!active()) return;
    status = el("span", {
      class: "muted",
      role: "status",
      "aria-live": "polite",
    });
    error = el("p", { class: "form-error", role: "alert" });
    compatibility = el("p");
    const btn = (text, fn, attrs = {}) =>
      el("button", { type: "button", text, onclick: fn, ...attrs });
    const groupRows = draft.groups.map((g, index) => {
      const name = el("input", {
        type: "text",
        value: g.name,
        maxlength: 64,
        placeholder: "如：自建节点",
        oninput: (e) => {
          g.name = e.target.value;
          changed();
          refreshTargets();
        },
      });
      const sourceList = el(
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
      );
      const missing = g.sourceIds.filter(
        (id) => !sources.some((s) => s.id === id),
      );
      if (missing.length)
        sourceList.append(
          el("p", {
            class: "form-error",
            text: `已删除的源 ID：${missing.join(", ")}；请导入修正后的 JSON 或删除本组。`,
          }),
        );
      return el(
        "fieldset",
        { class: "routing-group" },
        el("legend", { text: `策略组 ${index + 1}` }),
        el(
          "div",
          { class: "routing-group-head" },
          field("名称", name),
          field(
            "选择方式",
            select(
              [
                ["select", "手动选择"],
                ["url-test", "自动测速"],
              ],
              g.mode,
              (value) => {
                g.mode = value;
                changed();
              },
              "选择方式",
            ),
          ),
        ),
        el("p", { class: "mono muted", text: `ID: ${g.id}` }),
        sourceList,
        btn(
          "删除组",
          () => {
            if (
              draft.final === g.id ||
              draft.rules.some((r) => r.target === g.id)
            ) {
              error.textContent = "该组仍被规则或兜底引用，请先调整目标。";
              return;
            }
            draft.groups.splice(index, 1);
            dirty = true;
            draw();
          },
          { class: "small danger" },
        ),
      );
    });
    const ruleRows = draft.rules.map((r, i) =>
      el(
        "div",
        { class: "routing-rule" },
        field(
          `${i + 1}. 匹配条件`,
          select(
            types.map((t) => [t, labels[t]]),
            r.type,
            (value) => {
              r.type = value;
              changed();
            },
            `规则 ${i + 1} 类型`,
          ),
        ),
        field(
          "内容",
          el("input", {
            type: "text",
            value: r.value,
            placeholder: "example.com 或 10.0.0.0/8",
            maxlength: 253,
            "aria-label": `规则 ${i + 1} 内容`,
            oninput: (e) => {
              r.value = e.target.value;
              changed();
            },
          }),
        ),
        field(
          "动作",
          target(
            r.target,
            (value) => {
              r.target = value;
              changed();
            },
            `规则 ${i + 1} 动作`,
          ),
        ),
        el(
          "div",
          { class: "routing-row-actions" },
          btn(
            "↑",
            () => {
              [draft.rules[i - 1], draft.rules[i]] = [
                draft.rules[i],
                draft.rules[i - 1],
              ];
              dirty = true;
              draw();
            },
            {
              class: "small",
              disabled: i === 0,
              "aria-label": `上移规则 ${i + 1}`,
            },
          ),
          btn(
            "↓",
            () => {
              [draft.rules[i + 1], draft.rules[i]] = [
                draft.rules[i],
                draft.rules[i + 1],
              ];
              dirty = true;
              draw();
            },
            {
              class: "small",
              disabled: i === draft.rules.length - 1,
              "aria-label": `下移规则 ${i + 1}`,
            },
          ),
          btn(
            "删除",
            () => {
              draft.rules.splice(i, 1);
              dirty = true;
              draw();
            },
            { class: "small danger", "aria-label": `删除规则 ${i + 1}` },
          ),
        ),
      ),
    );
    const domain = el("input", {
      type: "text",
      placeholder: "例如：www.example.com",
      "aria-label": "预览域名",
    });
    const preview = el("p", { role: "status", class: "routing-note" });
    jsonInput = el("textarea", {
      class: "routing-json",
      spellcheck: "false",
      "aria-label": "分流配置 JSON",
    });
    jsonInput.value = JSON.stringify(draft, null, 2);
    const file = el("input", {
      type: "file",
      accept: ".json,application/json",
      "aria-label": "导入 JSON 文件",
      onchange: () =>
        action(async () => {
          const selected = file.files?.[0];
          if (!selected) return;
          if (selected.size > 65536)
            throw new Error("JSON 文件不能超过 64 KiB");
          let parsed;
          try {
            parsed = JSON.parse(await selected.text());
          } catch {
            throw new Error("JSON 文件语法无效");
          }
          const result = await validate(parsed);
          if (!active()) return;
          draft = result.config;
          dirty = true;
          draw();
          toast("已导入草稿，尚未保存");
        }),
    });
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
            el("h1", { text: "分流设置" }),
            el("p", {
              class: "muted",
              text: "一份 JSON 配置，统一管理节点分组与流量去向。",
            }),
          ),
          status,
        ),
        error,
        el(
          "section",
          { class: "card" },
          el("h2", { text: "1. 节点分组 · Clash" }),
          el("p", {
            class: "routing-note",
            text: "按源选择节点；每个 token 只能获得自己绑定的节点。被规则引用的组没有可用节点时，订阅会报错，不会自动改为直连。",
          }),
          ...groupRows,
          btn(
            "添加策略组",
            () => {
              draft.groups.push({
                id: `g_${crypto.randomUUID().slice(0, 8)}`,
                name: "新分组",
                mode: "select",
                sourceIds: [],
              });
              dirty = true;
              draw();
            },
            { disabled: draft.groups.length >= 32 },
          ),
        ),
        el(
          "section",
          { class: "card" },
          el("h2", { text: "2. 分流规则" }),
          el("p", {
            class: "routing-note",
            text: "从上往下匹配，首条命中生效。局域网、国内 IP 等默认规则也在下方，可修改或排序。",
          }),
          ...ruleRows,
          btn(
            "添加规则",
            () => {
              draft.rules.push({
                type: "DOMAIN-SUFFIX",
                value: "",
                target: "PROXY",
              });
              dirty = true;
              draw();
            },
            { disabled: draft.rules.length >= 256 },
          ),
          el(
            "div",
            { class: "routing-final" },
            field(
              "未命中规则的流量（兜底，始终最后）",
              target(
                draft.final,
                (value) => {
                  draft.final = value;
                  changed();
                },
                "兜底动作",
              ),
            ),
          ),
        ),
        el(
          "section",
          { class: "card" },
          el("h2", { text: "3. 域名规则预览" }),
          field("输入域名", domain),
          btn("预览匹配", () =>
            action(async () => {
              const result = await apiJson("/api/routing/preview", {
                method: "POST",
                body: JSON.stringify({ config: draft, domain: domain.value }),
              });
              if (!active()) return;
              const label =
                targetOptions().find(([id]) => id === result.target)?.[1] ??
                result.target;
              preview.textContent = `${result.index === null ? "未匹配域名规则，兜底" : `域名匹配第 ${result.index + 1} 条`} → ${label}。${result.uncertain ? "前置 IP/GEOIP 规则可能改变实际结果。" : ""}${result.note}`;
            }),
          ),
          preview,
        ),
        el(
          "section",
          { class: "card" },
          el("h2", { text: "4. JSON 与客户端导出" }),
          el("p", {
            class: "routing-note",
            text: "默认文件：config/routing.default.json。网站保存的是 D1 覆盖，不回写仓库；手改默认文件需要重新部署。JSON 导入只更新草稿。",
          }),
          // toggle 是延迟事件，不能用它回填文本，否则可能覆盖刚输入的 JSON。
          el(
            "details",
            {},
            el("summary", {
              text: "编辑 JSON 草稿",
              onclick: (e) => {
                if (!e.currentTarget.parentElement.open)
                  jsonInput.value = JSON.stringify(draft, null, 2);
              },
            }),
            jsonInput,
            btn("应用 JSON 到表单", () =>
              action(async () => {
                let parsed;
                try {
                  parsed = JSON.parse(jsonInput.value);
                } catch {
                  throw new Error("JSON 语法无效");
                }
                const result = await validate(parsed);
                if (!active()) return;
                draft = result.config;
                dirty = true;
                draw();
                toast("已应用到草稿，尚未保存");
              }),
            ),
          ),
          field("从本地导入 JSON", file),
          el(
            "div",
            { class: "routing-toolbar" },
            btn("导出配置 JSON", () =>
              action(async () => {
                const result = await validate(draft);
                if (active()) download("routing.json", result.config);
              }),
            ),
            btn("导出 Hiddify 规则", () =>
              action(async () => {
                const result = await apiJson("/api/routing/hiddify", {
                  method: "POST",
                  body: JSON.stringify(draft),
                });
                if (active()) download("hiddify-rules.json", result);
              }),
            ),
          ),
          compatibility,
          el("p", {
            class: "routing-note",
            text: "Hiddify 4.1.1：节点订阅仍用 Base64；规则需在客户端路由规则页从 JSON 文件单独导入，更新后重新导入。会替换客户端规则列表，请先备份；代理目标表示客户端当前选中的节点。导出格式校验不等于实际线路分流验证。",
          }),
        ),
        el(
          "div",
          { class: "routing-toolbar routing-save" },
          btn(
            "保存配置",
            () =>
              action(async () => {
                const result = await apiJson("/api/routing", {
                  method: "PUT",
                  body: JSON.stringify(draft),
                });
                if (!active()) return;
                draft = result.config;
                loaded.origin = "saved";
                dirty = false;
                draw();
                toast("已保存；Clash 更新订阅后生效，Hiddify 需重新导入规则");
              }),
            { class: "primary" },
          ),
          btn("恢复默认", () => {
            if (!confirm("恢复仓库内默认规则？这会删除已保存覆盖及当前草稿。"))
              return;
            action(async () => {
              const result = await apiJson("/api/routing", {
                method: "DELETE",
              });
              if (!active()) return;
              draft = result.config;
              loaded.origin = "default";
              dirty = false;
              draw();
              toast("已恢复默认");
            });
          }),
        ),
      ),
    );
    updateStatus();
  }
  draw();
}

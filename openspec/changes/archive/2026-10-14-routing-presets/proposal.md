# 分流：远程规则集、地区去向、常用服务模板、规则备注

## Why
改版后的分流页解决了「怎么用」，但规则内容仍全靠手写：想拦广告、让国内网站直连，需要自己维护成百上千个域名；想让 ChatGPT 固定走美国节点，得先建一个按源划分的节点组；规则多了以后也看不出每条是干什么的。

## What Changes
1. **远程规则集**：规则类型新增 `RULE-SET`，内容为内置目录中的规则集 ID（Loyalsoldier/clash-rules：广告、私有网络、国内直连、代理列表、GFWList、Apple、iCloud、非中国大陆顶级域、Telegram/中国大陆/局域网 IP 段、直连软件）。Clash 输出 `rule-providers` 与 `RULE-SET,<id>,<去向>`，由客户端自行下载更新；不经过 Worker、不占 KV。Hiddify 导出拒绝并说明。
2. **地区去向**：规则与兜底可指向地区组（`region:hk` 等，对应 Clash 输出里的 🇭🇰 香港 等地区组）。某个 token 没有该地区节点时，该规则改走「🚀 节点选择」，订阅不失败。Hiddify 导出拒绝并说明。
3. **常用服务模板**（仅前端）：OpenAI/ChatGPT、Claude、Google、YouTube、Telegram、Netflix、X/Twitter、GitHub、Discord、Spotify、Apple、Microsoft 等一键生成普通域名/IP 规则，自动带备注；生成后与手写规则无异，可编辑删除。
4. **规则备注**：规则可带可选 `note`（≤64 字）；只用于管理与 Hiddify 规则名，不进入 Clash 规则行。

分流页「添加规则」卡片改为三个标签页：手动输入 / 常用服务 / 远程规则集；规则行增加备注输入；去向下拉按「基本 / 地区 / 节点组」分组。

## 非目标
不支持任意自定义规则集 URL、不在 Worker 端下载或解析规则集、不做按 token 的不同规则、不新增 PROCESS-NAME/端口等规则类型。

## 影响
`src/lib/routing.ts`（模型/校验/编译）、新增 `src/lib/rulesets.ts`、`clash-render.ts`（rule-providers、地区回退）、`hiddify-rules.ts`、`/api/routing` 返回规则集目录、分流页前端与模板数据、`config/README.md`。旧配置无需迁移。

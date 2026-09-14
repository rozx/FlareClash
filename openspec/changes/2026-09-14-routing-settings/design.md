# 设计

- 默认值位于 config/routing.default.json，打包进入 Worker；运行时不写文件系统。D1 保存单例 JSON 覆盖；恢复默认删除覆盖，不访问 KV。
- groups 使用稳定 ID 和 sourceIds；规则目标 DIRECT / REJECT / PROXY 或组 ID。编译策略组时只使用 token 授权且获取成功的源，按真实聚合名称去重。引用组为空时拒绝生成，不回退直连。
- 域名规则大小写/IDNA规范化、CIDR和目标严格校验，限制配置大小/规则数量，拒绝未知字段，防止 YAML 规则注入。
- Hiddify 4.1.1 的原生 RouteRule JSON 使用 protobuf 字段编号，不是 sing-box 配置；需单独导入文件，修改后重新导入。定向组不支持，导出返回明确错误，不能静默改为普通代理。
- 预览只匹配域名规则，不联网 DNS 或推断 GEOIP；早于域名命中的 IP 规则令最终结果不确定。
- 回归边界：管理 API、订阅响应、规则预览与原生文件导出。

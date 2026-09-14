import { Hono } from "hono";
import { buildHiddifyRules, hiddifyIssues } from "../lib/hiddify-rules";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "../env";
import {
  existingSourceIds,
  getRoutingConfig,
  resetRoutingConfig,
  saveRoutingConfig,
} from "../repo";
import {
  defaultRoutingConfig,
  MAX_ROUTING_BYTES,
  parseRoutingConfig,
  previewDomain,
  type RoutingConfig,
} from "../lib/routing";

// 由 /api 的认证中间件统一保护，不单独暴露未认证路由。
const routing = new Hono<{ Bindings: Env }>();
routing.use(
  "*",
  bodyLimit({
    maxSize: MAX_ROUTING_BYTES,
    onError: (c) => c.json({ error: "分流配置不能超过 64 KiB" }, 413),
  }),
);
routing.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
async function validateSources(db: D1Database, config: RoutingConfig) {
  const ids = [...new Set(config.groups.flatMap((g) => g.sourceIds))];
  // D1 单条语句绑定参数有上限；多组源 ID 去重后分批校验。
  for (let i = 0; i < ids.length; i += 80) {
    const batch = ids.slice(i, i + 80);
    const found = await existingSourceIds(db, batch);
    if (found.size !== batch.length)
      throw new Error("策略组引用不存在的源，请重新选择");
  }
}
routing.get("/", async (c) =>
  c.json({
    ...(await getRoutingConfig(c.env.DB)),
    defaults: defaultRoutingConfig(),
  }),
);
routing.put("/", async (c) => {
  let config: RoutingConfig;
  try {
    config = parseRoutingConfig(await c.req.json());
    await validateSources(c.env.DB, config);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  await saveRoutingConfig(c.env.DB, config);
  return c.json({ config, origin: "saved" });
});
routing.delete("/", async (c) => {
  await resetRoutingConfig(c.env.DB);
  return c.json({ config: defaultRoutingConfig(), origin: "default" });
});
routing.post("/preview", async (c) => {
  try {
    const body = await c.req.json<{ config: unknown; domain: unknown }>();
    const config = parseRoutingConfig(body.config);
    await validateSources(c.env.DB, config);
    return c.json(previewDomain(config, body.domain));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
routing.post("/validate", async (c) => {
  try {
    const config = parseRoutingConfig(await c.req.json());
    await validateSources(c.env.DB, config);
    return c.json({ config, hiddifyIssues: hiddifyIssues(config) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
routing.post("/hiddify", async (c) => {
  let config: RoutingConfig;
  try {
    config = parseRoutingConfig(await c.req.json());
    await validateSources(c.env.DB, config);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  try {
    const result = buildHiddifyRules(config);
    c.header(
      "Content-Disposition",
      'attachment; filename="hiddify-rules.json"',
    );
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});
export default routing;

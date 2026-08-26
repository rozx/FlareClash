import { Hono } from "hono";
import type { Env } from "./env";
import sub from "./routes/sub";
import api from "./routes/api";

const app = new Hono<{ Bindings: Env }>();

// 统一错误处理：意外异常不向客户端泄露内部细节
app.onError((err, c) => {
  console.error("unhandled error:", err);
  return c.json({ error: "internal error" }, 500);
});

// 订阅端点：GET /sub/:token
app.route("/sub", sub);

// 管理 API：/api/*
app.route("/api", api);

// 兜底：根路径占位（管理页由 Static Assets 从 /admin 直接服务）
app.get("/", (c) => c.text("FlareClash"));

export default app;

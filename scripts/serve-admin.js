// 浏览器测试专用静态服务，不读取生产配置或启动 Worker。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = resolve("public");
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const file = resolve(
      root,
      `.${decodeURIComponent(url.pathname)}`,
      url.pathname.endsWith("/") ? "index.html" : "",
    );
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const content = await readFile(file);
    res
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "application/javascript",
            ".css": "text/css",
            ".html": "text/html",
          }[extname(file)] ?? "text/plain",
      })
      .end(content);
  } catch {
    res.writeHead(404).end();
  }
}).listen(8789, "127.0.0.1");

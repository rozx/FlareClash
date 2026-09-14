import { detectFormat } from "./detect";

export interface SourceLocation {
  kind: "fetch" | "static";
  url: string;
  content: string | null;
}

/** 创建和编辑共用的源类型校验；不访问数据库或 KV。 */
export function parseSourceLocation(
  body: { kind?: unknown; url?: unknown; content?: unknown },
  current?: SourceLocation,
): SourceLocation | { error: string } {
  const kind = body.kind === undefined ? (current?.kind ?? "fetch") : body.kind;
  if (kind !== "fetch" && kind !== "static")
    return { error: "kind 必须是 fetch 或 static" };
  if (kind === "static") {
    const content =
      body.content === undefined ? current?.content : body.content;
    if (typeof content !== "string" || !content.trim())
      return { error: "content 必填（每行一条分享链接）" };
    const result = detectFormat(content);
    if ("error" in result) return { error: "内容无法解析为有效节点" };
    return { kind, url: "", content };
  }
  const url = body.url === undefined ? current?.url : body.url;
  if (typeof url !== "string") return { error: "url 必须是 http(s) 地址" };
  try {
    const parsed = new URL(url.trim());
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname)
      throw new Error();
  } catch {
    return { error: "url 必须是 http(s) 地址" };
  }
  return { kind, url: url.trim(), content: null };
}

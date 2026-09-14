import { describe, expect, it } from "vitest";
import { parseSourceLocation } from "../../src/lib/source-input";
import { b64Encode } from "../../src/lib/b64";

const link = "vless://test-user@proxy.example.com:443?security=tls#test";
const staticSource = { kind: "static" as const, url: "", content: link };

describe("源类型输入边界", () => {
  it("省略 kind 兼容旧 URL 源", () => {
    expect(
      parseSourceLocation({ url: "https://upstream.example.com/sub" }),
    ).toEqual({
      kind: "fetch",
      url: "https://upstream.example.com/sub",
      content: null,
    });
  });
  it("静态源省略 content 保持原内容", () => {
    expect(parseSourceLocation({}, staticSource)).toEqual(staticSource);
  });
  it("明文和 base64 节点内容均可接受", () => {
    for (const content of [link, b64Encode(link)])
      expect(parseSourceLocation({ kind: "static", content })).toEqual({
        ...staticSource,
        content,
      });
  });
  it.each([null, "unsupported", 1])(
    "非法 kind 被拒绝而非静默转 fetch：%s",
    (kind) => {
      expect(
        parseSourceLocation({ kind, url: "https://upstream.example.com/sub" }),
      ).toHaveProperty("error");
    },
  );
  it.each([null, "", "https://", "file:///tmp/a", "ftp://example.com", 123])(
    "无效 URL 被拒绝：%s",
    (url) => {
      expect(
        parseSourceLocation({ kind: "fetch", url }, staticSource),
      ).toHaveProperty("error");
    },
  );
  it.each([null, 123, " ", "not-a-link", "proxies: []"])(
    "静态内容预检拒绝不可用输入：%s",
    (content) => {
      expect(parseSourceLocation({ kind: "static", content })).toHaveProperty(
        "error",
      );
    },
  );
  it("兼容原有 YAML 格式探测，不制造仅 base64 才能解析的路径", () => {
    const content =
      "proxies:\n  - {name: test, type: vless, server: proxy.example.com, port: 443, uuid: test-user}";
    expect(parseSourceLocation({ kind: "static", content })).toEqual({
      ...staticSource,
      content,
    });
  });
});

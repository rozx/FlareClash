import { describe, expect, it } from "vitest";
import { b64Decode, b64Encode, b64UrlEncode } from "../../src/lib/b64";

describe("base64 工具", () => {
  it("往返（ASCII）", () => {
    expect(b64Encode("hello world")).toBe("aGVsbG8gd29ybGQ=");
    expect(b64Decode("aGVsbG8gd29ybGQ=")).toBe("hello world");
  });

  it("往返（UTF-8 中文）", () => {
    const s = "香港节点🇭🇰 IPLC";
    expect(b64Decode(b64Encode(s))).toBe(s);
  });

  it("url-safe 输入可解码", () => {
    expect(b64Decode("aGVsbG8_d29ybGQ")).toBe("hello?world");
    expect(b64Decode("aGVsbG8-d29ybGQ")).toBe("hello>world");
  });

  it("无 padding 输入可解码", () => {
    expect(b64Decode("aGVsbG8")).toBe("hello");
  });

  it("非法输入返回 null", () => {
    expect(b64Decode("!!!not-base64!!!")).toBeNull();
  });

  it("b64UrlEncode 输出无 +/ 与 padding", () => {
    expect(b64UrlEncode("hello?world")).toBe("aGVsbG8_d29ybGQ");
    expect(b64UrlEncode("ab")).toBe("YWI");
  });
});

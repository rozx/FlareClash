import { describe, expect, it } from "vitest";
import { parseEntries, ruleHint } from "../../public/admin/routing.js";

describe("分流页批量输入解析", () => {
  it("自动识别：网址取域名，IP 补掩码，换行/逗号/空格分隔", () => {
    expect(
      parseEntries(
        "https://chat.openai.com/c/1\nopenai.com，10.8.0.0/16 1.1.1.1  2001:db8::/32",
        "auto",
      ),
    ).toEqual([
      { raw: "https://chat.openai.com/c/1", type: "DOMAIN-SUFFIX", value: "chat.openai.com" },
      { raw: "openai.com", type: "DOMAIN-SUFFIX", value: "openai.com" },
      { raw: "10.8.0.0/16", type: "IP-CIDR", value: "10.8.0.0/16" },
      { raw: "1.1.1.1", type: "IP-CIDR", value: "1.1.1.1/32" },
      { raw: "2001:db8::/32", type: "IP-CIDR6", value: "2001:db8::/32" },
    ]);
  });

  it("去掉通配前缀、端口与大小写", () => {
    expect(parseEntries("*.Google.com .youtube.com example.com:8443", "auto")).toEqual([
      { raw: "*.Google.com", type: "DOMAIN-SUFFIX", value: "google.com" },
      { raw: ".youtube.com", type: "DOMAIN-SUFFIX", value: "youtube.com" },
      { raw: "example.com:8443", type: "DOMAIN-SUFFIX", value: "example.com" },
    ]);
  });

  it("显式类型：仅该域名、关键词、国家代码、IP 段", () => {
    expect(parseEntries("https://www.a.com/x", "DOMAIN")).toEqual([
      { raw: "https://www.a.com/x", type: "DOMAIN", value: "www.a.com" },
    ]);
    expect(parseEntries("google", "DOMAIN-KEYWORD")[0]).toMatchObject({
      type: "DOMAIN-KEYWORD",
      value: "google",
    });
    expect(parseEntries("cn", "GEOIP")[0]).toMatchObject({ type: "GEOIP", value: "CN" });
    expect(parseEntries("::1", "IP")[0]).toMatchObject({ type: "IP-CIDR6", value: "::1/128" });
  });

  it("自动识别不把两位字母当国家代码", () => {
    expect(parseEntries("cn", "auto")[0]).toMatchObject({ type: "DOMAIN-SUFFIX", value: "cn" });
  });

  it("空输入返回空数组", () => {
    expect(parseEntries(" \n ,， ", "auto")).toEqual([]);
  });
});

describe("内置规则说明", () => {
  it("常见局域网与国家规则有中文说明", () => {
    expect(ruleHint({ type: "IP-CIDR", value: "192.168.0.0/16" })).toBe("局域网");
    expect(ruleHint({ type: "IP-CIDR", value: "127.0.0.0/8" })).toBe("本机");
    expect(ruleHint({ type: "GEOIP", value: "CN" })).toBe("中国大陆 IP");
    expect(ruleHint({ type: "DOMAIN-SUFFIX", value: "google.com" })).toBe("");
  });
});

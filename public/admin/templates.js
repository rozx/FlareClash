/**
 * 常用服务模板：一键生成普通域名/IP 规则，生成后与手写规则无异。
 * 单测（tests/unit/admin-templates.test.ts）用服务端校验逐项验证，值须已是规范化形式。
 */
const suffix = (...values) => values.map((value) => ({ type: "DOMAIN-SUFFIX", value }));
const cidr = (...values) =>
  values.map((value) => ({ type: value.includes(":") ? "IP-CIDR6" : "IP-CIDR", value }));

export const TEMPLATES = [
  {
    id: "openai",
    name: "OpenAI / ChatGPT",
    suggested: "PROXY",
    rules: suffix("openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com", "sora.com"),
  },
  {
    id: "claude",
    name: "Claude",
    suggested: "PROXY",
    rules: suffix("anthropic.com", "claude.ai", "claude.com", "claudeusercontent.com"),
  },
  {
    id: "google",
    name: "Google（含 Gemini）",
    suggested: "PROXY",
    rules: suffix(
      "google.com",
      "googleapis.com",
      "gstatic.com",
      "googleusercontent.com",
      "ggpht.com",
      "gvt1.com",
      "gvt2.com",
    ),
  },
  {
    id: "youtube",
    name: "YouTube",
    suggested: "PROXY",
    rules: suffix("youtube.com", "youtu.be", "googlevideo.com", "ytimg.com", "youtube-nocookie.com"),
  },
  {
    id: "telegram",
    name: "Telegram",
    suggested: "PROXY",
    rules: [
      ...suffix("telegram.org", "t.me", "telegram.me", "tdesktop.com", "telesco.pe", "telegra.ph"),
      // 官方列表 https://core.telegram.org/resources/cidr.txt（2026-10-14 取）
      ...cidr(
        "91.105.192.0/23",
        "91.108.4.0/22",
        "91.108.8.0/22",
        "91.108.12.0/22",
        "91.108.16.0/22",
        "91.108.20.0/22",
        "91.108.56.0/22",
        "149.154.160.0/20",
        "185.76.151.0/24",
        "2001:67c:4e8::/48",
        "2001:b28:f23c::/48",
        "2001:b28:f23d::/48",
        "2001:b28:f23f::/48",
        "2a0a:f280::/32",
      ),
    ],
  },
  {
    id: "netflix",
    name: "Netflix",
    suggested: "PROXY",
    rules: suffix(
      "netflix.com",
      "netflix.net",
      "nflxext.com",
      "nflximg.com",
      "nflximg.net",
      "nflxso.net",
      "nflxvideo.net",
    ),
  },
  {
    id: "twitter",
    name: "X / Twitter",
    suggested: "PROXY",
    rules: suffix("x.com", "twitter.com", "twimg.com", "t.co"),
  },
  {
    id: "github",
    name: "GitHub",
    suggested: "PROXY",
    rules: suffix("github.com", "githubusercontent.com", "githubassets.com", "github.io", "ghcr.io"),
  },
  {
    id: "discord",
    name: "Discord",
    suggested: "PROXY",
    rules: suffix("discord.com", "discord.gg", "discordapp.com", "discordapp.net", "discord.media"),
  },
  {
    id: "spotify",
    name: "Spotify",
    suggested: "PROXY",
    rules: suffix("spotify.com", "scdn.co", "spotifycdn.com"),
  },
  {
    id: "apple",
    name: "Apple / iCloud",
    suggested: "DIRECT",
    rules: suffix(
      "apple.com",
      "icloud.com",
      "icloud-content.com",
      "mzstatic.com",
      "cdn-apple.com",
      "apple-cloudkit.com",
    ),
  },
  {
    id: "microsoft",
    name: "Microsoft / Office",
    suggested: "DIRECT",
    rules: suffix(
      "microsoft.com",
      "live.com",
      "office.com",
      "office.net",
      "microsoftonline.com",
      "windows.com",
      "windowsupdate.com",
    ),
  },
];

import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatExpire,
  formatInterval,
  formatUsage,
} from "../../public/admin/format.js";

describe("管理页订阅用量格式化", () => {
  it("字节转换为人类可读 IEC 单位", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(10 * 1024 ** 3)).toBe("10 GiB");
  });

  it("已用量为 upload + download，总量 0 显示无限", () => {
    expect(
      formatUsage({
        userInfo: { upload: 1024, download: 2048, total: 10 * 1024 ** 3 },
      }),
    ).toBe("3 KiB / 10 GiB");
    expect(
      formatUsage({ userInfo: { upload: 1, download: 2, total: 0 } }),
    ).toBe("3 B / ∞");
    expect(formatUsage(null)).toBe("暂无");
  });

  it("到期时间稳定显示为日期，无到期值显示无限期", () => {
    expect(formatExpire({ userInfo: { expire: 2_000_000_000 } })).toBe(
      "2033-05-18",
    );
    expect(formatExpire({ userInfo: {} })).toBe("无限期");
    expect(formatExpire(null)).toBe("暂无");
  });

  it("更新间隔显示小时", () => {
    expect(formatInterval({ profileUpdateInterval: 24 })).toBe("24 小时");
    expect(formatInterval(null)).toBe("暂无");
  });
});

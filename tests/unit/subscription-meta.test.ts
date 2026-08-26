import { describe, expect, it } from "vitest";
import {
  aggregateSubscriptionMetadata,
  parseSubscriptionMetadata,
  parseSubscriptionUserInfo,
  renderSubscriptionMetadataHeaders,
} from "../../src/lib/subscription-meta";

describe("订阅用量元数据", () => {
  it("解析标准响应头", () => {
    const headers = new Headers({
      "subscription-userinfo":
        "upload=1024; download=2048; total=10737418240; expire=2000000000",
      "profile-update-interval": "24",
    });
    expect(parseSubscriptionMetadata(headers)).toEqual({
      userInfo: {
        upload: 1024,
        download: 2048,
        total: 10737418240,
        expire: 2000000000,
      },
      profileUpdateInterval: 24,
    });
  });

  it("核心字段缺失、负数、非数字与溢出均视为畸形", () => {
    expect(parseSubscriptionUserInfo("upload=1; download=2")).toBeNull();
    expect(
      parseSubscriptionUserInfo("upload=-1; download=2; total=3"),
    ).toBeNull();
    expect(
      parseSubscriptionUserInfo("upload=1; download=x; total=3"),
    ).toBeNull();
    expect(
      parseSubscriptionUserInfo(
        "upload=1; download=2; total=999999999999999999999",
      ),
    ).toBeNull();
  });

  it("多源流量求和、到期与更新间隔取最小正值", () => {
    const meta = aggregateSubscriptionMetadata([
      {
        userInfo: { upload: 100, download: 200, total: 1000, expire: 2000 },
        profileUpdateInterval: 24,
      },
      {
        userInfo: { upload: 10, download: 20, total: 500, expire: 1500 },
        profileUpdateInterval: 12,
      },
      null,
    ]);
    expect(meta).toEqual({
      userInfo: { upload: 110, download: 220, total: 1500, expire: 1500 },
      profileUpdateInterval: 12,
    });
    expect(renderSubscriptionMetadataHeaders(meta)).toEqual({
      "subscription-userinfo":
        "upload=110; download=220; total=1500; expire=1500",
      "profile-update-interval": "12",
    });
  });

  it("全部缺失时不生成响应头", () => {
    expect(parseSubscriptionMetadata(new Headers())).toBeNull();
    expect(aggregateSubscriptionMetadata([null, undefined])).toBeNull();
    expect(renderSubscriptionMetadataHeaders(null)).toEqual({});
  });

  it("任一源 total=0（无限流量）时聚合总量为无限", () => {
    const meta = aggregateSubscriptionMetadata([
      { userInfo: { upload: 100, download: 200, total: 0 } },
      { userInfo: { upload: 10, download: 20, total: 500 } },
    ]);
    expect(meta?.userInfo).toEqual({ upload: 110, download: 220, total: 0 });
    // render 时 total=0 不代表任何有限额度，直接输出 0（客户端按无限显示）
    expect(renderSubscriptionMetadataHeaders(meta)).toEqual({
      "subscription-userinfo": "upload=110; download=220; total=0",
    });
  });
});

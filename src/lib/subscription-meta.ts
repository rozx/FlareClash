export interface SubscriptionUserInfo {
  upload: number;
  download: number;
  total: number;
  expire?: number;
}

export interface SubscriptionMetadata {
  userInfo?: SubscriptionUserInfo;
  /** 客户端建议更新间隔（小时） */
  profileUpdateInterval?: number;
}

type HeaderReader = Pick<Headers, "get">;

function nonNegativeInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** 解析标准 subscription-userinfo；核心三字段缺失/畸形则整组忽略。 */
export function parseSubscriptionUserInfo(
  raw: string | null,
): SubscriptionUserInfo | null {
  if (!raw) return null;
  const fields = new Map<string, string>();
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    fields.set(
      part.slice(0, eq).trim().toLowerCase(),
      part.slice(eq + 1).trim(),
    );
  }
  const upload = nonNegativeInteger(fields.get("upload"));
  const download = nonNegativeInteger(fields.get("download"));
  const total = nonNegativeInteger(fields.get("total"));
  if (upload === null || download === null || total === null) return null;
  const expireRaw = fields.get("expire");
  if (expireRaw === undefined) return { upload, download, total };
  const expire = nonNegativeInteger(expireRaw);
  if (expire === null) return null;
  return { upload, download, total, expire };
}

/** 从上游响应头提取合法订阅元数据；全部缺失/畸形时返回 null。 */
export function parseSubscriptionMetadata(
  headers: HeaderReader,
): SubscriptionMetadata | null {
  const userInfo = parseSubscriptionUserInfo(
    headers.get("subscription-userinfo"),
  );
  const intervalRaw = headers.get("profile-update-interval")?.trim();
  const interval = nonNegativeInteger(intervalRaw);
  const profileUpdateInterval =
    interval !== null && interval > 0 ? interval : undefined;
  if (!userInfo && profileUpdateInterval === undefined) return null;
  return {
    ...(userInfo ? { userInfo } : {}),
    ...(profileUpdateInterval === undefined ? {} : { profileUpdateInterval }),
  };
}

/** KV envelope 解码时使用，拒绝被篡改或旧版本的不合法结构。 */
export function isSubscriptionMetadata(
  value: unknown,
): value is SubscriptionMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const meta = value as Record<string, unknown>;
  if (meta.userInfo !== undefined) {
    if (
      typeof meta.userInfo !== "object" ||
      meta.userInfo === null ||
      Array.isArray(meta.userInfo)
    ) {
      return false;
    }
    const u = meta.userInfo as Record<string, unknown>;
    for (const key of ["upload", "download", "total"] as const) {
      if (!Number.isSafeInteger(u[key]) || (u[key] as number) < 0) return false;
    }
    if (
      u.expire !== undefined &&
      (!Number.isSafeInteger(u.expire) || (u.expire as number) < 0)
    ) {
      return false;
    }
  }
  if (
    meta.profileUpdateInterval !== undefined &&
    (!Number.isSafeInteger(meta.profileUpdateInterval) ||
      (meta.profileUpdateInterval as number) <= 0)
  ) {
    return false;
  }
  return (
    meta.userInfo !== undefined || meta.profileUpdateInterval !== undefined
  );
}

function safeSum(values: number[]): number | null {
  const sum = values.reduce((a, b) => a + b, 0);
  return Number.isSafeInteger(sum) ? sum : null;
}

/** 多源元数据聚合：流量求和，到期取最早正值，更新间隔取最短正值。 */
export function aggregateSubscriptionMetadata(
  items: readonly (SubscriptionMetadata | null | undefined)[],
): SubscriptionMetadata | null {
  const metas = items.filter(
    (item): item is SubscriptionMetadata => item !== null && item !== undefined,
  );
  const infos = metas.flatMap((m) => (m.userInfo ? [m.userInfo] : []));
  let userInfo: SubscriptionUserInfo | undefined;
  if (infos.length > 0) {
    const upload = safeSum(infos.map((i) => i.upload));
    const download = safeSum(infos.map((i) => i.download));
    const total = safeSum(infos.map((i) => i.total));
    if (upload !== null && download !== null && total !== null) {
      const expires = infos
        .map((i) => i.expire)
        .filter((v): v is number => v !== undefined && v > 0);
      userInfo = {
        upload,
        download,
        total,
        ...(expires.length > 0 ? { expire: Math.min(...expires) } : {}),
      };
    }
  }
  const intervals = metas
    .map((m) => m.profileUpdateInterval)
    .filter((v): v is number => v !== undefined && v > 0);
  const profileUpdateInterval =
    intervals.length > 0 ? Math.min(...intervals) : undefined;
  if (!userInfo && profileUpdateInterval === undefined) return null;
  return {
    ...(userInfo ? { userInfo } : {}),
    ...(profileUpdateInterval === undefined ? {} : { profileUpdateInterval }),
  };
}

/** 生成客户端识别的标准订阅响应头。 */
export function renderSubscriptionMetadataHeaders(
  metadata: SubscriptionMetadata | null,
): Record<string, string> {
  if (!metadata) return {};
  const headers: Record<string, string> = {};
  if (metadata.userInfo) {
    const { upload, download, total, expire } = metadata.userInfo;
    headers["subscription-userinfo"] = [
      `upload=${upload}`,
      `download=${download}`,
      `total=${total}`,
      ...(expire !== undefined && expire > 0 ? [`expire=${expire}`] : []),
    ].join("; ");
  }
  if (metadata.profileUpdateInterval !== undefined) {
    headers["profile-update-interval"] = String(metadata.profileUpdateInterval);
  }
  return headers;
}

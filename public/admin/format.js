function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function formatBytes(bytes) {
  if (!finiteNonNegative(bytes)) return "暂无";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  return `${Number(value.toFixed(1))} ${unit}`;
}

export function formatUsage(metadata) {
  const info = metadata?.userInfo;
  if (
    !info ||
    !finiteNonNegative(info.upload) ||
    !finiteNonNegative(info.download) ||
    !finiteNonNegative(info.total)
  ) {
    return "暂无";
  }
  const used = info.upload + info.download;
  const total = info.total === 0 ? "∞" : formatBytes(info.total);
  return `${formatBytes(used)} / ${total}`;
}

export function formatExpire(metadata) {
  const info = metadata?.userInfo;
  if (!info) return "暂无";
  if (info.expire === undefined || info.expire === 0) return "无限期";
  if (!finiteNonNegative(info.expire)) return "暂无";
  return new Date(info.expire * 1000).toISOString().slice(0, 10);
}

export function formatInterval(metadata) {
  const interval = metadata?.profileUpdateInterval;
  return typeof interval === "number" &&
    Number.isInteger(interval) &&
    interval > 0
    ? `${interval} 小时`
    : "暂无";
}

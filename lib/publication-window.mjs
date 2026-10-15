// All clock bins are Asia/Shanghai. No timestamp is inferred from video IDs.
export function publicationWindow(
  records,
  { start = "2026-01-01", end = "9999-12-31", bufferMinutes = 60 } = {},
) {
  const rows = records
    .filter((r) => r.timeVerified && r.sourceType === "original")
    .map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      publishedAt: r.publishedAt,
      local: new Date(
        new Date(r.publishedAt).getTime() + 8 * 3600000,
      ).toISOString(),
    }))
    .filter(
      (r) => r.local.slice(0, 10) >= start && r.local.slice(0, 10) <= end,
    );
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const r of rows) hours[Number(r.local.slice(11, 13))].count++;
  const minute = (r) =>
    Number(r.local.slice(11, 13)) * 60 + Number(r.local.slice(14, 16));
  const minutes = rows.map(minute),
    first = minutes.length ? Math.min(...minutes) : null,
    last = minutes.length ? Math.max(...minutes) : null;
  const from =
      first === null
        ? null
        : Math.max(0, Math.floor((first - bufferMinutes) / 30) * 30),
    through =
      last === null
        ? null
        : Math.min(1439, Math.ceil((last + bufferMinutes) / 30) * 30);
  return {
    version: "publication-window-v1",
    timezone: "Asia/Shanghai",
    requestedRange: { start, end },
    verifiedOriginals: rows.length,
    coveredDates: [...new Set(rows.map((r) => r.local.slice(0, 10)))].sort(),
    firstMinute: first,
    lastMinute: last,
    hours,
    overnight: rows.filter((r) => minute(r) >= 22 * 60 || minute(r) < 8 * 60),
    suggested: { fromMinute: from, throughMinute: through, bufferMinutes },
    coverageCaveat:
      "仅为已核实可见作品的发布分布。没有观察到不等于全年从未发布；删除、隐藏及未采集作品不计入。",
  };
}
export function insideWindow(iso, fromMinute, throughMinute) {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) throw Error("Invalid timestamp");
  const d = new Date(t.getTime() + 8 * 3600000),
    minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minute >= fromMinute && minute <= throughMinute;
}

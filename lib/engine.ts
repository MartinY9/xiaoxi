import {
  decodeScene,
  type SceneObservation,
  type SemanticCandidate,
} from "./decoder.ts";
export const RULE_VERSION = "symbolic-decoder-v2";
export const LEGACY_RULE_VERSION = "user-hypotheses-v1";
export const LABELS: Record<string, string> = {
  cherry: "樱桃 / 樱桃照片",
  peach: "桃子",
  pear: "梨",
  hat: "草帽 / 帽子",
  turtle: "乌龟 / 金龟",
  red_fruit: "红色果实",
  withered_plant: "枯萎植物",
  red_plant: "红色植物 / 红花",
  green_plant: "绿色植物",
  globe: "地球仪",
  globe_on_top: "地球仪置于物件顶部",
  bull: "牛摆件",
  bear: "熊摆件",
  panda: "熊猫摆件",
  horse: "马摆件",
  foam: "泡沫",
  other: "其他 / 填具体名称",
};
export type Observation = SceneObservation;
export type Forecast = {
  direction: "up" | "down";
  window: "next-trading-day" | "3-trading-days" | "5-trading-days";
  basis: "decoder_hypothesis" | "explicit_text";
  reasoning: string;
};
export type RecordItem = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  createdAt: string;
  sourceType: string;
  timeVerified: boolean;
  market: string;
  observations: Observation[];
  notes: string;
  ruleVersion: string;
  frames?: string[];
  fileHash?: string;
  imported?: boolean;
  signal?: Signal;
  decoding?: ReturnType<typeof decodeScene>;
  coverage?: "partial" | "complete";
  visibleText?: string[];
  semanticCandidates?: SemanticCandidate[];
  forecast?: Forecast;
  riskWindow?: "5-trading-days-2pct";
};
export type Price = {
  date: string;
  open?: number;
  close: number;
  closeConfirmed?: boolean;
};
export function withCloseConfirmation(
  prices: Price[],
  observedAt?: string,
): Price[] {
  const observed = observedAt ? new Date(observedAt).getTime() : NaN;
  return prices.map((p) => ({
    ...p,
    closeConfirmed:
      Number.isFinite(observed) &&
      new Date(p.date + "T15:05:00+08:00").getTime() <= observed,
  }));
}
export type MinutePrice = { timestamp: string; close: number };
export const EVALUATION_VERSION = "close-windows-v2";
export function publicationTiming(publishedAt: string) {
  const d = new Date(publishedAt);
  if (!Number.isFinite(d.getTime())) throw new Error("发布时间无效");
  const local = new Date(d.getTime() + 8 * 3600000),
    minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return {
    date: local.toISOString().slice(0, 10),
    beforeClose: minute < 900,
    session: minute < 900 ? "before-close" : "after-close",
    clock: local.toISOString().slice(11, 19),
  };
}
export function sameDayClose(
  r: RecordItem,
  prices: Price[],
  minutes: MinutePrice[] = [],
  asOf = new Date().toISOString(),
) {
  const timing = publicationTiming(r.publishedAt);
  if (!timing.beforeClose) return null;
  const day = timing.date,
    today = localDate(asOf),
    row = prices.find((p) => p.date === day),
    prev = prices.filter((p) => p.date < day).at(-1),
    weekday = new Date(day + "T12:00:00Z").getUTCDay();
  const empty = {
    date: day,
    index: null as number | null,
    previousClose: prev?.close ?? null,
    dailyReturn: null as number | null,
    publicationQuote: null as MinutePrice | null,
    postPublicationReturn: null as number | null,
    prospective: false,
  };
  if (!row) {
    const covered =
      prices.length > 0 && day >= prices[0].date && day <= prices.at(-1)!.date;
    if (weekday === 0 || weekday === 6 || covered)
      return {
        ...empty,
        status: "non-trading-day",
        reason: "当天不是行情日历中的交易日，不展示当天收盘结果。",
      };
    return {
      ...empty,
      status: "pending",
      reason: "尚未取得当天交易日的已完成收盘。",
    };
  }
  if (
    row.closeConfirmed === false ||
    day > today ||
    (day === today && new Date(asOf) < new Date(day + "T15:05:00+08:00"))
  )
    return {
      ...empty,
      status: "pending",
      reason: "当天行情未完成确认，暂不展示盘中点位为收盘。",
    };
  const d = new Date(new Date(r.publishedAt).getTime() + 8 * 3600000);
  let m = Math.ceil(
    d.getUTCHours() * 60 +
      d.getUTCMinutes() +
      d.getUTCSeconds() / 60 +
      d.getUTCMilliseconds() / 60000,
  );
  if (m < 570) m = 570;
  else if (m > 690 && m < 780) m = 780;
  const stamp = `${day}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+08:00`;
  const quote =
    m <= 900
      ? minutes.find(
          (p) =>
            p.timestamp === stamp && new Date(p.timestamp) <= new Date(asOf),
        )
      : undefined;
  const prospective =
    r.sourceType === "original" &&
    r.timeVerified &&
    !r.imported &&
    new Date(r.createdAt) >= new Date(r.publishedAt) &&
    new Date(r.createdAt) < new Date(day + "T15:00:00+08:00");
  return {
    ...empty,
    status: "ready",
    index: row.close,
    dailyReturn: prev ? row.close / prev.close - 1 : null,
    publicationQuote: quote ?? null,
    postPublicationReturn: quote ? row.close / quote.close - 1 : null,
    prospective,
    reason: quote
      ? "日涨跌对比前一交易日收盘；发布后变化以首个对应分钟报价为基准。"
      : "已有当天收盘；缺少发布后首个对应分钟报价，不用更晚报价、开盘价或前收替代。",
  };
}
export function mergeMinutes(
  old: MinutePrice[],
  next: MinutePrice[],
): MinutePrice[] {
  const map = new Map<string, MinutePrice>();
  for (const p of [...old, ...next]) {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(p.timestamp) ||
      !Number.isFinite(new Date(p.timestamp).getTime()) ||
      !Number.isFinite(p.close) ||
      p.close <= 0
    )
      throw new Error("分钟行情格式无效");
    map.set(p.timestamp, p);
  }
  return [...map.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-12000);
}
export function intraday(
  publishedAt: string,
  minutes: MinutePrice[],
  calendar: Price[],
  asOf = new Date().toISOString(),
) {
  const pub = new Date(publishedAt).getTime(),
    now = new Date(asOf).getTime();
  const rows = minutes
    .filter(
      (p) =>
        new Date(p.timestamp).getTime() >= pub &&
        new Date(p.timestamp).getTime() <= now,
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const days = [...new Set(calendar.map((p) => p.date))].sort();
  const ordinal = (p: MinutePrice) => {
    const d = p.timestamp.slice(0, 10),
      m =
        Number(p.timestamp.slice(11, 13)) * 60 +
        Number(p.timestamp.slice(14, 16));
    if (!((m >= 570 && m <= 690) || (m >= 780 && m <= 900))) return null;
    const day = days.indexOf(d);
    if (day < 0) return null;
    return day * 240 + (m <= 690 ? m - 570 : 120 + m - 780);
  };
  const valid = rows
    .map((p) => ({ p, n: ordinal(p) }))
    .filter((v) => v.n !== null);
  const pd = localDate(publishedAt),
    localPub = new Date(pub + 8 * 3600000);
  let pm = Math.ceil(
    localPub.getUTCHours() * 60 +
      localPub.getUTCMinutes() +
      localPub.getUTCSeconds() / 60 +
      localPub.getUTCMilliseconds() / 60000,
  );
  const expectedDay = days.find((d) => d > pd || (d === pd && pm < 900));
  if (!expectedDay || pd < (days[0] || pd))
    return {
      base: null,
      ret60: null,
      ret180: null,
      reason: "缺少对应交易日的分钟行情",
    };
  if (expectedDay !== pd || pm < 570) pm = 570;
  else if (pm > 690 && pm < 780) pm = 780;
  const expected = `${expectedDay}T${String(Math.floor(pm / 60)).padStart(2, "0")}:${String(pm % 60).padStart(2, "0")}:00+08:00`;
  const base = valid.find((v) => v.p.timestamp === expected);
  if (!base)
    return {
      base: null,
      ret60: null,
      ret180: null,
      reason: "缺少发布后首个对应报价，不能用更晚日期的分钟线替代",
    };
  const ret = (n: number) => {
    const end = valid.find((v) => v.n === base.n! + n);
    if (!end) return null;
    const range = valid.filter((v) => v.n! >= base.n! && v.n! <= end.n!);
    for (let i = 1; i < range.length; i++)
      if (range[i].n! - range[i - 1].n! > 1) return null;
    return end.p.close / base.p.close - 1;
  };
  return {
    base: base.p.timestamp,
    ret60: ret(60),
    ret180: ret(180),
    reason:
      "以发布后首个可用报价为基准，按交易分钟计算；午休不计，缺失分钟窗口不评分。",
  };
}
export function featureEvidence(
  records: RecordItem[],
  prices: Price[],
  cutoff = new Date().toISOString(),
) {
  const ready = records
    .filter((r) => new Date(r.createdAt) <= new Date(cutoff))
    .map((r) => evaluateRecord(r, prices, cutoff))
    .filter(
      (r) =>
        r.status === "ready" &&
        r.ret1 !== null &&
        r.targetDate! < localDate(cutoff),
    );
  return Object.entries(LABELS)
    .map(([label, name]) => {
      const days = new Map<string, number>();
      for (const r of ready)
        if (r.signal.labels.includes(label)) days.set(r.targetDate!, r.ret1!);
      const values = [...days.values()],
        up = values.filter((v) => v > 0).length,
        n = values.length;
      return {
        label,
        name,
        n,
        up,
        upRate: n ? up / n : null,
        ci: wilson(up, n),
        status: n < 30 ? "证据不足" : "候选关系，需留出集验证",
      };
    })
    .filter((r) => r.n > 0);
}
export function semanticEvidence(
  records: RecordItem[],
  prices: Price[],
  cutoff = new Date().toISOString(),
) {
  const groups = new Map<
    string,
    {
      name: string;
      version: string;
      days: Map<string, ReturnType<typeof evaluateRecord>>;
    }
  >();
  for (const r of records) {
    if (new Date(r.createdAt) > new Date(cutoff) || !r.decoding) continue;
    const e = evaluateRecord(r, prices, cutoff);
    if (e.status !== "ready" || e.ret1 === null) continue;
    for (const m of r.decoding.matches) {
      const key = r.decoding.codebookVersion + ":" + m.id;
      const group = groups.get(key) || {
        name: m.cue,
        version: r.decoding.codebookVersion,
        days: new Map(),
      };
      group.days.set(e.targetDate!, e);
      groups.set(key, group);
    }
  }
  return [...groups.entries()].map(([rule, group]) => {
    const rows = [...group.days.values()];
    const window = (field: "ret1" | "ret3" | "ret5") => {
      const values = rows
        .map((r) => r[field])
        .filter((v): v is number => v !== null);
      const n = values.length,
        up = values.filter((v) => v > 0).length;
      return {
        n,
        upRate: n ? up / n : null,
        meanReturn: n ? values.reduce((a, b) => a + b, 0) / n : null,
        ci: wilson(up, n),
      };
    };
    return {
      rule,
      name: group.name,
      version: group.version,
      day1: window("ret1"),
      day3: window("ret3"),
      day5: window("ret5"),
      status:
        rows.length < 30
          ? "证据不足；仅描述已完成样本"
          : "待独立留出集检验；关系不证明作者意图",
    };
  });
}
export type Signal = {
  direction: "up" | "down" | "unknown";
  risk: boolean;
  reason: string;
  labels: string[];
};
function interpretLegacy(observations: Observation[], market: string): Signal {
  const labels = [
    ...new Set(
      observations
        .filter((o) => o.verified && o.confidence >= 0.65)
        .map((o) => o.label),
    ),
  ];
  const red = labels.includes("red_plant"),
    green = labels.includes("green_plant"),
    risk = labels.includes("globe_on_top");
  if (market !== "a-share")
    return {
      direction: "unknown",
      risk: false,
      labels,
      reason: "适用市场未确认为 A 股；保留视觉证据，不形成上证指数预测。",
    };
  if (red && green)
    return {
      direction: "unknown",
      risk,
      labels,
      reason: "同时出现红色与绿色植物，两条用户假设冲突；不强行给出次日方向。",
    };
  if (red && risk)
    return {
      direction: "unknown",
      risk,
      labels,
      reason: "红色植物偏多假设与顶部风险假设同时出现；次日方向无法判断。",
    };
  if (red)
    return {
      direction: "up",
      risk: false,
      labels,
      reason:
        "按用户待验证假设：红色植物 → 下一交易日上涨。该映射尚未由历史统计证实。",
    };
  if (green)
    return {
      direction: "down",
      risk,
      labels,
      reason:
        "按用户待验证假设：绿色植物 → 下一交易日下跌。绿色也可能只是植物常态。",
    };
  return {
    direction: "unknown",
    risk,
    labels,
    reason: risk
      ? "地球仪置顶 → 短期风险假设。只检验未来 5 个交易日是否出现至少 2% 的收盘回撤，不等同于证明顶部。"
      : "现有确认物件没有预先定义的次日涨跌规则，无法判断。",
  };
}
export function interpret(
  observations: Observation[],
  market: string,
  ruleVersion = RULE_VERSION,
  candidates: SemanticCandidate[] = [],
): Signal {
  if (ruleVersion === LEGACY_RULE_VERSION)
    return interpretLegacy(observations, market);
  const d = decodeScene(observations, { market }, candidates),
    labels = [...new Set(d.objects.map((o) => o.label))];
  if (market !== "a-share")
    return {
      direction: "unknown",
      risk: false,
      labels,
      reason: d.summary + "\n市场范围尚未确认为A股，未形成上证指数方向判断。",
    };
  // 语义倾向保留在 decoding.bias；没有时间窗口的暗语不冒充次日预测。
  return {
    direction: "unknown",
    risk: d.risk,
    labels,
    reason: d.summary + "\n" + d.timing,
  };
}
export function localDate(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw new Error("日期格式无效");
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function normalizePrices(input: any[]): Price[] {
  if (!Array.isArray(input) || input.length > 10000)
    throw new Error("行情数据数量无效");
  const seen = new Set<string>();
  return input
    .map((p) => {
      const date = String(p.date);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date
      )
        throw new Error("行情日期无效");
      if (seen.has(date)) throw new Error("行情含重复日期：" + date);
      seen.add(date);
      const close = Number(p.close);
      const open = p.open == null || p.open === "" ? undefined : Number(p.open);
      if (
        !Number.isFinite(close) ||
        close <= 0 ||
        (open !== undefined && (!Number.isFinite(open) || open <= 0))
      )
        throw new Error("行情点位必须为正数");
      return { date, close, open };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function parseCSV(text: string): Price[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  const header = (rows.shift() ?? []).map((v) =>
    v
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase(),
  );
  const d = header.findIndex((h) => ["date", "日期", "交易日期"].includes(h)),
    c = header.findIndex((h) => ["close", "收盘", "收盘价"].includes(h)),
    o = header.findIndex((h) => ["open", "开盘", "开盘价"].includes(h));
  if (d < 0 || c < 0)
    throw new Error(
      "CSV 需要 date,close 列；可选 open 列。请导入连续的交易日数据。",
    );
  return normalizePrices(
    rows.map((r) => ({
      date: r[d]?.trim(),
      close: r[c]?.trim(),
      open: o < 0 ? undefined : r[o]?.trim(),
    })),
  );
}
export function wilson(hit: number, n: number) {
  if (!n) return null;
  const z = 1.95996398454,
    p = hit / n,
    den = 1 + (z * z) / n,
    center = (p + (z * z) / (2 * n)) / den,
    half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
export function evaluateRecord(
  r: RecordItem,
  prices: Price[],
  asOf = new Date().toISOString(),
  minutes: MinutePrice[] = [],
) {
  const sameDay = sameDayClose(r, prices, minutes, asOf),
    timing = publicationTiming(r.publishedAt);
  const legacy = r.ruleVersion === LEGACY_RULE_VERSION;
  const rawSignal =
    r.signal ||
    interpret(r.observations, r.market, r.ruleVersion, r.semanticCandidates);
  const signal = {
    ...rawSignal,
    direction: (legacy
      ? rawSignal.direction
      : r.market === "a-share" && r.forecast?.window === "next-trading-day"
        ? r.forecast.direction
        : "unknown") as Signal["direction"],
  };
  const day = localDate(r.publishedAt),
    today = localDate(asOf);
  const completed = prices.filter(
    (p) =>
      p.closeConfirmed !== false &&
      (p.date < today ||
        (p.date === today &&
          new Date(asOf) >= new Date(today + "T15:05:00+08:00"))),
  );
  const target = completed.findIndex((p) => p.date > day);
  const base = completed.filter((p) => p.date <= day).at(-1);
  if (target < 0 || !base)
    return {
      record: r,
      signal,
      status: "pending",
      reason: "缺少基准收盘或下一交易日已完成行情",
      targetDate: null,
      ret1: null,
      ret3: null,
      ret5: null,
      hit: null,
      riskHit: null,
      prospective: false,
      sameDay,
      timing,
      evaluationVersion: EVALUATION_VERSION,
    };
  const first = completed[target];
  const prospective =
    !r.imported &&
    new Date(r.createdAt) <= new Date(first.date + "T09:30:00+08:00") &&
    new Date(r.createdAt) >= new Date(r.publishedAt);
  const valid =
    r.sourceType === "original" &&
    r.timeVerified &&
    [RULE_VERSION, LEGACY_RULE_VERSION].includes(r.ruleVersion);
  const ret = (h: number) =>
    completed[target + h - 1]
      ? completed[target + h - 1].close / base.close - 1
      : null;
  const ret1 = ret(1)!;
  const hit =
    valid && signal.direction !== "unknown"
      ? signal.direction === "up"
        ? ret1 > 0
        : ret1 < 0
      : null;
  const future = completed.slice(target, target + 5);
  const riskHit =
    valid &&
    signal.risk &&
    (legacy || r.riskWindow === "5-trading-days-2pct") &&
    future.length === 5
      ? Math.min(...future.map((p) => p.close / base.close - 1)) <= -0.02
      : null;
  const forecastReturn = r.forecast
    ? ret(
        r.forecast.window === "next-trading-day"
          ? 1
          : r.forecast.window === "3-trading-days"
            ? 3
            : 5,
      )
    : null;
  const forecastHit =
    valid && r.market === "a-share" && r.forecast && forecastReturn !== null
      ? r.forecast.direction === "up"
        ? forecastReturn > 0
        : forecastReturn < 0
      : null;
  return {
    record: r,
    signal,
    status: valid ? "ready" : "excluded",
    reason: valid
      ? prospective
        ? "在目标交易日开盘前锁定；属于事前记录"
        : "解读锁定晚于目标开盘或为导入数据；仅作历史复盘"
      : "原视频 / 发布时间 / 规则版本未核实，不计入命中率",
    targetDate: first.date,
    ret1,
    ret3: ret(3),
    ret5: ret(5),
    hit,
    riskHit,
    prospective,
    forecastReturn,
    forecastHit,
    sameDay,
    timing,
    evaluationVersion: EVALUATION_VERSION,
  };
}
export function backtest(
  records: RecordItem[],
  prices: Price[],
  asOf = new Date().toISOString(),
  minutes: MinutePrice[] = [],
) {
  const results = records.map((r) => evaluateRecord(r, prices, asOf, minutes));
  const summarize = (prospective: boolean) => {
    const eligible = results.filter(
      (r) => r.status === "ready" && r.prospective === prospective,
    );
    const groups = new Map<string, typeof eligible>();
    for (const r of eligible) {
      const key = r.targetDate!;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    let hits = 0,
      n = 0,
      up = 0,
      down = 0,
      abstained = 0,
      conflicts = 0,
      riskN = 0,
      riskHits = 0;
    for (const rows of groups.values()) {
      const unique = rows.filter(
        (r, i) =>
          rows.findIndex(
            (x) =>
              (x.record.fileHash && x.record.fileHash === r.record.fileHash) ||
              x.record.url === r.record.url,
          ) === i,
      );
      const dirs = [
        ...new Set(
          unique.map((r) => r.signal.direction).filter((d) => d !== "unknown"),
        ),
      ];
      const risk = unique.find((r) => r.riskHit !== null);
      if (risk) {
        riskN++;
        if (risk.riskHit) riskHits++;
      }
      if (dirs.length === 0) {
        abstained++;
        continue;
      }
      if (dirs.length > 1) {
        conflicts++;
        abstained++;
        continue;
      }
      const scored = unique.find((r) => r.signal.direction === dirs[0])!;
      n++;
      if (scored.hit) hits++;
      if (scored.ret1! > 0) up++;
      if (scored.ret1! < 0) down++;
    }
    const ci = wilson(hits, n);
    return {
      n,
      hits,
      hitRate: n ? hits / n : null,
      ci,
      alwaysUp: n ? up / n : null,
      alwaysDown: n ? down / n : null,
      coverage: groups.size ? n / groups.size : null,
      abstained,
      conflicts,
      riskN,
      riskHits,
      days: groups.size,
      conclusion:
        n === 0
          ? "暂无可评分样本"
          : !prospective
            ? "仅为事后复盘，不能证明预测能力"
            : n < 30
              ? "有效交易日不足 30，证据不足"
              : "已有事前记录；仍需连续取样、独立留出集及时间相关性检验。Wilson 区间仅为描述统计。",
    };
  };
  return {
    results,
    prospective: summarize(true),
    retrospective: summarize(false),
  };
}

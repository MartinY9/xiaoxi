import { semanticEvidence } from "./engine.ts";
export function buildMonthStudy(selection, items, prices, asOf) {
  if (!selection) return null;
  const rows = items
    .filter((i) => selection.items.some((s) => s.id === i.record.id))
    .map((i) => ({
      ...i,
      ...selection.items.find((s) => s.id === i.record.id),
    }));
  const eligible = rows.filter(
    (i) =>
      i.record.market === "a-share" &&
      i.record.sourceType === "original" &&
      i.sourceVerified &&
      !i.coauth &&
      i.everyday,
  );
  const dates = [];
  for (
    let d = new Date(selection.windowStart + "T00:00:00Z");
    d.toISOString().slice(0, 10) <= selection.windowEnd;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const day = d.toISOString().slice(0, 10),
      found = rows.filter((i) => i.evaluation.timing.date === day);
    dates.push({
      date: day,
      count: found.length,
      tradingDay: prices.some((p) => p.date === day),
      newCount: found.filter((i) => i.record.imported).length,
    });
  }
  const values = new Map();
  for (const i of rows)
    if (i.evaluation.ret1 !== null)
      values.set(i.evaluation.targetDate, i.evaluation.ret1);
  const benchmark = [...values.values()];
  return {
    ...selection,
    rows,
    coverage: dates,
    workCount: rows.length,
    newCount: rows.filter((i) => i.record.imported).length,
    independentNextDays: values.size,
    eligibleWorks: eligible.length,
    eligibleNextDays: new Set(
      eligible
        .filter((i) => i.evaluation.ret1 !== null)
        .map((i) => i.evaluation.targetDate),
    ).size,
    relations: semanticEvidence(
      eligible.map((i) => i.record),
      prices,
      asOf,
    ),
    benchmark: {
      n: benchmark.length,
      upRate: benchmark.length
        ? benchmark.filter((v) => v > 0).length / benchmark.length
        : null,
      meanReturn: benchmark.length
        ? benchmark.reduce((a, b) => a + b, 0) / benchmark.length
        : null,
    },
    interpretation:
      "规则关联只统计来源核实的本人日常场景、A股话题，并按目标交易日去重。访谈、共创、海外与生活场景不混入。历史期间结果已公开，关联是事后描述；样本不足以校准可靠准确率。",
  };
}

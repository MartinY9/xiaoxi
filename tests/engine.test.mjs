import test from "node:test";
import assert from "node:assert/strict";
import {
  interpret,
  parseCSV,
  backtest,
  evaluateRecord,
  RULE_VERSION,
  LEGACY_RULE_VERSION,
  wilson,
  intraday,
  mergeMinutes,
} from "../lib/engine.ts";
const obs = (label) => ({
  label,
  description: label,
  confidence: 0.9,
  frameIndex: 0,
  verified: true,
});
const make = (extra = {}) => ({
  id: "a",
  title: "测试",
  url: "https://www.douyin.com/video/1",
  publishedAt: "2024-11-22T16:00:00+08:00",
  createdAt: "2024-11-22T16:01:00+08:00",
  sourceType: "original",
  timeVerified: true,
  market: "a-share",
  observations: [obs("green_plant")],
  notes: "",
  ruleVersion: LEGACY_RULE_VERSION,
  ...extra,
});
const prices = [
  { date: "2024-11-22", close: 100 },
  { date: "2024-11-25", close: 98 },
  { date: "2024-11-26", close: 99 },
  { date: "2024-11-27", close: 101 },
  { date: "2024-11-28", close: 97 },
  { date: "2024-11-29", close: 96 },
];
test("红绿冲突、未知市场、低辨认度与未确认均不硬判", () => {
  assert.equal(
    interpret([obs("red_plant"), obs("green_plant")], "a-share").direction,
    "unknown",
  );
  assert.equal(interpret([obs("red_plant")], "hk").direction, "unknown");
  assert.equal(
    interpret([{ ...obs("red_plant"), verified: false }], "a-share").direction,
    "unknown",
  );
  assert.equal(
    interpret([{ ...obs("red_plant"), confidence: 0.3 }], "a-share").direction,
    "unknown",
  );
});
test("周五预测准确对齐下周一；1/3/5个交易日独立计算", () => {
  const e = evaluateRecord(make(), prices, "2024-12-02T08:00:00+08:00");
  assert.equal(e.targetDate, "2024-11-25");
  assert.equal(e.hit, true);
  assert.ok(Math.abs(e.ret3 - 0.01) < 1e-9);
  assert.ok(Math.abs(e.ret5 + 0.04) < 1e-9);
  assert.equal(e.prospective, true);
});
test("不能将未收盘日线计为命中", () => {
  const e = evaluateRecord(make(), prices, "2024-11-25T14:00:00+08:00");
  assert.equal(e.status, "pending");
});
test("收盘后数据可评估，事后解读不会计为事前记录", () => {
  assert.equal(
    evaluateRecord(make(), prices, "2024-11-25T15:06:00+08:00").hit,
    true,
  );
  assert.equal(
    evaluateRecord(
      make({ createdAt: "2024-11-25T10:00:00+08:00" }),
      prices,
      "2024-12-01T00:00:00Z",
    ).prospective,
    false,
  );
});
test("转载、时间未核实、导入和旧版规则不能冒充事前", () => {
  assert.equal(
    evaluateRecord(
      make({ sourceType: "repost" }),
      prices,
      "2024-12-01T00:00:00Z",
    ).hit,
    null,
  );
  assert.equal(
    evaluateRecord(
      make({ timeVerified: false }),
      prices,
      "2024-12-01T00:00:00Z",
    ).hit,
    null,
  );
  assert.equal(
    evaluateRecord(make({ imported: true }), prices, "2024-12-01T00:00:00Z")
      .prospective,
    false,
  );
  assert.equal(
    evaluateRecord(make({ ruleVersion: "v2" }), prices, "2024-12-01T00:00:00Z")
      .hit,
    null,
  );
});
test("同一交易日不重复计算，相反方向整日弃权", () => {
  const asOf = "2024-12-01T00:00:00Z";
  assert.equal(
    backtest(
      [make(), make({ id: "b", url: "https://www.douyin.com/video/2" })],
      prices,
      asOf,
    ).prospective.n,
    1,
  );
  const s = backtest(
    [
      make(),
      make({
        id: "b",
        url: "https://www.douyin.com/video/2",
        observations: [obs("red_plant")],
      }),
    ],
    prices,
    asOf,
  ).prospective;
  assert.equal(s.n, 0);
  assert.equal(s.conflicts, 1);
});
test("置顶地球风险用预设5日回撤标准评估", () => {
  const e = evaluateRecord(
    make({ observations: [obs("globe_on_top")] }),
    prices,
    "2024-12-01T00:00:00Z",
  );
  assert.equal(e.hit, null);
  assert.equal(e.riskHit, true);
});
test("CSV允许BOM、中文表头和引号；拒绝重复、无效日期及点位", () => {
  assert.equal(
    parseCSV('\uFEFF日期,收盘,开盘\n"2024-11-22",100,99\n')[0].close,
    100,
  );
  assert.throws(() => parseCSV("date,close\n2024-01-01,1\n2024-01-01,2"));
  assert.throws(() => parseCSV("date,close\n2024-01-01,NaN"));
  assert.throws(() => parseCSV("date,close\n2024-02-30,1"));
});
test("Wilson区间不会把一例命中变成确定性", () => {
  assert.ok(wilson(1, 1)[0] < 0.3);
  assert.equal(wilson(0, 0), null);
});
test("盘中60交易分钟跨午休，不把自然小时当交易小时", () => {
  const rows = [];
  for (let m = 660; m <= 690; m++)
    rows.push({
      timestamp: `2024-11-22T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+08:00`,
      close: 100,
    });
  for (let m = 780; m <= 810; m++)
    rows.push({
      timestamp: `2024-11-22T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+08:00`,
      close: m === 810 ? 101 : 100,
    });
  const r = intraday(
    "2024-11-22T11:00:00+08:00",
    rows,
    prices,
    "2024-11-22T14:00:00+08:00",
  );
  assert.ok(Math.abs(r.ret60 - 0.01) < 1e-9);
  assert.equal(r.ret180, null);
  assert.equal(
    intraday(
      "2024-11-22T11:00:00+08:00",
      rows.filter((r) => !r.timestamp.includes("13:15")),
      prices,
      "2024-11-22T14:00:00+08:00",
    ).ret60,
    null,
  );
});
test("分钟线去重并拒绝非法点位", () => {
  assert.equal(
    mergeMinutes(
      [{ timestamp: "2024-11-22T11:00:00+08:00", close: 100 }],
      [{ timestamp: "2024-11-22T11:00:00+08:00", close: 101 }],
    ).length,
    1,
  );
  assert.throws(() =>
    mergeMinutes([], [{ timestamp: "2024-11-22T11:00:00+08:00", close: NaN }]),
  );
});
test("历史分钟线缺失，不能误用几天或几个月之后的第一条报价", () => {
  const calendar = [
      { date: "2026-03-16", close: 100 },
      { date: "2026-10-12", close: 100 },
      { date: "2026-10-13", close: 100 },
    ],
    rows = [{ timestamp: "2026-10-13T09:30:00+08:00", close: 100 }];
  assert.equal(
    intraday(
      "2026-03-16T12:55:00+08:00",
      rows,
      calendar,
      "2026-10-13T16:00:00+08:00",
    ).base,
    null,
  );
  assert.equal(
    intraday(
      "2026-10-10T22:51:00+08:00",
      rows,
      calendar,
      "2026-10-13T16:00:00+08:00",
    ).base,
    null,
  );
});
test("新解码不把无时间的暗语算作次日命中；旧记录继续按原规则", () => {
  const now = "2024-12-02T08:00:00+08:00";
  assert.equal(
    evaluateRecord(make({ ruleVersion: RULE_VERSION }), prices, now).hit,
    null,
  );
  assert.equal(
    backtest([make({ ruleVersion: RULE_VERSION })], prices, now).prospective.n,
    0,
  );
  assert.equal(evaluateRecord(make(), prices, now).hit, true);
  const future = evaluateRecord(
    make({
      ruleVersion: RULE_VERSION,
      forecast: {
        direction: "down",
        window: "next-trading-day",
        basis: "decoder_hypothesis",
        reasoning: "单独锁定验证假设",
      },
    }),
    prices,
    now,
  );
  assert.equal(future.hit, true);
});
test("三日和五日假设分别验证，不混入次日命中", () => {
  const e = evaluateRecord(
    make({
      ruleVersion: RULE_VERSION,
      forecast: {
        direction: "up",
        window: "3-trading-days",
        basis: "decoder_hypothesis",
        reasoning: "阶段窗口",
      },
    }),
    prices,
    "2024-12-02T08:00:00+08:00",
  );
  assert.equal(e.hit, null);
  assert.equal(e.forecastHit, true);
  assert.ok(Math.abs(e.forecastReturn - 0.01) < 1e-9);
});

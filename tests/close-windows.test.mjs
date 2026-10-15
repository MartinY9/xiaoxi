import test from "node:test";
import assert from "node:assert/strict";
import {
  publicationTiming,
  sameDayClose,
  evaluateRecord,
  RULE_VERSION,
} from "../lib/engine.ts";
const prices = [
  { date: "2026-10-09", close: 100 },
  { date: "2026-10-12", close: 102 },
  { date: "2026-10-13", close: 103 },
  { date: "2026-10-14", close: 101 },
];
const r = {
  id: "x",
  title: "测试",
  url: "https://www.douyin.com/video/1",
  publishedAt: "2026-10-13T12:27:00+08:00",
  createdAt: "2026-10-13T12:29:00+08:00",
  sourceType: "original",
  timeVerified: true,
  market: "a-share",
  observations: [],
  notes: "",
  ruleVersion: RULE_VERSION,
};
const minutes = [{ timestamp: "2026-10-13T13:00:00+08:00", close: 101 }];
test("北京时间15点分界：14:59:59为收盘前，15:00及之后为收盘后", () => {
  assert.equal(publicationTiming("2026-10-13T06:59:59Z").beforeClose, true);
  assert.equal(publicationTiming("2026-10-13T07:00:00Z").beforeClose, false);
  assert.equal(
    sameDayClose(
      { ...r, publishedAt: "2026-10-13T15:00:00+08:00" },
      prices,
      minutes,
      "2026-10-13T16:00:00+08:00",
    ),
    null,
  );
});
test("收盘前发布增加当天收盘点位、日涨跌及发布后变化，午休从13点报价开始", () => {
  const d = sameDayClose(r, prices, minutes, "2026-10-13T16:00:00+08:00");
  assert.equal(d.index, 103);
  assert.ok(Math.abs(d.dailyReturn - (103 / 102 - 1)) < 1e-10);
  assert.ok(Math.abs(d.postPublicationReturn - (103 / 101 - 1)) < 1e-10);
  assert.equal(d.publicationQuote.timestamp, minutes[0].timestamp);
  assert.equal(d.prospective, true);
});
test("尚未收盘不展示盘中伪收盘，即使行情提供了当日记录", () => {
  assert.equal(
    sameDayClose(r, prices, minutes, "2026-10-13T14:00:00+08:00").status,
    "pending",
  );
  assert.equal(
    sameDayClose(r, prices, minutes, "2026-10-13T15:02:00+08:00").index,
    null,
  );
});
test("周末收盘前发布没有当天收盘窗口，未来窗口按真实交易日对齐", () => {
  const x = {
      ...r,
      publishedAt: "2026-10-10T10:00:00+08:00",
      createdAt: "2026-10-10T10:01:00+08:00",
    },
    e = evaluateRecord(x, prices, "2026-10-14T16:00:00+08:00");
  assert.equal(e.sameDay.status, "non-trading-day");
  assert.equal(e.targetDate, "2026-10-12");
});
test("缺发布时分钟报价时只展示当天结果，不用晚报价或前收冒充发布后变化", () => {
  const d = sameDayClose(
    r,
    prices,
    [{ timestamp: "2026-10-13T13:05:00+08:00", close: 101 }],
    "2026-10-13T16:00:00+08:00",
  );
  assert.equal(d.index, 103);
  assert.equal(d.postPublicationReturn, null);
  assert.equal(d.publicationQuote, null);
});
test("下一交易日未完成仍可显示当天收盘；收盘后补录不得算当天事前", () => {
  const e = evaluateRecord(
    { ...r, createdAt: "2026-10-13T15:15:00+08:00" },
    prices.filter((p) => p.date <= "2026-10-13"),
    "2026-10-13T16:00:00+08:00",
    minutes,
  );
  assert.equal(e.status, "pending");
  assert.equal(e.sameDay.index, 103);
  assert.equal(e.sameDay.prospective, false);
  assert.equal(e.ret1, null);
});

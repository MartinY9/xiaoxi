import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSnapshot } from "../lib/supervised-model.mjs";
import {
  withCloseConfirmation,
  evaluateRecord,
  RULE_VERSION,
} from "../lib/engine.ts";
import { makeBackgroundSamples } from "../lib/background-inference.mjs";
const snapshot = {
  recordId: "new-video",
  publishedAt: "2026-10-14T13:24:00+08:00",
  predictionAt: "2026-10-14T13:47:00+08:00",
  prospectiveCandidate: true,
  direction: "down",
};
test("过15:05也不能把盘中缓存当收盘；重新取得收盘后日线才用于验证", () => {
  const rows = [
    { date: "2026-10-13", close: 3800 },
    { date: "2026-10-14", close: 3770 },
  ];
  const cached = withCloseConfirmation(rows, "2026-10-14T14:03:00+08:00");
  const r = {
    id: "prior",
    title: "prior",
    url: "https://www.douyin.com/video/1",
    publishedAt: "2026-10-13T13:00:00+08:00",
    createdAt: "2026-10-13T13:10:00+08:00",
    sourceType: "original",
    timeVerified: true,
    market: "a-share",
    observations: [],
    notes: "",
    ruleVersion: RULE_VERSION,
  };
  assert.equal(
    evaluateRecord(r, cached, "2026-10-14T15:10:00+08:00").ret1,
    null,
  );
  const prior = {
    ...snapshot,
    publishedAt: r.publishedAt,
    predictionAt: r.createdAt,
  };
  assert.equal(
    evaluateSnapshot(prior, cached, "2026-10-14T15:10:00+08:00").ret1,
    null,
  );
  const item = {
      record: r,
      observations: [
        {
          id: "green",
          name: "绿叶盆栽",
          label: "green_plant",
          kind: "plant",
          colors: ["green"],
          confidence: 0.99,
          verified: true,
          frameIndex: 0,
        },
      ],
      attachments: [],
      shots: [],
    },
    metadata = [
      { id: r.id, sourceVerified: true, everyday: true, coauth: false },
    ];
  assert.equal(
    makeBackgroundSamples([item], metadata, cached, "2026-10-14T15:10:00+08:00")
      .samples.length,
    0,
  );
  const refreshed = withCloseConfirmation(rows, "2026-10-14T15:05:01+08:00");
  assert.equal(
    evaluateRecord(r, refreshed, "2026-10-14T15:10:00+08:00").ret1,
    3770 / 3800 - 1,
  );
  assert.equal(
    evaluateSnapshot(prior, refreshed, "2026-10-14T15:10:00+08:00").status,
    "ready",
  );
  assert.equal(
    makeBackgroundSamples(
      [item],
      metadata,
      refreshed,
      "2026-10-14T15:10:00+08:00",
    ).samples.length,
    1,
  );
  assert.equal(
    rows[1].closeConfirmed,
    undefined,
    "派生确认标志不能改写原始报价",
  );
});
test("未来目标日未出现在真实日历时，不能把提前锁定误称开盘后预测", () => {
  const r = evaluateSnapshot(
    snapshot,
    [{ date: "2026-10-14", close: 3800 }],
    "2026-10-14T14:00:00+08:00",
  );
  assert.equal(r.status, "pending");
  assert.equal(r.targetDate, null);
  assert.equal(r.ret1, null);
  assert.equal(r.hit, null);
  assert.match(r.kind, /前瞻资格待核实/);
  assert.doesNotMatch(r.kind, /晚于/);
});
test("目标日确认后按真实开盘核实资格，收盘未完成不评分，已完成再验证", () => {
  const prices = [
    { date: "2026-10-14", close: 3800 },
    { date: "2026-10-15", close: 3750 },
  ];
  const pending = evaluateSnapshot(
    snapshot,
    prices,
    "2026-10-15T14:59:00+08:00",
  );
  assert.equal(pending.prospective, true);
  assert.equal(pending.hit, null);
  assert.equal(pending.ret1, null);
  const ready = evaluateSnapshot(snapshot, prices, "2026-10-15T15:05:00+08:00");
  assert.equal(ready.prospective, true);
  assert.equal(ready.hit, true);
  const late = evaluateSnapshot(
    { ...snapshot, predictionAt: "2026-10-15T10:00:00+08:00" },
    prices,
    "2026-10-15T15:05:00+08:00",
  );
  assert.equal(late.prospective, false);
  assert.match(late.kind, /晚于目标开盘/);
});

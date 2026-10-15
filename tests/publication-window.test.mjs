import test from "node:test";
import assert from "node:assert/strict";
import { publicationWindow, insideWindow } from "../lib/publication-window.mjs";
test("发布分布只用核实本人原发、北京时间和指定年份", () => {
  const r = (id, at, extra = {}) => ({
    id,
    publishedAt: at,
    timeVerified: true,
    sourceType: "original",
    ...extra,
  });
  const w = publicationWindow([
    r("early", "2026-09-21T07:44:00+08:00"),
    r("late", "2026-09-16T14:59:00Z"),
    r("other", "2026-09-16T05:00:00+08:00", { sourceType: "unknown" }),
    r("old", "2025-12-31T23:00:00+08:00"),
  ]);
  assert.equal(w.overnight.length, 2);
  assert.equal(w.firstMinute, 464);
  assert.equal(w.lastMinute, 1379);
  assert.equal(w.hours[22].count, 1);
  assert.equal(w.suggested.fromMinute, 390);
});
test("夜间不轮询，边界与UTC输入明确", () => {
  assert.equal(insideWindow("2026-10-14T23:30:00+08:00", 420, 1410), true);
  assert.equal(insideWindow("2026-10-15T06:59:00+08:00", 420, 1410), false);
  assert.equal(insideWindow("2026-10-14T23:00:00Z", 420, 1410), true);
  assert.throws(() => insideWindow("bad", 420, 1410));
});

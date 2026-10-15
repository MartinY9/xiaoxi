import test from "node:test";
import assert from "node:assert/strict";
import { buildAnnualStudy } from "../lib/annual-study.mjs";
test("年度覆盖区分未采集、不适用及当前概率，不把空月份写成无发布", () => {
  const selection = {
      start: "2026-01-01",
      end: "2026-03-31",
      selected: [{ id: "1" }, { id: "2" }, { id: "3" }],
    },
    items = [
      {
        record: { id: "douyin-1", publishedAt: "2026-01-02T18:00:00+08:00" },
        currentModelView: { pDown: 0.4 },
      },
      {
        record: { id: "douyin-2", publishedAt: "2026-03-02T18:00:00+08:00" },
        currentModelView: { pDown: null },
      },
    ],
    meta = [
      { id: "douyin-1", everyday: true, sourceVerified: true, coauth: false },
      { id: "douyin-2", everyday: false, sourceVerified: true, coauth: false },
    ];
  const s = buildAnnualStudy(selection, items, meta, null);
  assert.equal(s.archived, 2);
  assert.equal(s.pending, 1);
  assert.equal(s.excluded, 1);
  assert.equal(s.months[1].selectedArchived, 0);
  assert.match(s.caveat, /不是|不代表/);
  assert.equal(s.trainingDays, 0);
  assert.equal(s.selected[1].hasProbability, false);
});

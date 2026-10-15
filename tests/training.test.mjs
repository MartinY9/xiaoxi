import test from "node:test";
import assert from "node:assert/strict";
import {
  fitLogistic,
  predict,
  availableTraining,
  metrics,
} from "../lib/supervised-model.mjs";
const defs = [
  { id: "varying", name: "有对照属性" },
  { id: "constant", name: "恒定属性" },
  { id: "missing", name: "未知坐标" },
];
const rows = Array.from({ length: 8 }, (_, j) => ({
  recordId: "synthetic-" + j,
  targetDate: "2026-01-" + String(j + 5).padStart(2, "0"),
  publishedAt: "2026-01-" + String(j + 4).padStart(2, "0") + "T18:00:00+08:00",
  labelAvailableAt:
    "2026-01-" + String(j + 5).padStart(2, "0") + "T15:05:00+08:00",
  y: j % 2,
  x: [j % 2, 1, null],
}));
test("有对照才拟合属性，恒定/未知不凭空生成权重", () => {
  const m = fitLogistic(rows, defs, "unit-synthetic");
  assert.equal(m.n, 8);
  assert.equal(m.weights[1], 0);
  assert.equal(m.weights[2], 0);
  assert.ok(predict(m, [1, 1, null]) > predict(m, [0, 1, null]));
  assert.ok(predict(m, [1, 1, null]) < 1);
});
test("盘中判断不使用当天未完成标签，目标日排除独立执行", () => {
  const train = availableTraining(
    rows,
    "2026-01-10T12:00:00+08:00",
    "2026-01-08",
  );
  assert.ok(
    train.every(
      (r) =>
        new Date(r.labelAvailableAt) <= new Date("2026-01-10T12:00:00+08:00"),
    ),
  );
  assert.ok(train.every((r) => r.targetDate !== "2026-01-08"));
  assert.equal(train.length, 4);
});
test("单类训练仅返回截距，不谎称已学习图像特征", () => {
  const m = fitLogistic(
    rows.map((r) => ({ ...r, y: 1 })),
    defs,
    "unit-single",
  );
  assert.equal(m.kind, "single-class-intercept-only");
  assert.ok(m.weights.every((v) => v === 0));
  assert.ok(predict(m, [0, 1, null]) > 0.5);
});

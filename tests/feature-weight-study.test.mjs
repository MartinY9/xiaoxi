import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { addWeightStudyArtifacts } from "../lib/feature-weight-artifacts.mjs";
import { retainStrongFirsts } from "../lib/strong-experiment.mjs";
import {
  fitWeighted,
  weightedProbability,
  runWeightStudy,
  weightItemView,
  WEIGHT_PROTOCOL,
} from "../lib/feature-weight-study.mjs";
import {
  weightEvidenceCard,
  weightStudyPanel,
  probabilityComparison,
} from "../lib/feature-weight-report.mjs";
const defs = [
  { id: "plant", name: "植物" },
  { id: "twin", name: "同现属性" },
  { id: "rare", name: "稀少属性" },
  { id: "position", name: "位置" },
];
function samples(n = 64) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 2 + i)).toISOString().slice(0, 10),
      pub = new Date(Date.UTC(2026, 0, 1 + i, 8)).toISOString(),
      x = Number(i % 4 < 2);
    return {
      recordId: "r" + i,
      url: "https://example.com/" + i,
      publishedAt: pub,
      targetDate: d,
      labelAvailableAt: d + "T15:05:00+08:00",
      x: [x, x, Number(i === 3), i % 5 === 0 ? null : (i % 10) / 10],
      y: i % 9 === 0 ? 1 - x : x,
      ret1: x ? -0.01 : 0.01,
    };
  });
}
test("增强候选由重复特征学习而非强制方向；稀少属性不加权，同现属性共享系数", () => {
  const rows = samples(),
    m = fitWeighted(rows, defs, WEIGHT_PROTOCOL.candidates[2]);
  assert.equal(m.groups.find((g) => g.indices.includes(0)).indices.length, 2);
  assert.equal(m.weights[0], m.weights[1]);
  assert.equal(m.weights[2], 0);
  assert.equal(m.columns[2].supported, false);
  assert.ok(
    weightedProbability(m, [1, 1, 0, 0.5]) >
      weightedProbability(m, [0, 0, 0, 0.5]) + 0.2,
  );
  assert.throws(() => weightedProbability(m, [NaN, 0, 0, 0]));
});
test("标准化均值只使用训练内已知值，缺失值用其填充", () => {
  const rows = samples(40),
    m = fitWeighted(rows, defs, WEIGHT_PROTOCOL.candidates[1]);
  const values = rows.map((s) => s.x[3]).filter((x) => x !== null);
  assert.ok(
    Math.abs(
      m.columns[3].mean - values.reduce((a, b) => a + b, 0) / values.length,
    ) < 1e-12,
  );
  assert.equal(
    weightedProbability(m, [1, 1, 0, null]),
    weightedProbability(m, [1, 1, 0, m.columns[3].mean]),
  );
  const before = JSON.stringify(m);
  weightedProbability(m, [0, 0, 0, 0.99]);
  assert.equal(JSON.stringify(m), before);
});
test("后段标签不能改变开发选出的配置，逐折最新标签严格早于发布时间", () => {
  const rows = samples(),
    bg = { samples: rows, featureDefinitions: defs },
    a = runWeightStudy(bg),
    changed = structuredClone(rows);
  for (let i = a.split.developmentDays; i < changed.length; i++)
    changed[i].y = 1 - changed[i].y;
  const b = runWeightStudy({ ...bg, samples: changed });
  assert.deepEqual(a.selected, b.selected);
  assert.deepEqual(a.candidates, b.candidates);
  for (const f of a.finalRows)
    assert.ok(new Date(f.lastTrainingLabelAt) <= new Date(f.predictionAt));
  assert.notEqual(
    a.finalEvaluation.selected.brier,
    b.finalEvaluation.selected.brier,
  );
  assert.equal(
    a.protocol.promotion,
    "research only; no automatic replacement or retrospective first estimates",
  );
});
test("相似案例不选自己或同目标日，当前试算不创建首次预测，文案明确非概率胜率", () => {
  const rows = samples(),
    bg = { samples: rows, featureDefinitions: defs },
    s = runWeightStudy(bg);
  const i = {
    record: { id: "r63" },
    currentModelView: { eligible: true, pDown: 0.5 },
    backgroundFeatures: { values: rows[63].x },
  };
  const before = JSON.stringify(i),
    v = weightItemView(i, s, bg);
  assert.ok(
    !v.neighbors.some(
      (n) => n.recordId === "r63" || n.targetDate === rows[63].targetDate,
    ),
  );
  assert.equal(
    new Set(v.neighbors.map((n) => n.targetDate)).size,
    v.neighbors.length,
  );
  assert.equal(v.neighborN, 8);
  assert.equal(JSON.stringify(i), before);
  v.trials = [];
  assert.match(weightEvidenceCard({ ...i, weightEvidence: v }), /不是预测概率/);
  assert.match(
    weightStudyPanel({
      modelStudy: { weightStudy: { ...s, currentEffects: s.effects } },
    }),
    /后段不用于挑配置/,
  );
});
test("开发/后段不足时不输出假模型或选择强权重", () => {
  const s = runWeightStudy({ samples: samples(15), featureDefinitions: defs });
  assert.equal(s.status, "insufficient");
  assert.equal(s.model, undefined);
});
test("对外显示字段始终取强增权而非旧模型，历史导入不补首次", async () => {
  const base = path.resolve("work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "display-api-"));
  try {
    await fs.mkdir(path.join(root, "outputs"));
    const rows = samples(),
      item = {
        record: {
          id: "r0",
          sourceType: "original",
          imported: true,
          createdAt: "2026-01-01T00:00:00Z",
        },
        currentModelView: { eligible: true, pDown: 0.49, inTraining: true },
        backgroundFeatures: { values: rows[0].x },
      };
    await addWeightStudyArtifacts(
      root,
      [item],
      { samples: rows, featureDefinitions: defs },
      "2026-05-01T00:00:00Z",
    );
    const trial = item.weightEvidence.trials.find(
      (t) => t.config.id === "scaled-001",
    );
    assert.equal(item.displayPrediction.pDown, trial.pDown);
    assert.equal(item.displayPrediction.pUp, 1 - trial.pDown);
    assert.equal(item.displayPrediction.configuration, "scaled-001");
    assert.equal(item.displayPrediction.calibrated, false);
    assert.equal(item.displayPrediction.firstEstimate, null);
    assert.equal(item.currentModelView.pDown, 0.49);
  } finally {
    assert.ok(path.resolve(root).startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("切换显示后仅为新观察留强增权首次，旧视频不补造，重训不覆盖", async () => {
  const base = path.resolve("work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "strong-test-"));
  try {
    const model = { weights: [0.1] },
      background = { samples: [{}] },
      activation = "2026-10-15T04:00:00Z";
    await retainStrongFirsts(root, [], model, background, activation);
    const make = (id, createdAt) => ({
      record: {
        id,
        createdAt,
        publishedAt: "2026-10-15T10:54:00+08:00",
        sourceType: "original",
        imported: false,
      },
      backgroundFeatures: { values: [1] },
      weightEvidence: {
        trials: [{ config: { id: "scaled-001" }, pDown: 0.7 }],
      },
    });
    const old = make("old", "2026-10-15T03:59:00Z"),
      fresh = make("new", "2026-10-15T04:02:00Z");
    const s = await retainStrongFirsts(
      root,
      [old, fresh],
      model,
      background,
      "2026-10-15T04:03:00Z",
    );
    assert.equal(s.count, 1);
    assert.equal(old.firstStrongEstimate, undefined);
    assert.equal(fresh.firstStrongEstimate.pDown, 0.7);
    const file = path.join(root, "work/strong-predictions.json"),
      bytes = await fs.readFile(file, "utf8");
    fresh.weightEvidence.trials[0].pDown = 0.2;
    await retainStrongFirsts(
      root,
      [fresh],
      { weights: [0.9] },
      background,
      "2026-10-15T04:30:00Z",
    );
    assert.equal(fresh.firstStrongEstimate.pDown, 0.7);
    assert.equal(await fs.readFile(file, "utf8"), bytes);
  } finally {
    assert.ok(path.resolve(root).startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("主卡只呈现固定强增权试算，方向与首次记录不混用", () => {
  const item = {
    currentModelView: { pDown: 0.49, inTraining: true },
    firstBackgroundEstimate: { pDown: 0.49 },
    weightEvidence: {
      trials: [{ config: { id: "scaled-001" }, pDown: 0.47 }],
      validationComparison: [
        { id: "original", brier: 0.26 },
        { id: "scaled-001", brier: 0.3 },
      ],
    },
  };
  const original = JSON.stringify(item),
    html = probabilityComparison(item);
  assert.ok(!html.includes("原模型 v4"));
  assert.match(html, /强增权实验/);
  assert.match(html, /53.0%/);
  assert.match(html, /47.0%/);
  assert.match(html, /即使增权也接近均衡/);
  assert.match(html, /开发段Brier/);
  assert.equal(JSON.stringify(item), original);
  const strong = structuredClone(item);
  strong.weightEvidence.trials[0].pDown = 0.7;
  assert.match(probabilityComparison(strong), /70.0%/);
  assert.match(probabilityComparison(strong), /尚未证明更有效/);
});
test("后续标签只重训选定配置，不覆盖首次开发/后段评价；相似案例剔除非代表视频的同目标日", async () => {
  const base = path.resolve("work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "weight-test-"));
  try {
    await fs.mkdir(path.join(root, "outputs"));
    const rows = samples(),
      background = { samples: rows, featureDefinitions: defs };
    const first = await addWeightStudyArtifacts(
        root,
        [],
        background,
        "2026-05-01T00:00:00Z",
      ),
      file = path.join(root, "work/feature-weight-study-first-result.json"),
      original = await fs.readFile(file, "utf8");
    const second = await addWeightStudyArtifacts(
      root,
      [],
      { ...background, samples: samples(67) },
      "2026-05-03T00:00:00Z",
    );
    assert.equal(second.currentTrainN, 67);
    assert.deepEqual(second.selected, first.selected);
    assert.deepEqual(second.finalEvaluation, first.finalEvaluation);
    assert.equal(await fs.readFile(file, "utf8"), original);
    const item = {
      record: { id: "another-video-same-target" },
      currentModelView: { eligible: true, pDown: 0.5 },
      backgroundFeatures: { values: rows[63].x },
    };
    const view = weightItemView(item, first, {
      ...background,
      videoRows: [
        { recordId: item.record.id, targetDate: rows[63].targetDate },
      ],
    });
    assert.ok(
      !view.neighbors.some((n) => n.targetDate === rows[63].targetDate),
    );
  } finally {
    assert.ok(path.resolve(root).startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

import { createHash } from "node:crypto";
import {
  availableTraining,
  fitLogistic,
  predict,
  metrics,
} from "./supervised-model.mjs";
import { wilson } from "./engine.ts";

export const WEIGHT_STUDY_VERSION = "feature-weight-study-2026-10-15-v1";
// Frozen before running this study. Select on development dates only; never
// select a model for its probability spread or its final evaluation score.
export const WEIGHT_PROTOCOL = Object.freeze({
  version: WEIGHT_STUDY_VERSION,
  developmentFraction: 0.7,
  minTrainDays: 24,
  minBinarySide: 5,
  minContinuousKnown: 20,
  maxStandardizedValue: 3,
  threshold: 0.5,
  candidates: [
    { id: "original", standardized: false, l2: 1 },
    { id: "scaled-1", standardized: true, l2: 1 },
    { id: "scaled-01", standardized: true, l2: 0.1 },
    { id: "scaled-001", standardized: true, l2: 0.01 },
  ],
  selection:
    "minimum development prequential Brier; ties prefer earlier candidate",
  finalEvaluation:
    "last 30% target dates; fixed selected configuration; only labels available before each publication",
  promotion:
    "research only; no automatic replacement or retrospective first estimates",
  neighbors: 8,
});
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sigmoid = (z) =>
  z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
const clamp = (v) => Math.max(-3, Math.min(3, v));
const loss = (p, y) =>
  -(
    y * Math.log(Math.max(p, 1e-12)) +
    (1 - y) * Math.log(Math.max(1 - p, 1e-12))
  );
const avg = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

function solve(matrix, values) {
  const a = matrix.map((row, i) => [...row, values[i]]),
    n = values.length;
  for (let j = 0; j < n; j++) {
    let pivot = j;
    for (let k = j + 1; k < n; k++)
      if (Math.abs(a[k][j]) > Math.abs(a[pivot][j])) pivot = k;
    [a[j], a[pivot]] = [a[pivot], a[j]];
    if (Math.abs(a[j][j]) < 1e-12) throw Error("Singular regularized fit");
    const d = a[j][j];
    for (let k = j; k <= n; k++) a[j][k] /= d;
    for (let i = 0; i < n; i++)
      if (i !== j) {
        const f = a[i][j];
        for (let k = j; k <= n; k++) a[i][k] -= f * a[j][k];
      }
  }
  return a.map((row) => row[n]);
}

export function fitWeighted(samples, definitions, config) {
  if (!samples.length) throw Error("Completed samples required");
  if (config.id === "original")
    return {
      config,
      original: fitLogistic(samples, definitions),
      n: samples.length,
    };
  const n = samples.length,
    d = definitions.length,
    downs = samples.filter((s) => s.y === 1).length;
  if (
    samples.some(
      (s) =>
        s.x.length !== d ||
        s.x.some(
          (v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 1),
        ) ||
        ![0, 1].includes(s.y),
    )
  )
    throw Error("Invalid training attributes");
  const columns = definitions.map((f, j) => {
    const known = samples.map((s) => s.x[j]).filter((v) => v !== null),
      mean = avg(known) ?? 0,
      variance = avg(known.map((x) => (x - mean) ** 2)) ?? 0,
      binary = known.every((x) => x === 0 || x === 1),
      on = known.filter((x) => x === 1).length,
      off = known.filter((x) => x === 0).length;
    const supported =
      downs > 0 &&
      downs < n &&
      variance > 1e-12 &&
      (binary
        ? Math.min(on, off) >= WEIGHT_PROTOCOL.minBinarySide
        : known.length >= WEIGHT_PROTOCOL.minContinuousKnown);
    return {
      ...f,
      index: j,
      mean,
      scale: Math.sqrt(variance) || 1,
      binary,
      on,
      off,
      known: known.length,
      supported,
      reason:
        variance <= 1e-12
          ? "训练内无对照变化"
          : binary && Math.min(on, off) < WEIGHT_PROTOCOL.minBinarySide
            ? "出现/未确认各不足5日的稀少特征不加权"
            : known.length < 20 && !binary
              ? "已知连续值不足20日"
              : "训练内标准化；正则化由开发集选择",
    };
  });
  // Identical columns in this training fold share one coefficient. Repeated
  // views and perfectly co-occurring props do not get independent votes.
  const groups = [];
  for (const c of columns.filter((c) => c.supported)) {
    const key = JSON.stringify(samples.map((s) => s.x[c.index]));
    const g = groups.find((g) => g.key === key);
    if (g) g.indices.push(c.index);
    else groups.push({ key, indices: [c.index], mean: c.mean, scale: c.scale });
  }
  const project = (x) => [
    1,
    ...groups.map((g) =>
      clamp(
        (avg(g.indices.map((j) => x[j] ?? columns[j].mean)) - g.mean) / g.scale,
      ),
    ),
  ];
  const X = samples.map((s) => project(s.x)),
    k = groups.length + 1,
    l2 = config.l2;
  let beta = [
      Math.log((downs + 0.5) / (n - downs + 0.5)),
      ...groups.map(() => 0),
    ],
    iterations = 0;
  const objective = (b) =>
    (samples.reduce(
      (s, r, i) =>
        s + loss(sigmoid(X[i].reduce((z, x, j) => z + x * b[j], 0)), r.y),
      0,
    ) +
      0.5 * loss(sigmoid(b[0]), 0) +
      0.5 * loss(sigmoid(b[0]), 1)) /
      (n + 1) +
    (l2 * b.slice(1).reduce((s, b) => s + b * b, 0)) / 2;
  for (let it = 0; it < 60; it++) {
    const gradient = Array(k).fill(0),
      H = Array.from({ length: k }, () => Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      const p = sigmoid(X[i].reduce((s, x, j) => s + x * beta[j], 0)),
        err = (p - samples[i].y) / (n + 1),
        v = (p * (1 - p)) / (n + 1);
      for (let j = 0; j < k; j++) {
        gradient[j] += err * X[i][j];
        for (let q = 0; q < k; q++) H[j][q] += v * X[i][j] * X[i][q];
      }
    }
    const p0 = sigmoid(beta[0]);
    gradient[0] += (p0 - 0.5) / (n + 1);
    H[0][0] += (p0 * (1 - p0)) / (n + 1);
    for (let j = 1; j < k; j++) {
      gradient[j] += l2 * beta[j];
      H[j][j] += l2;
    }
    for (let j = 0; j < k; j++) H[j][j] += 1e-10;
    const step = solve(H, gradient),
      old = objective(beta);
    let rate = 1,
      next;
    do {
      next = beta.map((b, j) => b - rate * step[j]);
      if (objective(next) <= old + 1e-13) break;
      rate /= 2;
    } while (rate > 1e-7);
    beta = next;
    iterations = it + 1;
    if (Math.max(...gradient.map(Math.abs)) < 1e-9) break;
  }
  return {
    config,
    n,
    downs,
    ups: n - downs,
    columns,
    groups: groups.map(({ key, ...g }, i) => ({ ...g, weight: beta[i + 1] })),
    intercept: beta[0],
    iterations,
    weights: columns.map((c) => {
      const g = groups.findIndex((g) => g.indices.includes(c.index));
      return g < 0 ? 0 : beta[g + 1] / groups[g].indices.length;
    }),
    trainingRecordIds: samples.map((s) => s.recordId),
    trainingTargetDates: samples.map((s) => s.targetDate),
  };
}

export function weightedProbability(model, x, neutralize = []) {
  if (model.original) {
    const y = x.map((v, j) =>
      neutralize.includes(j) ? model.original.means[j] : v,
    );
    return predict(model.original, y);
  }
  if (
    x.length !== model.columns.length ||
    x.some((v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 1))
  )
    throw Error("Invalid inference attributes");
  return sigmoid(
    model.intercept +
      model.groups.reduce(
        (s, g) =>
          s +
          g.weight *
            clamp(
              (avg(
                g.indices.map((j) =>
                  neutralize.includes(j)
                    ? model.columns[j].mean
                    : (x[j] ?? model.columns[j].mean),
                ),
              ) -
                g.mean) /
                g.scale,
            ),
        0,
      ),
  );
}

function foldRows(samples, definitions, config) {
  return samples.map((row) => {
    const train = availableTraining(samples, row.publishedAt, row.targetDate);
    if (train.length < WEIGHT_PROTOCOL.minTrainDays)
      return { ...row, status: "warmup", trainN: train.length };
    const model = fitWeighted(train, definitions, config),
      pDown = weightedProbability(model, row.x),
      baselineP = (train.filter((s) => s.y).length + 0.5) / (train.length + 1);
    return {
      recordId: row.recordId,
      url: row.url,
      targetDate: row.targetDate,
      predictionAt: row.publishedAt,
      trainN: train.length,
      lastTrainingLabelAt: train
        .map((s) => s.labelAvailableAt)
        .sort()
        .at(-1),
      pDown,
      y: row.y,
      ret1: row.ret1,
      hit: Number(pDown >= 0.5) === row.y,
      baselineP,
      baselineHit: Number(baselineP >= 0.5) === row.y,
      status: "retrospective-simulation",
      weights: model.original?.weights ?? model.weights,
      ablated: definitions.map((_, j) =>
        weightedProbability(model, row.x, [j]),
      ),
    };
  });
}

export function probabilitySpread(rows) {
  const xs = rows.filter((r) => r.status !== "warmup").map((r) => r.pDown);
  return {
    n: xs.length,
    min: xs.length ? Math.min(...xs) : null,
    max: xs.length ? Math.max(...xs) : null,
    meanDistanceFrom50: avg(xs.map((p) => Math.abs(p - 0.5))),
    outsideFivePoints: xs.filter((p) => Math.abs(p - 0.5) > 0.05).length,
  };
}

export function attributeHistory(samples, definitions) {
  return definitions.map((f, j) => {
    const on = samples.filter((s) => s.x[j] === 1),
      off = samples.filter((s) => s.x[j] === 0),
      binary = samples.every(
        (s) => s.x[j] === null || s.x[j] === 0 || s.x[j] === 1,
      ),
      downs = on.filter((s) => s.y).length,
      offDown = off.filter((s) => s.y).length;
    return {
      ...f,
      binary,
      onDays: on.length,
      onDowns: downs,
      onDownRate: on.length ? downs / on.length : null,
      onInterval: on.length ? wilson(downs, on.length) : null,
      unconfirmedDays: off.length,
      unconfirmedDownRate: off.length ? offDown / off.length : null,
      knownDays: samples.filter((s) => s.x[j] !== null).length,
      supported: binary
        ? Math.min(on.length, off.length) >= 5
        : samples.filter((s) => s.x[j] !== null).length >= 20,
      note: "按目标日去重；0代表局部采样未确认，不能视为确定不存在。关联不代表作者含义或因果。",
    };
  });
}

export function runWeightStudy(background, protocol = WEIGHT_PROTOCOL) {
  if (JSON.stringify(protocol) !== JSON.stringify(WEIGHT_PROTOCOL))
    throw Error("Protocol mismatch");
  const samples = background.samples,
    definitions = background.featureDefinitions,
    n = samples.length,
    split = Math.floor(n * protocol.developmentFraction),
    development = samples.slice(0, split),
    tail = samples.slice(split);
  if (split < protocol.minTrainDays + 8 || tail.length < 10)
    return {
      version: WEIGHT_STUDY_VERSION,
      status: "insufficient",
      n,
      reason: "开发集与后段评价日不足；不放大权重",
      protocol,
    };
  const candidates = protocol.candidates.map((config) => {
    const folds = foldRows(development, definitions, config);
    return {
      config,
      validation: metrics(folds),
      spread: probabilitySpread(folds),
      folds,
    };
  });
  const winner = [...candidates].sort(
      (a, b) =>
        a.validation.brier - b.validation.brier ||
        protocol.candidates.indexOf(a.config) -
          protocol.candidates.indexOf(b.config),
    )[0],
    selected = winner.config;
  const all = foldRows(samples, definitions, selected),
    finalRows = all.slice(split),
    reference =
      selected.id === "original"
        ? finalRows
        : foldRows(samples, definitions, protocol.candidates[0]).slice(split),
    final = metrics(finalRows),
    original = metrics(reference);
  const model = fitWeighted(samples, definitions, selected),
    history = attributeHistory(samples, definitions),
    devFolds = winner.folds.filter((r) => r.status !== "warmup");
  const effects = history.map((h, j) => ({
    ...h,
    weight: model.original?.weights[j] ?? model.weights[j],
    developmentAblationBrier: avg(
      devFolds.map((r) => (r.ablated[j] - r.y) ** 2 - (r.pDown - r.y) ** 2),
    ),
    positiveWeightFolds: devFolds.filter((r) => r.weights[j] > 1e-9).length,
    negativeWeightFolds: devFolds.filter((r) => r.weights[j] < -1e-9).length,
    activeFolds: devFolds.filter((r) => Math.abs(r.weights[j]) > 1e-9).length,
  }));
  const passesGate =
    selected.id !== "original" &&
    final.brier < original.brier &&
    final.brier < final.baselineBrier &&
    final.logLoss <= original.logLoss &&
    final.logLoss <= final.baselineLogLoss &&
    final.accuracy >= Math.max(original.accuracy, final.expandingMajority);
  return {
    version: WEIGHT_STUDY_VERSION,
    status: "complete",
    protocol,
    inputHash: hash(
      samples.map((s) => ({
        id: s.recordId,
        date: s.targetDate,
        x: s.x,
        y: s.y,
        available: s.labelAvailableAt,
      })),
    ),
    n,
    split: {
      developmentDays: split,
      evaluationDays: tail.length,
      developmentEnd: development.at(-1).targetDate,
      evaluationStart: tail[0].targetDate,
      evaluationEnd: tail.at(-1).targetDate,
    },
    selected,
    candidates: candidates.map(({ folds, ...c }) => c),
    finalEvaluation: {
      selected: final,
      original,
      spread: probabilitySpread(finalRows),
      originalSpread: probabilitySpread(reference),
      passesGate,
      note: "旧历史及特征定义已被查看，此处是后段时间模拟，不是全新盲测；该门槛仅供研究，不自动替换主模型。",
    },
    model,
    effects,
    developmentRows: devFolds,
    finalRows,
    referenceRows: reference,
    limitations: [
      "不以概率差大小选模型，也不把涨跌结果反向改成物件标签。",
      "正负权重由数据拟合；同日只一条代表，完全同现特征共享系数，不能单独归因。",
      "标准化参数、特征支持门槛和同现分组仅用当折训练数据。",
      "仅开发段选正则化；后段只评价预先选定配置与原模型、历史比例基线。",
      "历史样本量小且有市场阶段/连续道具混淆，所有候选概率未校准。",
      "报告当前重看旧图可能包含该条标签，不能计历史命中；首次判断不覆盖。",
    ],
  };
}

export function weightItemView(item, study, background) {
  if (
    study.status !== "complete" ||
    !item.currentModelView?.eligible ||
    item.currentModelView.pDown === null
  )
    return null;
  const x = item.backgroundFeatures.values,
    pDown = weightedProbability(study.model, x),
    importance = study.effects
      .map((e, j) => ({
        id: e.id,
        name: e.name,
        active: x[j] !== null && x[j] !== 0,
        value: x[j],
        weight: e.weight,
        deltaDown: pDown - weightedProbability(study.model, x, [j]),
        onDays: e.onDays,
        onDownRate: e.onDownRate,
        onInterval: e.onInterval,
        developmentAblationBrier: e.developmentAblationBrier,
        supported: e.supported,
      }))
      .filter((e) => e.active)
      .sort((a, b) => Math.abs(b.deltaDown) - Math.abs(a.deltaDown));
  const byId = new Map(background.samples.map((s) => [s.recordId, s]));
  const itemTarget =
    background.videoRows?.find((s) => s.recordId === item.record.id)
      ?.targetDate ?? byId.get(item.record.id)?.targetDate;
  const candidates = background.samples.filter(
    (s) => s.recordId !== item.record.id && s.targetDate !== itemTarget,
  );
  const fields = study.effects
    .map((e, j) => ({ e, j }))
    .filter(({ e }) => e.supported);
  const neighbors = candidates
    .map((s) => {
      const known = fields.filter(({ j }) => x[j] !== null && s.x[j] !== null),
        distance = known.length
          ? known.reduce((sum, { j }) => sum + Math.abs(x[j] - s.x[j]), 0) /
            known.length
          : 1;
      const common = fields
        .filter(({ j }) => x[j] === 1 && s.x[j] === 1)
        .map(({ e }) => e.name);
      return {
        recordId: s.recordId,
        url: s.url,
        publishedAt: s.publishedAt,
        targetDate: s.targetDate,
        ret1: s.ret1,
        down: !!s.y,
        distance,
        common,
      };
    })
    .sort(
      (a, b) =>
        a.distance - b.distance || b.publishedAt.localeCompare(a.publishedAt),
    )
    .slice(0, WEIGHT_PROTOCOL.neighbors);
  return {
    version: study.version,
    config: study.selected,
    pDown,
    pUp: 1 - pDown,
    originalDown: item.currentModelView.pDown,
    importance,
    neighbors,
    neighborDowns: neighbors.filter((r) => r.down).length,
    neighborN: neighbors.length,
    passesGate: study.finalEvaluation.passesGate,
    kind: "current-research-view",
    calibrated: false,
    inTraining: byId.has(item.record.id),
    note: "增强候选仅供研究；相似案例按已编码属性距离选取，逐目标日去重，不是独立胜率。对旧图重看会使用之后的数据。",
  };
}

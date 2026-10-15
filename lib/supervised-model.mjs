import { createHash } from "node:crypto";
import { localDate, wilson } from "./engine.ts";
import {
  FEATURES,
  USER_PRIOR_VERSION,
  PRIOR_ESTABLISHED_AT,
  extractFeatures,
} from "./current-interpretation.mjs";

export const MODEL_VERSION = "symbol-logistic-2026-10-14-v1";
// Freeze choices before examining the validation scores. No threshold/hyperparameter search.
export const CONFIG = Object.freeze({
  l2: 1,
  minTrainDays: 4,
  iterations: 4000,
  tolerance: 1e-10,
  threshold: 0.5,
  labels: "1=next-close-down;0=next-close-up",
  zeroReturn: "exclude",
  representative: "latest-eligible-video-per-target-day",
});
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const time = (v) => new Date(v).getTime();
const sigmoid = (z) =>
  z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
const completed = (prices, asOf) =>
  prices
    .filter(
      (p) =>
        p.closeConfirmed !== false &&
        time(p.date + "T15:05:00+08:00") <= time(asOf),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

export function eligibility(item, metadata) {
  const r = item.record,
    m = metadata.find((m) => m.id === r.id);
  if (!m)
    return {
      eligible: false,
      reason: "未登记本人原发／日常背景资格，不自动扩大训练范围。",
    };
  if (
    !r.timeVerified ||
    r.sourceType !== "original" ||
    !m.sourceVerified ||
    m.coauth
  )
    return { eligible: false, reason: "原发或发布时间未核实，或属于共创。" };
  if (r.market !== "a-share")
    return {
      eligible: false,
      reason: "话题未确认为A股；熊猫语境候选不替代范围核实。",
    };
  if (!m.everyday)
    return { eligible: false, reason: "非本人日常背景场景，未混入道具模型。" };
  return {
    eligible: true,
    reason: "已核实本人原发、A股话题、日常背景、非共创。",
  };
}

export function makeSamples(items, prices, asOf, metadata) {
  const closed = completed(prices, asOf),
    calendar = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const eligible = items.filter((i) => eligibility(i, metadata).eligible);
  const videoRows = eligible.map((i) => {
    const r = i.record,
      day = localDate(r.publishedAt),
      target = calendar.find((p) => p.date > day),
      end = target && closed.find((p) => p.date === target.date),
      base = closed.filter((p) => p.date <= day).at(-1),
      ret = end && base ? end.close / base.close - 1 : null,
      f = extractFeatures(i.observations);
    return {
      recordId: r.id,
      url: r.url,
      publishedAt: r.publishedAt,
      recordedAt: r.createdAt,
      imported: !!r.imported,
      targetDate: target?.date ?? null,
      baseDate: base?.date ?? null,
      baseClose: base?.close ?? null,
      targetClose: end?.close ?? null,
      ret1: ret,
      y: ret === null || ret === 0 ? null : Number(ret < 0),
      labelAvailableAt: end ? end.date + "T15:05:00+08:00" : null,
      x: f.values,
      anchors: f.anchors,
      pandaPresent: !!f.pandaIds.length,
      coverage: r.coverage || "partial",
      featureHash: hash({
        x: f.values,
        anchors: f.anchors,
        version: USER_PRIOR_VERSION,
      }),
      source: "retrospective feature archive",
    };
  });
  const byTarget = new Map();
  for (const r of videoRows.filter((r) => r.y !== null)) {
    const old = byTarget.get(r.targetDate);
    if (
      !old ||
      time(old.publishedAt) < time(r.publishedAt) ||
      (old.publishedAt === r.publishedAt && old.recordId < r.recordId)
    )
      byTarget.set(r.targetDate, r);
  }
  const samples = [...byTarget.values()].sort((a, b) =>
    a.targetDate.localeCompare(b.targetDate),
  );
  for (const s of samples)
    s.sameTargetVideoIds = videoRows
      .filter((r) => r.targetDate === s.targetDate)
      .map((r) => r.recordId);
  return {
    eligibleWorks: eligible.length,
    labeledWorks: videoRows.filter((r) => r.y !== null).length,
    pendingWorks: videoRows.filter((r) => r.ret1 === null).length,
    flatExcluded: videoRows.filter((r) => r.ret1 === 0).length,
    videoRows,
    samples,
  };
}

export function fitLogistic(
  samples,
  featureDefinitions = FEATURES,
  version = MODEL_VERSION,
) {
  if (!samples.length) throw Error("Cannot train without completed labels");
  const d = featureDefinitions.length,
    n = samples.length,
    downs = samples.filter((s) => s.y === 1).length;
  if (
    samples.some(
      (s) =>
        s.x.length !== d ||
        s.x.some((v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 1)),
    )
  )
    throw Error("Invalid feature vector");
  const means = featureDefinitions.map((_, j) => {
    const known = samples.map((s) => s.x[j]).filter((v) => v !== null);
    return known.length ? known.reduce((s, v) => s + v, 0) / known.length : 0;
  });
  const varying = means.map(
      (_, j) =>
        new Set(samples.map((s) => s.x[j]).filter((v) => v !== null)).size > 1,
    ),
    twoClasses = downs > 0 && downs < n;
  const active = varying.map((v) => v && twoClasses),
    weights = Array(d).fill(0);
  let intercept = Math.log((downs + 0.5) / (n - downs + 0.5)),
    iterations = 0;
  // Bernoulli cross-entropy plus two half-weight intercept-only pseudo-observations;
  // L2 penalty on feature coefficients only. Centers use training rows alone.
  const rate = 0.5 / (CONFIG.l2 + 0.25 * (d + 1));
  for (let k = 0; k < CONFIG.iterations; k++) {
    const gb = [sigmoid(intercept) - 0.5],
      gw = Array(d).fill(0);
    for (const r of samples) {
      const z =
          intercept +
          weights.reduce(
            (s, w, j) => s + w * ((r.x[j] ?? means[j]) - means[j]),
            0,
          ),
        err = sigmoid(z) - r.y;
      gb[0] += err;
      for (let j = 0; j < d; j++)
        if (active[j]) gw[j] += err * ((r.x[j] ?? means[j]) - means[j]);
    }
    const bgrad = gb[0] / (n + 1);
    let norm = Math.abs(bgrad);
    intercept -= rate * bgrad;
    for (let j = 0; j < d; j++)
      if (active[j]) {
        const g = gw[j] / (n + 1) + CONFIG.l2 * weights[j];
        norm = Math.max(norm, Math.abs(g));
        weights[j] -= rate * g;
      }
    iterations = k + 1;
    if (norm < CONFIG.tolerance) break;
  }
  const model = {
    version,
    priorVersion: USER_PRIOR_VERSION,
    config: CONFIG,
    n,
    downs,
    ups: n - downs,
    intercept,
    weights,
    means,
    active,
    iterations,
    kind: twoClasses ? "regularized-logistic" : "single-class-intercept-only",
    trainingTargetDates: samples.map((s) => s.targetDate),
    trainingRecordIds: samples.map((s) => s.recordId),
    lastLabelAvailableAt: samples
      .map((s) => s.labelAvailableAt)
      .sort()
      .at(-1),
    features: featureDefinitions.map((f, j) => ({
      ...f,
      weight: weights[j],
      mean: means[j],
      active: active[j],
      confirmedDays: samples.filter((s) => s.x[j] === 1).length,
      reason: !twoClasses
        ? "只有单一涨跌类别，仅拟合平滑截距"
        : !varying[j]
          ? "训练期没有对照变化，系数固定为0"
          : "训练期内估计；不代表作者意图或因果",
    })),
  };
  model.id =
    version +
    "-" +
    hash({
      samples: samples.map((s) => ({
        recordId: s.recordId,
        target: s.targetDate,
        x: s.x,
        y: s.y,
        base: s.baseClose,
        end: s.targetClose,
      })),
      config: CONFIG,
      prior: USER_PRIOR_VERSION,
    }).slice(0, 20);
  return model;
}

export function predict(model, x) {
  if (
    x.length !== model.weights.length ||
    x.some((v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 1))
  )
    throw Error("Invalid inference vector");
  return sigmoid(
    model.intercept +
      model.weights.reduce(
        (s, w, j) => s + w * ((x[j] ?? model.means[j]) - model.means[j]),
        0,
      ),
  );
}
export function availableTraining(samples, at, excludeTarget = null) {
  return samples.filter(
    (s) =>
      s.targetDate !== excludeTarget &&
      time(s.labelAvailableAt) <= time(at) &&
      time(s.publishedAt) < time(at),
  );
}
export function walkForward(samples) {
  return samples.map((row) => {
    const train = availableTraining(samples, row.publishedAt, row.targetDate);
    if (train.length < CONFIG.minTrainDays)
      return {
        recordId: row.recordId,
        targetDate: row.targetDate,
        status: "warmup",
        trainN: train.length,
      };
    const model = fitLogistic(train),
      pDown = predict(model, row.x),
      baselineP = (model.downs + 0.5) / (model.n + 1);
    return {
      recordId: row.recordId,
      url: row.url,
      predictionAt: row.publishedAt,
      targetDate: row.targetDate,
      ret1: row.ret1,
      y: row.y,
      pDown,
      direction: pDown >= CONFIG.threshold ? "down" : "up",
      hit: Number(pDown >= CONFIG.threshold) === row.y,
      modelId: model.id,
      modelKind: model.kind,
      trainN: train.length,
      trainingTargetDates: model.trainingTargetDates,
      trainingRecordIds: model.trainingRecordIds,
      lastTrainingLabelAt: model.lastLabelAvailableAt,
      baselineP,
      baselineHit: Number(baselineP >= 0.5) === row.y,
      status: "retrospective-simulation",
    };
  });
}
export function metrics(rows) {
  const r = rows.filter((r) => r.status !== "warmup"),
    n = r.length,
    hits = r.filter((r) => r.hit).length;
  const average = (fn) => (n ? r.reduce((s, r) => s + fn(r), 0) / n : null);
  const loss = (p, y) =>
    -(
      y * Math.log(Math.max(p, 1e-12)) +
      (1 - y) * Math.log(Math.max(1 - p, 1e-12))
    );
  return {
    n,
    hits,
    accuracy: n ? hits / n : null,
    ci: wilson(hits, n),
    alwaysDown: average((r) => r.y),
    alwaysUp: average((r) => 1 - r.y),
    expandingMajority: average((r) => Number(r.baselineHit)),
    brier: average((r) => (r.pDown - r.y) ** 2),
    baselineBrier: average((r) => (r.baselineP - r.y) ** 2),
    logLoss: average((r) => loss(r.pDown, r.y)),
    baselineLogLoss: average((r) => loss(r.baselineP, r.y)),
    singleClassFallbacks: r.filter(
      (r) => r.modelKind === "single-class-intercept-only",
    ).length,
  };
}

export function buildModelStudy(items, prices, asOf, metadata) {
  const dataset = makeSamples(items, prices, asOf, metadata),
    folds = walkForward(dataset.samples),
    validation = metrics(folds),
    model = dataset.samples.length ? fitLogistic(dataset.samples) : null;
  const pairs = [];
  if (dataset.samples.length)
    for (let a = 0; a < FEATURES.length; a++)
      for (let b = a + 1; b < FEATURES.length; b++)
        if (
          model.active[a] &&
          model.active[b] &&
          dataset.samples.every((r) => r.x[a] === r.x[b])
        )
          pairs.push([FEATURES[a].name, FEATURES[b].name]);
  return {
    version: MODEL_VERSION,
    priorVersion: USER_PRIOR_VERSION,
    priorEstablishedAt: PRIOR_ESTABLISHED_AT,
    generatedAt: asOf,
    config: CONFIG,
    ...dataset,
    model,
    folds,
    validation,
    collinearPairs: pairs,
    status: "experimental",
    prospectiveAccuracy: null,
    conclusion:
      "已完成真实特征监督训练；有效日期少、事后定义特征且缺独立事前测试，模型概率未校准，尚未证明优于简单基线。",
    labelDefinition:
      "发布日（非交易日用此前最近交易日）收盘到下一交易日收盘：小于0标跌、大于0标涨、等于0排除；15:05前的当日价格不作收盘。",
    selection:
      "只纳入已核实本人原发、A股话题、日常背景、非共创作品；每个次日目标日固定用发布最晚的一条合格视频，选择不参考结果。",
    validationMethod:
      "按发布时间向前推进，每折只使用截至该视频发布时已经15:05确认收盘的标签；训练不足4日为预热，单一类别只用平滑截距。全部历史折是事后模拟，非盲测。",
    limitations: [
      "训练的是结构化特征到次日涨跌的逻辑回归；未训练新的图像识别模型。",
      "熊猫只记录语境，不用其熊字当偏空特征；绿色花盆与绿色叶片不混为同一物件。",
      "局部采样的0是未确认，可能漏掉片尾动作；数量、字幕和稀少动作目前保留证据，不强行拟合高维参数。",
      "连续道具、强相关特征与市场阶段可能混淆；时间去重减少重复，不保证交易日统计独立。",
      "这次先验与特征定义发生在历史结果公开以后；即使时间切分也不能补成真正独立盲测。",
    ],
    references: [
      {
        title: "scikit-learn: Logistic regression",
        url: "https://scikit-learn.org/stable/modules/linear_model.html#logistic-regression",
      },
      {
        title: "scikit-learn: Time series cross-validation",
        url: "https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-of-time-series-data",
      },
    ],
  };
}

export function itemModelView(item, study, metadata, frozen = null) {
  const qualified = eligibility(item, metadata);
  if (!qualified.eligible)
    return {
      ...qualified,
      status: "excluded",
      summary: "模型未适用：" + qualified.reason,
      pDown: null,
      direction: null,
    };
  const r = item.record,
    visual = extractFeatures(item.observations),
    row = study.videoRows.find((v) => v.recordId === r.id);
  if (frozen)
    return {
      ...frozen,
      eligible: true,
      status: "locked",
      summary:
        "首次模型估计：" +
        (frozen.direction === "down" ? "偏跌" : "偏涨") +
        "（实验性）",
    };
  const at = row?.ret1 === null ? study.generatedAt : r.publishedAt,
    train = availableTraining(study.samples, at, row?.targetDate);
  if (train.length < CONFIG.minTrainDays)
    return {
      eligible: true,
      status: "insufficient",
      trainN: train.length,
      pDown: null,
      direction: null,
      summary: "模型预热：截至该发布时间可用训练日不足4个。",
    };
  const model = fitLogistic(train),
    pDown = predict(model, visual.values),
    direction = pDown >= 0.5 ? "down" : "up";
  return {
    recordId: r.id,
    publishedAt: r.publishedAt,
    targetDate: row?.targetDate ?? null,
    predictionAt: at,
    pDown,
    direction,
    modelId: model.id,
    trainN: train.length,
    trainingTargetDates: model.trainingTargetDates,
    lastTrainingLabelAt: model.lastLabelAvailableAt,
    featureHash: row.featureHash,
    features: visual.values,
    priorVersion: USER_PRIOR_VERSION,
    modelVersion: MODEL_VERSION,
    eligible: true,
    status: row.ret1 === null ? "experimental-now" : "retrospective-simulation",
    kind:
      row.ret1 === null
        ? "first-estimate-after-publication"
        : "historical-reconstruction",
    prospectiveCandidate: false,
    operationalForecast: null,
    confidence: "低；未经独立事前验证与概率校准",
    summary:
      "实验模型：次日" +
      (direction === "down" ? "偏跌" : "偏涨") +
      "，不能视为已验证预测。",
    model,
  };
}

export function evaluateSnapshot(snapshot, prices, asOf) {
  const closed = completed(prices, asOf),
    pubDay = localDate(snapshot.publishedAt),
    target = prices
      .filter((p) => p.date > pubDay)
      .sort((a, b) => a.date.localeCompare(b.date))[0],
    end = target && closed.find((p) => p.date === target.date),
    base = closed.filter((p) => p.date <= pubDay).at(-1);
  const prospective =
    !!target &&
    snapshot.prospectiveCandidate &&
    time(snapshot.predictionAt) < time(target.date + "T09:30:00+08:00");
  const ret1 = end && base ? end.close / base.close - 1 : null;
  return {
    recordId: snapshot.recordId,
    targetDate: target?.date ?? null,
    prospective,
    status: ret1 === null ? "pending" : "ready",
    ret1,
    hit:
      ret1 === null || ret1 === 0
        ? null
        : snapshot.direction === "down"
          ? ret1 < 0
          : ret1 > 0,
    kind: !target
      ? "目标交易日待真实行情日历确认；首次估计已锁定，前瞻资格待核实"
      : prospective
        ? "前瞻实验判断"
        : "首次估计晚于目标开盘／历史复盘，不计前瞻成绩",
  };
}

import {
  extractTypedFeatures,
  TYPE_RESOLUTION_VERSION,
} from "./object-types.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  FEATURES,
  extractFeatures,
  USER_PRIOR_VERSION,
} from "./current-interpretation.mjs";
import {
  CONFIG,
  fitLogistic,
  predict,
  availableTraining,
  metrics,
  evaluateSnapshot,
} from "./supervised-model.mjs";
import { localDate, wilson } from "./engine.ts";
export const BACKGROUND_VERSION = "background-attributes-2026-10-15-v4";
export const BACKGROUND_ESTABLISHED_AT = "2026-10-14T23:08:43.840Z";
export const BACKGROUND_FEATURES = Object.freeze([
  ...FEATURES,
  { id: "panda_present", name: "熊猫出现（语境特征）" },
  { id: "globe_present", name: "地球仪出现" },
  { id: "bull_present", name: "牛摆件出现" },
  { id: "horse_present", name: "马摆件出现" },
  { id: "green_cup", name: "绿色杯具" },
  { id: "red_cup", name: "红色杯具" },
  { id: "green_pot", name: "绿色花盆" },
  { id: "globe_high", name: "地球仪处于高位（位置描述）" },
  { id: "globe_x", name: "地球仪横向位置（截图归一化）" },
  { id: "globe_y", name: "地球仪纵向位置（截图归一化）" },
  { id: "bear_x", name: "普通熊横向位置（截图归一化）" },
  { id: "bear_y", name: "普通熊纵向位置（截图归一化）" },
  { id: "main_types", name: "同帧确认道具类型数（局部）" },
  { id: "known_count", name: "已确认物件数量上限（缩放）" },
  { id: "inverted_object", name: "有倒立物件" },
]);
const digest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const read = async (p, fallback) => {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return fallback;
  }
};
async function immutable(p, value) {
  try {
    await fs.writeFile(p, JSON.stringify(value, null, 2), { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const old = await read(p, null);
    if (JSON.stringify(old) !== JSON.stringify(value))
      throw Error("Immutable background model collision");
  }
}
const clamp = (v) => Math.max(0, Math.min(1, v));

export function backgroundFeatures(item) {
  const f = extractTypedFeatures(item.observations),
    nodes = f.nodes;
  // Preserve the whole-video symbol evidence; geometric features use the recurring
  // speaking backdrop only. A photographed moon/reflection is not a globe.
  const main = nodes.filter(
    (o) =>
      !["text", "scene", "reflection", "photo"].includes(o.kind) &&
      !/片尾|全屏|插页|照片|展示画面/.test(o.position || ""),
  );
  const vector = [...f.values],
    anchors = { ...f.anchors };
  const add = (id, objects) => {
    vector.push(Number(objects.length > 0));
    anchors[id] = objects.map((o) => o.id);
  };
  add(
    "panda_present",
    nodes.filter((o) => o.name === "panda"),
  );
  add(
    "globe_present",
    main.filter((o) => o.name === "globe"),
  );
  add(
    "bull_present",
    nodes.filter((o) => o.name === "bull"),
  );
  add(
    "horse_present",
    nodes.filter((o) => o.name === "horse"),
  );
  const cups = nodes.filter((o) => o.kind === "cup" || /杯/.test(o.name));
  add(
    "green_cup",
    cups.filter((o) => o.colors.includes("green")),
  );
  add(
    "red_cup",
    cups.filter((o) => o.colors.includes("red")),
  );
  add(
    "green_pot",
    nodes.filter((o) => /花盆|盆器/.test(o.name) && o.colors.includes("green")),
  );
  add(
    "globe_high",
    main.filter(
      (o) => o.name === "globe" && /高|头顶|顶部|上方/.test(o.position || ""),
    ),
  );
  function coordinates(name) {
    const o = main.find((o) => o.name === name);
    const a = o && item.attachments?.find((a) => a.observationId === o.id),
      s = a && item.shots?.find((s) => s.key === a.shotKey);
    if (!a?.crop || !s) return [null, null, []];
    const [x, y, w, h] = a.crop;
    return [
      clamp((x + w / 2) / (s.width || 1280)),
      clamp((y + h / 2) / (s.height || 720)),
      [o.id],
    ];
  }
  for (const name of ["globe", "bear"]) {
    const [x, y, ids] = coordinates(name);
    vector.push(x, y);
    anchors[name + "_x"] = ids;
    anchors[name + "_y"] = ids;
  }
  const byFrame = new Map();
  for (const o of main)
    byFrame.set(o.frameIndex, [...(byFrame.get(o.frameIndex) || []), o]);
  const types = Math.max(
    0,
    ...[...byFrame.values()].map(
      (rows) => new Set(rows.map((o) => o.name)).size,
    ),
  );
  vector.push(Math.min(types, 12) / 12);
  anchors.main_types = main.map((o) => o.id);
  const counts = main.filter((o) => Number.isFinite(o.count));
  vector.push(
    counts.length
      ? Math.min(Math.max(...counts.map((o) => o.count)), 10) / 10
      : null,
  );
  anchors.known_count = counts.map((o) => o.id);
  add(
    "inverted_object",
    nodes.filter((o) => o.orientation === "upside_down"),
  );
  if (vector.length !== BACKGROUND_FEATURES.length)
    throw Error("Background encoder mismatch");
  return {
    version: BACKGROUND_VERSION,
    values: vector,
    anchors,
    confirmedMainTypes: types,
    fields: BACKGROUND_FEATURES.map((def, j) => ({
      ...def,
      value: vector[j],
      evidenceIds: anchors[def.id] || [],
    })),
    observedObjects: nodes.map((o) => ({
      id: o.id,
      name: o.name,
      label: o.label,
      colors: o.colors,
      count: o.count ?? null,
      position: o.position ?? null,
      orientation: o.orientation,
      actions: o.actions,
      relations: o.relations,
      frameIndex: o.frameIndex,
      evidenceTime: o.evidenceTime,
      confidence: o.confidence,
    })),
    missing:
      "0是局部采样未确认；坐标/数量缺数据为null，用该折训练均值填充。坐标来自人工裁切定位，非新检测网络的精确框。",
  };
}

export function inferenceEligibility(item, metadata) {
  const r = item.record,
    m = metadata.find((m) => m.id === r.id);
  if (
    !r.timeVerified ||
    r.sourceType !== "original" ||
    !m?.sourceVerified ||
    m.coauth
  )
    return {
      eligible: false,
      reason: "本人原发／发布时间未核实、共创或尚未登记背景资格。",
    };
  if (m.note?.includes("未取得真实播放画面"))
    return {
      eligible: false,
      reason:
        "未取得可核实的真实播放画面，不能确认背景属性；不输出概率、不纳入训练。",
    };
  if (!m.everyday)
    return {
      eligible: false,
      reason: "访谈、旅途等背景与训练中的日常道具场景不同。",
    };
  const f = backgroundFeatures(item);
  if (f.confirmedMainTypes === 0)
    return {
      eligible: false,
      reason: "尚无可确认的日常背景物件，不能把空画面当完整特征。",
    };
  return {
    eligible: true,
    reason:
      "已核实本人日常道具场景；以背景预测上证下一交易日是独立实验目标，不受正文话题限制。",
  };
}

export function makeBackgroundSamples(items, metadata, prices, asOf) {
  const calendar = [...prices].sort((a, b) => a.date.localeCompare(b.date)),
    closed = calendar.filter(
      (p) =>
        p.closeConfirmed !== false &&
        new Date(p.date + "T15:05:00+08:00") <= new Date(asOf),
    );
  const videoRows = items
    .filter((i) => inferenceEligibility(i, metadata).eligible)
    .map((i) => {
      const r = i.record,
        f = backgroundFeatures(i),
        day = localDate(r.publishedAt),
        target = calendar.find((p) => p.date > day),
        end = target && closed.find((p) => p.date === target.date),
        base = closed.filter((p) => p.date <= day).at(-1),
        ret = end && base ? end.close / base.close - 1 : null;
      return {
        recordId: r.id,
        url: r.url,
        publishedAt: r.publishedAt,
        originalMarket: r.market,
        targetDate: target?.date ?? null,
        baseDate: base?.date ?? null,
        baseClose: base?.close ?? null,
        targetClose: end?.close ?? null,
        ret1: ret,
        y: ret === null || ret === 0 ? null : Number(ret < 0),
        labelAvailableAt: end ? end.date + "T15:05:00+08:00" : null,
        x: f.values,
        coverage: r.coverage || "partial",
        source: "统一上证目标的同类背景实验；原话市场保留",
      };
    });
  const byTarget = new Map();
  for (const row of videoRows.filter((r) => r.y !== null)) {
    const old = byTarget.get(row.targetDate);
    if (
      !old ||
      new Date(old.publishedAt) < new Date(row.publishedAt) ||
      (old.publishedAt === row.publishedAt && old.recordId < row.recordId)
    )
      byTarget.set(row.targetDate, row);
  }
  const samples = [...byTarget.values()].sort((a, b) =>
    a.targetDate.localeCompare(b.targetDate),
  );
  for (const s of samples)
    s.sameTargetVideoIds = videoRows
      .filter((r) => r.targetDate === s.targetDate)
      .map((r) => r.recordId);
  return {
    samples,
    videoRows,
    eligibleWorks: videoRows.length,
    labeledWorks: videoRows.filter((r) => r.y !== null).length,
    pendingWorks: videoRows.filter((r) => r.ret1 === null).length,
  };
}
export function backgroundStudy(items, legacyStudy, metadata, prices) {
  const dataset = makeBackgroundSamples(
      items,
      metadata,
      prices,
      legacyStudy.generatedAt,
    ),
    samples = dataset.samples;
  const model = samples.length
    ? fitLogistic(samples, BACKGROUND_FEATURES, BACKGROUND_VERSION)
    : null;
  const folds = samples.map((row) => {
    const train = availableTraining(samples, row.publishedAt, row.targetDate);
    if (train.length < CONFIG.minTrainDays)
      return {
        recordId: row.recordId,
        targetDate: row.targetDate,
        status: "warmup",
        trainN: train.length,
      };
    const fitted = fitLogistic(train, BACKGROUND_FEATURES, BACKGROUND_VERSION),
      pDown = predict(fitted, row.x),
      baselineP = (fitted.downs + 0.5) / (fitted.n + 1);
    return {
      recordId: row.recordId,
      url: row.url,
      predictionAt: row.publishedAt,
      targetDate: row.targetDate,
      ret1: row.ret1,
      y: row.y,
      pDown,
      direction: pDown >= 0.5 ? "down" : "up",
      hit: Number(pDown >= 0.5) === row.y,
      modelId: fitted.id,
      modelKind: fitted.kind,
      trainN: train.length,
      trainingTargetDates: fitted.trainingTargetDates,
      lastTrainingLabelAt: fitted.lastLabelAvailableAt,
      baselineP,
      baselineHit: Number(baselineP >= 0.5) === row.y,
      status: "retrospective-simulation",
    };
  });
  return {
    version: BACKGROUND_VERSION,
    establishedAt: BACKGROUND_ESTABLISHED_AT,
    typeResolutionVersion: TYPE_RESOLUTION_VERSION,
    generatedAt: legacyStudy.generatedAt,
    featureDefinitions: BACKGROUND_FEATURES,
    ...dataset,
    model,
    folds,
    validation: metrics(folds),
    trainingPolicy:
      "新版本训练本人同类日常背景，正文市场不限；统一标签为上证下一交易日。同目标日取发布最晚的合格视频，选择不看结果；原严格A股v1研究与旧预测完整保留。",
    inferencePolicy:
      "已核实本人日常背景，不要求正文必须谈A股。模型研究目标固定为上证下一交易日，独立于作者讲话市场与时间。当前模型重看旧图不计回测准确率。",
    pipeline:
      "可见暂停截图 → 本聊天视觉能力读取并核实物件属性 → 24维结构化特征 → 已训练逻辑回归 → 上涨/下跌估计概率。视觉识别未用涨跌标签重新训练。",
    labelDefinition: legacyStudy.labelDefinition,
    limitations: [
      "训练日仍少，输出未经概率校准，不代表真实准确率。",
      "v4只修复已核实类别与具体名称的映射；旧v3结果和首次判断保留。历史特征形成于结果公开后，时间模拟不是独立盲测。",
      "没有在训练期出现或没有变化的物件/颜色/位置系数为0，模型没有学会这些特征的涨跌关联。",
      "物件数量与位置只能用已确认字段；没有精确框、缺图和遮挡均保留缺失，不能靠看行情补标。",
    ],
  };
}

export async function addBackgroundInference(
  root,
  items,
  legacyStudy,
  metadata,
  prices,
) {
  const study = backgroundStudy(items, legacyStudy, metadata, prices),
    dir = path.join(root, "work/background-models");
  await fs.mkdir(dir, { recursive: true });
  if (study.model)
    await immutable(path.join(dir, study.model.id + ".json"), study.model);
  const storePath = path.join(root, "work/background-predictions.json"),
    store = await read(storePath, { version: 1, predictions: [] });
  let added = 0;
  const trainingIds = new Set(study.model?.trainingRecordIds || []);
  for (const item of items) {
    const gate = inferenceEligibility(item, metadata),
      features = backgroundFeatures(item);
    item.backgroundFeatures = features;
    if (!gate.eligible || !study.model) {
      item.currentModelView = {
        status: "unavailable",
        ...gate,
        pDown: null,
        pUp: null,
        reason: study.model ? gate.reason : "还没有完成的训练标签。",
      };
      continue;
    }
    const pDown = predict(study.model, features.values);
    const unavailableFeatures = features.fields
      .filter((f, j) => f.evidenceIds.length && !study.model.active[j])
      .map((f) => f.name);
    const neverSeen = features.fields
      .filter(
        (f, j) => f.value === 1 && study.samples.every((s) => s.x[j] !== 1),
      )
      .map((f) => f.name);
    const availableAnchors = features.fields.filter(
      (f, j) => study.model.active[j] && f.evidenceIds.length,
    ).length;
    item.currentModelView = {
      status: "current-model",
      eligible: true,
      reason: gate.reason,
      pDown,
      pUp: 1 - pDown,
      direction: pDown >= 0.5 ? "down" : "up",
      target: "上证指数下一交易日收盘相对发布日（或前收）涨跌",
      predictionAt: study.generatedAt,
      modelId: study.model.id,
      modelVersion: BACKGROUND_VERSION,
      trainN: study.model.n,
      lastTrainingLabelAt: study.model.lastLabelAvailableAt,
      features: features.values,
      featureHash: digest(features.values),
      inTraining: trainingIds.has(item.record.id),
      unavailableFeatures,
      neverSeen,
      baselineOnly: availableAnchors === 0,
      confidence: "低 / 未校准",
      validationEligible: false,
      note: "现在用已训练模型看这条画面的参考估计；旧视频可能本身参与训练，不属于当时的预测，也不计历史命中。",
    };
    // Freeze a distinct first v2 experimental estimate for newly observed works. A
    // later current-model refresh never overwrites this estimate or v1 predictions.
    if (
      !item.record.imported &&
      new Date(item.record.createdAt) >= new Date(BACKGROUND_ESTABLISHED_AT) &&
      new Date(study.generatedAt) >= new Date(item.record.createdAt) &&
      new Date(study.generatedAt) >= new Date(BACKGROUND_ESTABLISHED_AT)
    ) {
      let first = store.predictions.find(
        (p) =>
          p.recordId === item.record.id &&
          p.modelVersion === BACKGROUND_VERSION,
      );
      if (!first) {
        const { unavailableFeatures, neverSeen, ...view } =
          item.currentModelView;
        first = {
          ...view,
          recordId: item.record.id,
          publishedAt: item.record.publishedAt,
          priorVersion: USER_PRIOR_VERSION,
          kind: "first-background-estimate",
          prospectiveCandidate:
            new Date(study.generatedAt) >=
              new Date(BACKGROUND_ESTABLISHED_AT) &&
            new Date(study.generatedAt) >= new Date(item.record.createdAt),
          operationalForecast: null,
        };
        await immutable(
          path.join(dir, item.record.id + "-" + BACKGROUND_VERSION + ".json"),
          first,
        );
        store.predictions.push(first);
        added++;
      }
      item.firstBackgroundEstimate = {
        ...first,
        outcome: evaluateSnapshot(first, prices, study.generatedAt),
      };
    }
  }
  if (added) {
    await fs.writeFile(storePath + ".tmp", JSON.stringify(store, null, 2));
    await fs.rename(storePath + ".tmp", storePath);
  }
  study.coverage = {
    total: items.length,
    available: items.filter((i) => i.currentModelView.pDown !== null).length,
    unavailable: items.filter((i) => i.currentModelView.pDown === null).length,
    legacyStatuses: Object.fromEntries(
      [...new Set(items.map((i) => i.modelView.status))].map((k) => [
        k,
        items.filter((i) => i.modelView.status === k).length,
      ]),
    ),
  };
  study.firstEstimates = store.predictions
    .filter((s) => s.modelVersion === BACKGROUND_VERSION)
    .map((s) => ({
      ...s,
      outcome: evaluateSnapshot(s, prices, study.generatedAt),
    }));
  const forward = new Map();
  for (const s of study.firstEstimates.filter(
    (s) => s.outcome.prospective && s.outcome.hit !== null,
  )) {
    forward.set(s.outcome.targetDate, [
      ...(forward.get(s.outcome.targetDate) || []),
      s,
    ]);
  }
  let forwardN = 0,
    forwardHits = 0,
    conflicts = 0;
  for (const rows of forward.values()) {
    if (new Set(rows.map((s) => s.direction)).size > 1) {
      conflicts++;
      continue;
    }
    forwardN++;
    if (rows[0].outcome.hit) forwardHits++;
  }
  study.firstEstimatesSummary = {
    predictions: study.firstEstimates.length,
    pendingPredictions: study.firstEstimates.filter(
      (s) => s.outcome.status === "pending",
    ).length,
    completedTargetDays: forwardN,
    hits: forwardHits,
    accuracy: forwardN ? forwardHits / forwardN : null,
    ci: wilson(forwardHits, forwardN),
    conflicts,
  };
  study.priorVersions = store.predictions
    .filter((s) => s.modelVersion !== BACKGROUND_VERSION)
    .map((s) => ({
      recordId: s.recordId,
      modelVersion: s.modelVersion,
      predictionAt: s.predictionAt,
      modelId: s.modelId,
      pDown: s.pDown,
    }));
  await fs.writeFile(
    path.join(root, "outputs/背景特征模型与概率.json"),
    JSON.stringify(study, null, 2),
  );
  await fs.writeFile(
    path.join(root, "outputs/当前背景概率说明.md"),
    backgroundMarkdown(study, items),
  );
  return study;
}

export function backgroundMarkdown(s, items) {
  const v = s.validation;
  return `# 当前背景模型：识别、概率与历史验证

更新于 ${s.generatedAt}。模型 ${s.version}。

${s.pipeline}

## 为什么之前很多视频没有概率

旧界面把历史时间模拟放在主位置：${s.coverage.legacyStatuses.insufficient || 0}条因当时可用训练日不足4个而预热，${s.coverage.legacyStatuses.excluded || 0}条被来源/场景/市场条件排除。这里的4是历史实验的预热参数，不是每次识别视频都要再收集4天。

现在主卡用当前已训练模型解读画面，共${s.coverage.available}/${s.coverage.total}条可比背景显示估计涨跌概率；其余${s.coverage.unavailable}条给出来源/场景/缺证据原因。${s.inferencePolicy}

## 当前模型学到了什么

${s.trainingPolicy} 本版合格背景${s.eligibleWorks}条，${s.labeledWorks}条有已完成标签，${s.pendingWorks}条待完成；按目标日去重后${s.samples.length}个训练日、${s.model?.downs || 0}跌${s.model?.ups || 0}涨。24维属性里${s.model?.active.filter(Boolean).length || 0}维有可估计的对照变化。不是加了属性就证明更准确。

${s.labelDefinition} 输出是发生涨/跌的二分类估计概率，不是指数涨跌幅。

| 属性 | 系数 | 能否估计关联 |
|---|---:|---|
${s.model?.features.map((f) => `| ${f.name} | ${f.weight.toFixed(6)} | ${f.reason} |`).join("\n") || ""}

当某条出现训练期从未确认的绿色杯具等特征，识别结果仍保留，但该系数为0，不能把其他道具产生的概率说成杯具已预测成功。位置由真实截图的人工裁切中心归一化，数量用已确认字段；未识别数量/缺裁切坐标保留null，只使用该折训练均值填充。

## 三种结果分开

1. 当前模型看旧图：给参考概率，但会标记使用较晚历史/可能本身参与训练，绝不计算回测命中。
2. 历史时间模拟：只用视频发布当时已完成的标签。当前${v.n}个可验证目标日、${v.hits}个符合；比例${v.accuracy === null ? "—" : (v.accuracy * 100).toFixed(1) + "%"}，始终猜跌${v.alwaysDown === null ? "—" : (v.alwaysDown * 100).toFixed(1) + "%"}。未证明可靠能力。
3. 新视频首次本版实验判断：单独锁定，后续当前模型重训不改它，此前v1/v2判断独立保留。上证是工具的研究目标，不冒充作者对港股/海外的原观点。未来结果须真实完成，且锁定早于下一交易日开盘才计前瞻实验。

${s.limitations.map((l) => "- " + l).join("\n")}

## 当前逐视频概率（不是历史预测成绩）

| 发布时间 | 视频 | 估计涨概率 | 估计跌概率 | 状态 |
|---|---|---:|---:|---|
${items
  .map((i) => {
    const m = i.currentModelView;
    return `| ${i.record.publishedAt} | [${i.record.title}](${i.record.url}) | ${m.pUp === null ? "—" : (m.pUp * 100).toFixed(1) + "%"} | ${m.pDown === null ? "—" : (m.pDown * 100).toFixed(1) + "%"} | ${m.pDown === null ? m.reason : m.inTraining ? "自身是训练代表样本；仅当前复盘参考" : "当前模型看图；低可信度"} |`;
  })
  .join("\n")}
`;
}

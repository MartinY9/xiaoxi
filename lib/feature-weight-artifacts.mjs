import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  WEIGHT_PROTOCOL,
  runWeightStudy,
  fitWeighted,
  weightedProbability,
  weightItemView,
  attributeHistory,
} from "./feature-weight-study.mjs";
import { retainStrongFirsts, STRONG_VERSION } from "./strong-experiment.mjs";
const read = async (p, fallback) => {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return fallback;
  }
};
const digest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const pc = (v) =>
  v === null || v === undefined ? "—" : (v * 100).toFixed(1) + "%";

export async function addWeightStudyArtifacts(
  root,
  items,
  background,
  asOf,
  prices = [],
) {
  const dir = path.join(root, "work");
  await fs.mkdir(dir, { recursive: true });
  const protocolPath = path.join(dir, "feature-weight-protocol-v1.json");
  let frozen = await read(protocolPath, null);
  if (!frozen) {
    frozen = { frozenAt: asOf, protocol: WEIGHT_PROTOCOL };
    await fs.writeFile(protocolPath, JSON.stringify(frozen, null, 2), {
      flag: "wx",
    });
  }
  if (JSON.stringify(frozen.protocol) !== JSON.stringify(WEIGHT_PROTOCOL))
    throw Error("Frozen feature weight protocol changed");
  const firstPath = path.join(dir, "feature-weight-study-first-result.json");
  let study = await read(firstPath, null);
  if (!study || study.status !== "complete") {
    const result = runWeightStudy(background);
    if (result.status === "complete") {
      if (study) throw Error("Do not replace an existing first weight study");
      await fs.writeFile(firstPath, JSON.stringify(result, null, 2), {
        flag: "wx",
      });
    }
    study = result;
  }
  if (study.status !== "complete") {
    for (const item of items)
      item.displayPrediction = {
        status: "insufficient",
        modelVersion: STRONG_VERSION,
        configuration: "scaled-001",
        pDown: null,
        pUp: null,
        direction: null,
        calibrated: false,
        reason: study.reason,
      };
    return study;
  }
  // The original development/last-segment evaluation stays frozen. New labels
  // refit the selected configuration only; they do not move the split or tune it.
  const fitted = fitWeighted(
      background.samples,
      background.featureDefinitions,
      study.selected,
    ),
    history = attributeHistory(
      background.samples,
      background.featureDefinitions,
    );
  const current = {
    ...study,
    model: fitted,
    effects: study.effects.map((e, j) => ({
      ...e,
      ...history[j],
      weight: fitted.original?.weights[j] ?? fitted.weights[j],
    })),
  };
  const trials = WEIGHT_PROTOCOL.candidates.map((config) => ({
    config,
    model:
      config.id === study.selected.id
        ? fitted
        : fitWeighted(
            background.samples,
            background.featureDefinitions,
            config,
          ),
  }));
  const key = digest({
    version: study.version,
    selected: study.selected,
    samples: background.samples.map((s) => ({
      id: s.recordId,
      target: s.targetDate,
      x: s.x,
      y: s.y,
    })),
  });
  const modelPath = path.join(dir, "feature-weight-models", key + ".json");
  await fs.mkdir(path.dirname(modelPath), { recursive: true });
  const modelValue = {
    version: study.version,
    selected: study.selected,
    inputHash: key,
    model: fitted,
  };
  try {
    await fs.writeFile(modelPath, JSON.stringify(modelValue, null, 2), {
      flag: "wx",
    });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (
      JSON.stringify(await read(modelPath, null)) !== JSON.stringify(modelValue)
    )
      throw Error("Immutable weight-model collision");
  }
  const strong = trials.find((t) => t.config.id === "scaled-001").model;
  for (const item of items) {
    const view = weightItemView(item, current, background);
    if (view) {
      view.trials = trials.map(({ config, model }) => ({
        config,
        pDown: weightedProbability(model, item.backgroundFeatures.values),
        selected: config.id === study.selected.id,
      }));
      view.validationComparison = study.candidates.map((c) => ({
        id: c.config.id,
        l2: c.config.l2,
        n: c.validation.n,
        hits: c.validation.hits,
        brier: c.validation.brier,
        logLoss: c.validation.logLoss,
      }));
      const p = weightedProbability(strong, item.backgroundFeatures.values);
      view.strongImportance = background.featureDefinitions
        .map((f, j) => ({
          ...view.importance.find((e) => e.id === f.id),
          ...f,
          value: item.backgroundFeatures.values[j],
          active:
            item.backgroundFeatures.values[j] !== null &&
            item.backgroundFeatures.values[j] !== 0,
          weight: strong.weights[j],
          deltaDown:
            p -
            weightedProbability(strong, item.backgroundFeatures.values, [j]),
          onDays: history[j].onDays,
          onDownRate: history[j].onDownRate,
          onInterval: history[j].onInterval,
          supported: strong.columns[j].supported,
        }))
        .filter((e) => e.active)
        .sort((a, b) => Math.abs(b.deltaDown) - Math.abs(a.deltaDown));
    }
    item.weightEvidence = view;
  }
  const strongFirsts = await retainStrongFirsts(
    root,
    items,
    strong,
    background,
    asOf,
    prices,
  );
  for (const item of items) {
    const trial = item.weightEvidence?.trials?.find(
      (t) => t.config.id === "scaled-001",
    );
    item.displayPrediction = trial
      ? {
          status: "experimental-current-view",
          modelVersion: STRONG_VERSION,
          configuration: "scaled-001",
          pDown: trial.pDown,
          pUp: 1 - trial.pDown,
          direction: trial.pDown >= 0.5 ? "down" : "up",
          trainN: background.samples.length,
          calibrated: false,
          inTraining: item.currentModelView.inTraining,
          firstEstimate: item.firstStrongEstimate ?? null,
          reason: "固定强增权实验；当前视图与首次判断独立。",
        }
      : {
          status: "excluded",
          modelVersion: STRONG_VERSION,
          configuration: "scaled-001",
          pDown: null,
          pUp: null,
          direction: null,
          calibrated: false,
          reason: item.currentModelView?.reason ?? "场景或证据不适用",
        };
  }
  const artifact = {
    ...study,
    protocolFrozenAt: frozen.frozenAt,
    generatedAt: asOf,
    currentTrainN: background.samples.length,
    currentInputHash: key,
    currentEffects: current.effects,
    publication: "historical-research-only",
    currentModel: fitted,
    strongFirsts,
    displayedConfiguration: "scaled-001",
  };
  await fs.writeFile(
    path.join(root, "outputs/特征权重与相似案例验证.json"),
    JSON.stringify(artifact, null, 2),
  );
  await fs.writeFile(
    path.join(root, "outputs/特征权重与相似案例验证.md"),
    weightMarkdown(artifact),
  );
  return artifact;
}

export function weightMarkdown(s) {
  const v = s.finalEvaluation;
  return `# 大霄译站：特征权重与相似案例验证

已实际训练并比较原模型、标准化模型及较弱正则化模型。先冻结方案，再按时间划分开发/后段评价，概率差大小不作为选模标准。当前选择${s.selected.id}（L2=${s.selected.l2}），${v.passesGate ? "研究门槛满足，仍须前瞻验证" : "增权方案未通过，不替换主模型、不人为放大概率"}。历史及特征早已被查看，后段仍是事后时间模拟，不称全新盲测。

开发${s.split.developmentDays}日，截至${s.split.developmentEnd}；后段${s.split.evaluationDays}日，${s.split.evaluationStart}至${s.split.evaluationEnd}。协议冻结${s.protocolFrozenAt}，版本${s.version}。新标签只按原选定配置重训，不反复改原切分/成绩。

| 开发集候选 | L2 | 跌概率范围 | 方向符合 | Brier损失（低为好） | 对数损失（低为好） |
|---|---:|---|---|---:|---:|
${s.candidates.map((c) => `| ${c.config.id} | ${c.config.l2} | ${pc(c.spread.min)}—${pc(c.spread.max)} | ${c.validation.hits}/${c.validation.n} | ${c.validation.brier.toFixed(6)} | ${c.validation.logLoss.toFixed(6)} |`).join("\n")}

这张候选表只列开发集。只把开发集选出的配置带入后段；不在看过后段后更换候选。后段符合${v.selected.hits}/${v.selected.n}，Brier ${v.selected.brier.toFixed(6)}；历史比例基线${v.selected.baselineBrier.toFixed(6)}、方向符合${pc(v.selected.expandingMajority)}。所有概率尚未校准；不能用更宽的数值冒充更可信。

## 重复出现特征的历史关联与作用

当前${s.currentTrainN}个目标日。出现率/区间仅作描述，日期可能相关，多重比较及市场阶段可能混淆。绿色植物和绿色花盆分开；熊猫不按熊市编码。0是局部采样未确认，不是确认不存在。

| 特征 | 确认目标日 | 其中下跌 | 下跌比例及95%描述区间 | 当前系数 | 开发集遮去特征后的Brier增量 |
|---|---:|---:|---|---:|---:|
${s.currentEffects
  .filter((e) => e.binary && e.onDays)
  .map(
    (e) =>
      `| ${e.name} | ${e.onDays} | ${e.onDowns} | ${pc(e.onDownRate)}（${e.onInterval.map(pc).join("—")}） | ${e.weight.toFixed(6)} | ${e.developmentAblationBrier.toFixed(6)} |`,
  )
  .join("\n")}

系数正值提高跌倾向，负值降低跌倾向。遮去特征是将值置为当折训练均值后重算；正增量表示在这些开发折中有帮助，负值表示遮去后反而改善。它是模型敏感度，不是因果，也不是重新训练删除特征的实验。完全同现的属性共享候选系数；稀少线索在增强候选中暂不加权。

逐条网页“特征权重与相似历史”包含本条属性对估计跌概率的百分点影响、确认次数、最多8个不同目标日的最近相似属性案例，及各增权候选当前试算。相似案例从已完成标签库按属性距离选择；不是人工挑成功案例，其涨跌比例不是预测概率。旧图重看可用之后数据，不计回测成绩。

${s.limitations.map((t) => "- " + t).join("\n")}

方法参考：[概率校准与概率损失](https://scikit-learn.org/stable/modules/calibration.html)、[时间顺序交叉验证](https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split)、[仅在训练数据拟合标准化](https://scikit-learn.org/stable/modules/preprocessing.html#standardization-or-mean-removal-and-variance-scaling)。
`;
}

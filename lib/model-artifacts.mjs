import { typedInterpretation } from "./object-types.mjs";
import { addWeightStudyArtifacts } from "./feature-weight-artifacts.mjs";
import { backgroundStudy as backgroundStudyV3 } from "./background-inference-v3.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildModelStudy,
  itemModelView,
  evaluateSnapshot,
  MODEL_VERSION,
} from "./supervised-model.mjs";
import {
  currentInterpretation,
  FEATURES,
  USER_PRIOR_VERSION,
  PRIOR_ESTABLISHED_AT,
} from "./current-interpretation.mjs";
import { wilson } from "./engine.ts";
import { addBackgroundInference } from "./background-inference.mjs";

const read = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return fallback;
  }
};
async function exclusive(file, value) {
  try {
    await fs.writeFile(file, JSON.stringify(value, null, 2), { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const old = await read(file, null);
    if (JSON.stringify(old) !== JSON.stringify(value))
      throw Error("Immutable model collision: " + file);
  }
}
const pc = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
export async function addModelArtifacts(
  root,
  items,
  prices,
  asOf,
  monthSelection,
) {
  const extra = await read(path.join(root, "work/model-eligibility.json"), {
    items: [],
  });
  const metadata = [...(monthSelection?.items || []), ...extra.items];
  if (new Set(metadata.map((m) => m.id)).size !== metadata.length)
    throw Error("Duplicate model eligibility metadata");
  const study = buildModelStudy(items, prices, asOf, metadata);
  const dir = path.join(root, "work/models");
  await fs.mkdir(dir, { recursive: true });
  if (study.model)
    await exclusive(path.join(dir, study.model.id + ".json"), study.model);
  const storePath = path.join(root, "work/model-predictions.json");
  const store = await read(storePath, { version: 1, predictions: [] });
  let inserted = 0;
  for (const i of items) {
    i.currentInterpretation = currentInterpretation(
      i.observations,
      i.record.market,
      i.record.coverage,
      i.record.semanticCandidates,
    );
    const frozen = store.predictions.find(
      (p) =>
        p.recordId === i.record.id &&
        p.modelVersion === MODEL_VERSION &&
        p.priorVersion === USER_PRIOR_VERSION,
    );
    i.modelView = itemModelView(i, study, metadata, frozen);
    const row = study.videoRows.find((r) => r.recordId === i.record.id);
    // Keep the first estimate separate from immutable visual records. Completed
    // old history uses time-reconstructed views, never a fit using its own label.
    if (
      !frozen &&
      i.modelView.pDown !== null &&
      (row?.ret1 === null ||
        new Date(i.record.createdAt) >= new Date(PRIOR_ESTABLISHED_AT))
    ) {
      const { model, ...view } = i.modelView;
      if (model) await exclusive(path.join(dir, model.id + ".json"), model);
      const snapshot = {
        ...view,
        predictionAt: asOf,
        kind: "first-estimate",
        prospectiveCandidate:
          !i.record.imported &&
          new Date(i.record.createdAt) >= new Date(PRIOR_ESTABLISHED_AT) &&
          new Date(asOf) >= new Date(i.record.createdAt),
        operationalForecast: null,
        note: "实验判断；在真实下一交易日开盘前锁定才进入前瞻实验统计。图片采集或先验晚于目标开盘不能补称盲测。",
      };
      await exclusive(
        path.join(
          dir,
          i.record.id +
            "-" +
            MODEL_VERSION +
            "-" +
            USER_PRIOR_VERSION +
            ".json",
        ),
        snapshot,
      );
      store.predictions.push(snapshot);
      inserted++;
      i.modelView = {
        ...snapshot,
        status: "locked",
        summary:
          "首次模型估计：" +
          (snapshot.direction === "down" ? "偏跌" : "偏涨") +
          "（实验性）",
      };
    }
    if (i.modelView.status === "locked")
      i.modelView.outcome = evaluateSnapshot(i.modelView, prices, asOf);
  }
  if (inserted) {
    const tmp = storePath + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(store, null, 2));
    await fs.rename(tmp, storePath);
  }
  const outcomes = store.predictions
    .filter(
      (s) =>
        s.modelVersion === MODEL_VERSION &&
        s.priorVersion === USER_PRIOR_VERSION,
    )
    .map((s) => evaluateSnapshot(s, prices, asOf));
  const groups = new Map();
  for (const o of outcomes.filter((o) => o.prospective))
    groups.set(o.targetDate, [...(groups.get(o.targetDate) || []), o]);
  let hits = 0,
    n = 0,
    conflicts = 0,
    pending = 0;
  for (const rows of groups.values()) {
    if (rows.every((r) => r.status === "pending")) {
      pending++;
      continue;
    }
    const dirs = new Set(
      rows.map(
        (r) =>
          store.predictions.find(
            (s) =>
              s.recordId === r.recordId &&
              s.modelVersion === MODEL_VERSION &&
              s.priorVersion === USER_PRIOR_VERSION,
          ).direction,
      ),
    );
    if (dirs.size > 1) {
      conflicts++;
      continue;
    }
    const scored = rows.find((r) => r.hit !== null);
    if (scored) {
      n++;
      if (scored.hit) hits++;
    }
  }
  study.firstEstimates = {
    count: outcomes.length,
    outcomes,
    prospective: {
      n,
      hits,
      accuracy: n ? hits / n : null,
      ci: wilson(hits, n),
      conflicts,
      pending,
    },
  };
  await fs.writeFile(
    path.join(root, "outputs/模型训练与验证报告.md"),
    modelMarkdown(study),
  );
  await fs.writeFile(
    path.join(root, "outputs/暗语预测模型.json"),
    JSON.stringify({ generatedAt: asOf, model: study.model }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "outputs/模型训练数据.json"),
    JSON.stringify(study, null, 2),
  );
  const priorStore = await read(
    path.join(root, "work/background-predictions.json"),
    { predictions: [] },
  );
  study.backgroundV3 = backgroundStudyV3(items, study, metadata, prices);
  study.backgroundV3.firstEstimates = priorStore.predictions
    .filter((s) => s.modelVersion === "background-attributes-2026-10-14-v3")
    .map((s) => ({ ...s, outcome: evaluateSnapshot(s, prices, asOf) }));
  await fs.writeFile(
    path.join(root, "outputs/v3背景模型独立保留.json"),
    JSON.stringify(study.backgroundV3, null, 2),
  );
  study.backgroundStudy = await addBackgroundInference(
    root,
    items,
    study,
    metadata,
    prices,
  );
  for (const i of items) {
    i.currentInterpretation = typedInterpretation(
      i.observations,
      i.record.market,
      i.record.coverage,
      i.record.semanticCandidates,
    );
    if (!i.observations.length && !i.shots.length)
      i.currentInterpretation = {
        ...i.currentInterpretation,
        headline: "缺播放画面：暂不解读",
        summary: i.conclusion.body,
        scope: "仅核实链接和页面发布时间；背景未确认",
      };
    i.previousBackgroundEstimates = study.backgroundV3.firstEstimates.filter(
      (s) => s.recordId === i.record.id,
    );
  }
  study.backgroundStudy.previousVersion = {
    version: study.backgroundV3.version,
    validation: study.backgroundV3.validation,
    firstEstimates: study.backgroundV3.firstEstimates,
  };
  study.weightStudy = await addWeightStudyArtifacts(
    root,
    items,
    study.backgroundStudy,
    asOf,
    prices,
  );
  return study;
}

export function modelMarkdown(s) {
  const v = s.validation,
    m = s.model,
    p = s.firstEstimates.prospective;
  return `# 暗语特征监督训练与验证

生成于 ${s.generatedAt}。先验 ${USER_PRIOR_VERSION}，模型 ${MODEL_VERSION}。

已实际训练结构化特征→上证指数下一交易日涨跌的正则化逻辑回归。没有重新训练视觉网络；仍使用真实截图与核实观察。模型概率未校准，不能保证准确或证明作者本意。

## 当前先验

- 纯绿植物 → 偏空／下跌提示候选。绿盆与绿叶分别记录，红绿混色不强算纯绿。
- 熊猫 → 中国资产／A股语境候选；不因“熊”字判跌，不覆盖已核实的海外话题。
- 普通熊玩具 → 熊市／警惕调整候选；地球置顶必须有同帧真实关系。
- 本版是2026-10-14的新解释；旧证据、解码与锁定时间均保留。

## 训练样本

${s.selection}

合格作品 ${s.eligibleWorks} 条，有已完成标签 ${s.labeledWorks} 条；目标日去重后 ${s.samples.length} 个训练日（${m?.downs || 0}跌、${m?.ups || 0}涨），待完成 ${s.pendingWorks} 条。

${s.labelDefinition}

| 目标日 | 代表视频发布时间 | 次日收益 | 标签 | 确认特征 |
|---|---|---:|---|---|
${s.samples
  .map(
    (r) =>
      `| ${r.targetDate} | [${r.publishedAt}](${r.url}) | ${(r.ret1 * 100).toFixed(4)}% | ${r.y ? "跌" : "涨"} | ${
        FEATURES.filter((_, j) => r.x[j])
          .map((f) => f.name)
          .join("、") || "未确认所选特征"
      } |`,
  )
  .join("\n")}

## 时间推进验证

${s.validationMethod}

可验证 ${v.n} 个目标日，符合 ${v.hits} 个（${pc(v.accuracy)}）；Wilson描述区间 ${v.ci ? v.ci.map(pc).join("—") : "—"}。这个极小事后比例不能称可靠预测成功率，日期仍可能相关。始终猜跌 ${pc(v.alwaysDown)}，始终猜涨 ${pc(v.alwaysUp)}，只用过去多数方向 ${pc(v.expandingMajority)}。

Brier损失：模型 ${v.brier?.toFixed(6) ?? "—"}，过去涨跌比例基线 ${v.baselineBrier?.toFixed(6) ?? "—"}；对数损失：模型 ${v.logLoss?.toFixed(6) ?? "—"}、基线 ${v.baselineLogLoss?.toFixed(6) ?? "—"}。均越低越好，微小差异不能证明泛化优势。

| 模拟判断时点 | 目标日 | 可用训练日 | 估计跌概率（未校准） | 方向 | 实际收益 | 符合 |
|---|---|---:|---:|---|---:|---|
${s.folds
  .filter((f) => f.status !== "warmup")
  .map(
    (f) =>
      `| [${f.predictionAt}](${f.url}) | ${f.targetDate} | ${f.trainN} | ${pc(f.pDown)} | ${f.direction === "down" ? "跌" : "涨"} | ${(f.ret1 * 100).toFixed(4)}% | ${f.hit ? "是" : "否"} |`,
  )
  .join("\n")}

前瞻实验已完成 ${p.n} 个目标日，${p.n ? `符合 ${p.hits} 个` : "尚无可评分结果"}。首次判断独立保存；本次对10月13日视频的估计晚于10月14日开盘，不算开盘前预测。

## 参数与限制

固定L2=1、阈值0.5、至少4个过去已完成训练日，无参数搜索。系数正值提高估计跌概率、负值降低；不为符合用户先验强制符号。截距主要反映过去涨跌比例。

${s.collinearPairs.length ? "无法单独归因的同现特征：" + s.collinearPairs.map((p) => p.join(" 与 ")).join("；") + "。" : "尚无完全同现的非恒定特征对。"}

| 特征 | 代表日期中确认次数 | 系数 | 状态 |
|---|---:|---:|---|
${m?.features.map((f) => `| ${f.name} | ${f.confirmedDays} | ${f.weight.toFixed(6)} | ${f.reason} |`).join("\n") || ""}

${s.limitations.map((x) => "- " + x).join("\n")}

${s.references.map((r) => `方法参考：[${r.title}](${r.url})。`).join("\n\n")}

收盘标签来自本机保存的腾讯上证指数行情，最新完成标签 ${m?.lastLabelAvailableAt || "无"}。完整样本与逐折切分见模型训练数据.json，参数见暗语预测模型.json。
`;
}

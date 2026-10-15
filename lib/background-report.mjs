import {
  weightEvidenceCard,
  weightStudyPanel,
  weightStyles,
  probabilityComparison,
} from "./feature-weight-report.mjs";
const h = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pc = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
const at = (v) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "待定位";
export function backgroundCard(item) {
  const m = item.currentModelView;
  if (!m) return "";
  const f = item.backgroundFeatures;
  if (m.pDown === null)
    return `<div class="model-card"><b>当前背景模型：暂不适用</b><p>${h(m.reason)}</p><p class="caption">需要已完成的训练标签和核实后的可比场景，条件满足后才输出概率。</p></div>`;
  const trial = item.weightEvidence?.trials?.find(
    (t) => t.config.id === "scaled-001",
  );
  const first = item.firstStrongEstimate;
  return `<div class="model-card current-background compact-probability"><div class="market-heading"><b>上证下一交易日 · ${!trial ? "实验数据不足" : Math.abs(trial.pDown - 0.5) < 0.05 ? "接近均衡／信号弱" : trial.pDown >= 0.5 ? "实验偏跌" : "实验偏涨"}</b><span class="tag uncertain">当前模型看图 / 未校准</span></div>${probabilityComparison(item)}<p class="caption">${m.trainN}个训练日 · 强增权实验 · 未校准</p><details class="probability-method"><summary>强增权依据与首次判断</summary><p class="caption">模型更新 ${h(at(m.predictionAt))}</p><p class="caption">${h(m.reason)} ${m.inTraining ? "本条是训练代表样本，当前概率仅供复盘，不能当预测成绩。" : "旧视频用当前模型重新看图，不代表当时已作出的预测。"}</p>${m.neverSeen.length ? `<p class="model-conflict">识别到了但模型尚未学到：${h(m.neverSeen.join("、"))}。这些特征系数为0，概率由其他已学特征与历史基线产生。</p>` : ""}${m.baselineOnly ? '<p class="model-conflict">本条缺少已学到关联的特征；数字主要来自训练期涨跌比例，识别作用有限。</p>' : ""}${first ? `<div class="first-estimate"><b>已另存首次强增权实验判断</b><p><span class="prob-up">涨 ${pc(first.pUp)}</span> / <span class="prob-down">跌 ${pc(first.pDown)}</span> · ${h(at(first.predictionAt))}</p><p class="caption">${first.outcome.status === "ready" ? `目标 ${h(first.outcome.targetDate)}，实际收益 ${(first.outcome.ret1 * 100).toFixed(2)}%；${first.outcome.prospective ? "属于开盘前实验" : "不计前瞻成绩"}` : "等待真实下一交易日收盘；后续当前模型变化不覆盖这个判断。"}</p></div>` : ""}<details class="feature-details"><summary>识别了什么？哪些进入模型？ <span>${f.fields.length}维特征</span></summary><p class="caption">颜色、名称、位置、数量、朝向及关系来自真实截图核实；只有存在训练对照的属性才估计系数。视觉识别未用涨跌标签重新训练。</p><div class="table-wrap"><table class="history-table"><thead><tr><th>属性</th><th>本条识别值</th><th>证据对象</th></tr></thead><tbody>${f.fields.map((field) => `<tr><td>${h(field.name)}</td><td>${field.value === null ? "缺数据" : Number(field.value).toFixed(field.value === 0 || field.value === 1 ? 0 : 3)}</td><td>${h(field.evidenceIds.map((id) => f.observedObjects.find((o) => o.id === id)?.name || id).join("、") || "本次未确认")}</td></tr>`).join("")}</tbody></table></div><p class="caption">${h(f.missing)}</p></details></details>${weightEvidenceCard(item)}</div>`;
}
export function backgroundPanel(data) {
  const s = data.modelStudy?.backgroundStudy;
  if (!s) return "";
  const v = s.validation;
  return `<section class="model-panel" id="background-probability"><div class="market-heading"><h3>${s.model ? "背景特征模型：已训练，仍在检验" : "背景特征模型：等待训练数据"}</h3><span class="tag uncertain">${h(s.version)}</span></div><div class="pipeline"><span>可见视频截图</span><b>→</b><span>视觉识别与核实</span><b>→</b><span>24维物件属性</span><b>→</b><span>已训练的涨跌模型</span></div><p>主卡仅显示强增权实验（固定L2=0.01）。本节原模型历史统计作为研究档案，不代表当前强增权实验的验证成绩。历史“预热不足4日”只影响当时的回测，不会挡住已训练模型现在解读旧图。正文谈港股或全球也可检测相同日常道具，预测目标独立设为上证。</p><div class="model-stats"><div><strong>${s.coverage.available} / ${s.coverage.total}</strong><small>可比背景已有概率</small></div><div><strong>${s.samples.length}</strong><small>不同目标日训练样本</small></div><div><strong>${s.model?.active.filter(Boolean).length || 0} / 24</strong><small>有训练对照变化的属性</small></div><div><strong>${v.hits} / ${v.n}</strong><small>严格时间验证符合数</small></div></div><p class="notice">${s.model ? "当前模型基于" + s.samples.length + "个训练日。" : "尚无已完成的训练标签，暂不输出概率。"}严格时间验证 ${v.hits}/${v.n}，始终猜涨 ${pc(v.alwaysUp)}；${v.accuracy > v.alwaysUp ? "本次历史符合比例高于始终猜涨，但尚无独立前瞻证据证明优势。" : "本次历史符合比例未高于始终猜涨。"}概率未经校准、未证明准确；当前看旧图的概率可能使用了该视频之后的数据，不能计历史命中。新视频首次实验判断另存，后续用真实结果验证。</p><details><summary>v4类别映射修正与旧版对照</summary><p>v4修正具体名称未命中别名时，已核实地球仪、熊猫等类别被漏编码的问题。原名称与证据不改写；没有依据涨跌补标或调参。旧v3保留独立成绩和首次判断，不与本版混算。</p>${data.modelStudy.backgroundV3 ? `<p>同一批数据：旧v3 ${data.modelStudy.backgroundV3.validation.hits}/${data.modelStudy.backgroundV3.validation.n}，本版v4 ${v.hits}/${v.n}；两版均须与基线比较，不以升级宣称准确。旧v3首次判断 ${data.modelStudy.backgroundV3.firstEstimates.length} 条仍独立验证。</p>` : ""}</details><details><summary>识别模型与预测模型如何衔接？</summary><p>${h(s.pipeline)}</p><p>当前截图识别由本聊天视觉能力完成，物件、颜色、名称、数量、位置、朝向、动作、同帧关系都保存。训练标签用于后面的涨跌分类器；涨跌标签没有用于重训一个新的图像识别网络。</p><p>${h(s.trainingPolicy)}</p><p>有变化并不代表可靠贡献；未出现、缺少数量、位置不变等属性系数为0。新杯具等线索可以识别、保存，但还没有足够历史结果学它的含义。</p><div class="table-wrap"><table class="history-table"><thead><tr><th>属性</th><th>系数</th><th>训练情况</th></tr></thead><tbody>${s.model?.features.map((f) => `<tr><td>${h(f.name)}</td><td>${f.weight.toFixed(5)}</td><td>${h(f.reason)}</td></tr>`).join("") || ""}</tbody></table></div><div class="table-wrap"><table class="history-table"><thead><tr><th>历史模拟时点</th><th>目标日</th><th>可用训练日 / 最新标签</th><th>估计跌概率</th><th>实际收益 / 符合</th></tr></thead><tbody>${s.folds
    .filter((f) => f.status !== "warmup")
    .map(
      (f) =>
        `<tr><td><a href="${h(f.url)}" target="_blank" rel="noreferrer">${h(at(f.predictionAt))}</a></td><td>${h(f.targetDate)}</td><td>${f.trainN}<small>${h(at(f.lastTrainingLabelAt))}</small></td><td class="prob-down">${pc(f.pDown)}<small>${f.modelKind === "single-class-intercept-only" ? "单类截距回退" : "特征模型"}</small></td><td>${(f.ret1 * 100).toFixed(4)}%<small>${f.hit ? "符合" : "不符合"}</small></td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><p>同一时间验证 ${v.hits}/${v.n}，始终猜跌 ${pc(v.alwaysDown)}、始终猜涨 ${pc(v.alwaysUp)}；仍是小样本事后模拟，不能当作可靠准确率。</p></details>${weightStudyPanel(data)}</section>`;
}
export const backgroundStyles =
  weightStyles +
  `.pipeline{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:17px 0}.pipeline span{border:1px solid #d6e3d6;background:#f0f5ee;padding:7px 12px;border-radius:8px;font-size:12px}.pipeline b{color:var(--muted)}.current-background{border-color:#9ab9a2;background:#f5f9ef}.current-background .probability-bar{background:#27865b}.current-background .probability-bar i{background:var(--red)}.first-estimate{background:white;border-radius:7px;border:1px solid #d8e3d4;padding:10px;margin-top:12px}.feature-details{margin-top:12px}.feature-details .history-table td:first-child{min-width:150px}.historical-model{margin-top:8px;font-size:12px}.historical-model>summary{font-size:12px;padding:9px 0}.historical-model .model-card{background:#f3f4f1;font-size:12px}.historical-model .probability b{font-size:17px}`;

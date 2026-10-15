const h = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pc = (v) =>
  v === null || v === undefined ? "—" : (v * 100).toFixed(1) + "%";
const signed = (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "个百分点";
const label = (c) => (c.id === "original" ? "原模型" : `标准化 · L2=${c.l2}`);
export function probabilityComparison(item) {
  const main = item.currentModelView,
    w = item.weightEvidence,
    trial = w?.trials?.find((t) => t.config.id === "scaled-001");
  if (!main || main.pDown === null) return "";
  if (!trial)
    return '<p class="caption">强增权实验数据不足，暂不输出概率。</p>';
  const experiment = w.validationComparison?.find(
      (c) => c.id === trial.config.id,
    ),
    pDown = trial.pDown;
  return `<div class="probability-comparison strong-only"><div class="probability-option weighted-trial"><div class="probability-option-heading"><b>强增权实验 · L2=0.01</b><span>实验输出／未校准</span></div><div class="probability"><span class="prob-up">上涨估计 <b>${pc(1 - pDown)}</b></span><span class="prob-down">下跌估计 <b>${pc(pDown)}</b></span></div><div class="probability-bar" role="img" aria-label="强增权实验，未校准的上涨估计${pc(1 - pDown)}，下跌估计${pc(pDown)}；红涨绿跌"><i style="width:${(1 - pDown) * 100}%"></i></div><p class="caption">${experiment ? `开发段Brier ${experiment.brier.toFixed(3)} · 越低越好` : "未通过独立验证"}</p></div></div><p class="probability-comparison-note">${Math.abs(pDown - 0.5) < 0.05 ? "本条即使增权也接近均衡，未获得明显区分。" : "增权试算数值分开，尚未证明更有效。"}历史首次判断独立存档。${main.inTraining ? "本条属于训练样本，当前重看不能当作历史预测成绩。" : ""}</p>`;
}
export function weightEvidenceCard(item) {
  const w = item.weightEvidence;
  if (!w) return "";
  return `<details class="weight-evidence"><summary>特征权重与相似历史 <span>按交易日去重</span></summary><p class="caption">${h(w.note)} 当前显示固定L2=0.01强增权实验。绿色/红色是物件属性，统计不能证明作者本意。</p><div class="table-wrap"><table class="history-table"><thead><tr><th>本条特征</th><th>对估计跌概率影响</th><th>确认日期 / 其中下跌</th></tr></thead><tbody>${(
    w.strongImportance || w.importance
  )
    .slice(0, 8)
    .map(
      (e) =>
        `<tr><td>${h(e.name)}</td><td>${signed(e.deltaDown)}<small>移至训练均值前后之差，非因果</small></td><td>${e.onDays ? `${e.onDays}日 · ${pc(e.onDownRate)}` : "连续属性／见总表"}<small>${e.onInterval ? "描述区间 " + e.onInterval.map(pc).join("—") : ""}${!e.supported ? " · 样本/对照不足" : ""}</small></td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><p class="caption">这些特征相互相关，影响不能简单相加。0是本次未确认，不是确认不存在。</p><h4>相似属性案例</h4><p class="caption">固定取属性距离最近的${w.neighborN}个不同目标日：${w.neighborDowns}跌、${w.neighborN - w.neighborDowns}涨。这是案例分布，不是预测概率；旧图重看可使用之后的标签。</p><div class="table-wrap"><table class="history-table"><thead><tr><th>视频发布日期</th><th>共同已确认特征</th><th>目标日 / 上证收益</th></tr></thead><tbody>${w.neighbors.map((n) => `<tr><td><a href="${h(n.url)}" target="_blank" rel="noreferrer">${h(n.publishedAt.slice(0, 16).replace("T", " "))}</a><small>属性距离 ${n.distance.toFixed(3)}</small></td><td>${h(n.common.join("、") || "位置等其他属性接近")}</td><td>${h(n.targetDate)}<small class="${n.ret1 >= 0 ? "prob-up" : "prob-down"}">${n.ret1 >= 0 ? "+" : ""}${(n.ret1 * 100).toFixed(2)}%</small></td></tr>`).join("")}</tbody></table></div></details>`;
}
export function weightStudyPanel(data) {
  const s = data.modelStudy?.weightStudy;
  if (!s) return "";
  if (s.status !== "complete")
    return `<details class="weight-study"><summary>特征增权检验</summary><p>开发/后段时间样本不足，暂不运行增权比较。</p></details>`;
  const v = s.finalEvaluation;
  return `<details class="weight-study" id="weight-study"><summary>特征增权检验：${s.selected.id === "original" ? "更强权重未通过，保留原模型" : "独立研究候选"} <span>${s.n}个去重目标日</span></summary><p>先冻结4种配置，用前${s.split.developmentDays}日开发集选择；最后${s.split.evaluationDays}日只评价选定配置。${h(s.split.developmentEnd)}以前用于开发，${h(s.split.evaluationStart)}—${h(s.split.evaluationEnd)}为后段。该历史及特征定义已被查看，仍是事后模拟，不是全新盲测。</p><div class="table-wrap"><table class="history-table"><thead><tr><th>开发集方案</th><th>跌概率范围</th><th>方向符合</th><th>Brier（越低越好）</th><th>对数损失</th></tr></thead><tbody>${s.candidates.map((c) => `<tr><td>${h(label(c.config))}</td><td>${pc(c.spread.min)}—${pc(c.spread.max)}</td><td>${c.validation.hits}/${c.validation.n}</td><td>${c.validation.brier.toFixed(4)}</td><td>${c.validation.logLoss.toFixed(4)}</td></tr>`).join("")}</tbody></table></div><p class="notice">${s.selected.id === "original" ? "较强权重把概率拉开，也增大了概率误差；因此保留原模型。" : "选定配置仅供研究，未自动替换原模型。"}后段选定方案符合${v.selected.hits}/${v.selected.n}，Brier ${v.selected.brier.toFixed(4)}，历史比例基线${v.selected.baselineBrier.toFixed(4)}。靠近50%应读为缺少明显方向，而非强行判涨跌。</p><h4>重复线索的真实样本支持</h4><div class="table-wrap"><table class="history-table"><thead><tr><th>特征</th><th>确认目标日</th><th>次日下跌 / 描述区间</th><th>开发集遮去后Brier变化</th></tr></thead><tbody>${s.currentEffects
    .filter((e) => e.binary && e.onDays)
    .map(
      (e) =>
        `<tr><td>${h(e.name)}</td><td>${e.onDays}</td><td>${e.onDowns}/${e.onDays} · ${pc(e.onDownRate)}<small>${e.onInterval.map(pc).join("—")}，非独立因果区间</small></td><td>${e.developmentAblationBrier >= 0 ? "+" : ""}${e.developmentAblationBrier.toFixed(5)}<small>正：这些开发折中有帮助；负：遮去反而更好</small></td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><p class="caption">同一天只取一条代表。标准化、支持门槛、同现分组和权重仅由当折训练数据拟合；后段不用于挑配置。相似案例和本条影响在各视频概率卡下方展开。历史定义、样本相关性和未校准限制仍在，首次判断不覆盖。</p></details>`;
}
export const weightStyles =
  ".weight-evidence{margin-top:12px;border-top:1px solid #d8e3d4}.weight-evidence>summary,.weight-study>summary{font-weight:650}.weight-evidence summary span,.weight-study summary span{float:right;color:var(--muted);font-size:11px;font-weight:400}.weight-evidence h4{margin:16px 0 6px}.weight-evidence .history-table td{font-size:12px}.weight-study{margin:16px 0}.probability-comparison{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}.probability-option{background:#fff;border:1px solid #d5dfd2;border-radius:9px;padding:12px;min-width:0}.probability-option-heading{display:flex;flex-direction:column;gap:4px;font-size:13px}.probability-option-heading span{font-size:10px;color:var(--muted)}.probability-option .probability{gap:12px;justify-content:space-between}.probability-option .probability span{font-size:11px}.probability-option .probability b{font-size:23px}.weighted-trial{border-style:dashed;border-color:#beae83;background:#fffdf6}.probability-comparison-note{font-size:11px;line-height:1.6;color:var(--muted);margin:9px 0}.probability-option .caption{font-size:10px;margin:8px 0 0}@media(max-width:760px){.probability-comparison{grid-template-columns:1fr}}";

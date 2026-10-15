import { backgroundCard } from "./background-report.mjs";
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
    : "未登记";
export function interpretationSummary(item) {
  const s = item.currentInterpretation,
    c = item.conclusion;
  if (!s) return `<h3>${h(c.title)}</h3><p>${h(c.body)}</p>`;
  return `<h3>${h(s.headline)}</h3><p class="caption">${h(s.scope)} · 作者本意待确认</p>`;
}
function legacyModelCard(item) {
  const m = item.modelView;
  if (!m) return "";
  const s = item.currentInterpretation;
  if (m.pDown === null)
    return `<div class="model-card"><b>${h(m.summary)}</b><p class="caption">暗语倾向可以保留；模型适用范围与可用训练数据单独核实。</p></div>`;
  const conflict =
    (s.bias === "bearish" && m.direction === "up") ||
    (s.bias === "bullish" && m.direction === "down");
  const kind =
    m.status === "retrospective-simulation"
      ? "历史时间模拟（非盲测）"
      : m.outcome?.prospective
        ? "开盘前锁定的前瞻实验"
        : "首次估计（不能算开盘前盲测）";
  return `<div class="model-card"><div class="market-heading"><b>次日模型：${m.direction === "down" ? "偏跌" : "偏涨"}</b><span class="tag uncertain">实验 / 低可信度</span></div><div class="probability"><span class="prob-down">估计跌概率 <b>${pc(m.pDown)}</b></span><span class="prob-up">估计涨概率 <b>${pc(1 - m.pDown)}</b></span></div><div class="probability-bar" role="img" aria-label="未经校准的估计上涨概率${pc(1 - m.pDown)}，下跌概率${pc(m.pDown)}；红涨绿跌"><i style="width:${m.pDown * 100}%"></i></div><p class="caption">${h(kind)} · ${m.trainN}个训练日 · 概率未校准</p><p class="caption">判断时点 ${h(at(m.predictionAt))}；只用此前已完成标签（最新 ${h(at(m.lastTrainingLabelAt))}）。训练期多数涨跌可能主导结果。</p>${conflict ? '<p class="model-conflict">模型方向与暗语先验冲突：分别保留两种结果，当前不形成可靠预测。</p>' : ""}<p class="caption">${m.outcome?.status === "ready" ? "首次估计之后实际收益 " + (m.outcome.ret1 * 100).toFixed(2) + "%；" + (m.outcome.prospective ? "前瞻实验结果" : "晚于开盘／历史估计，不计前瞻准确率") : "待下一交易日已完成收盘验证"}。没有把物件本身的未明确时间暗语改写成作者的“明日预测”。</p></div>`;
}
export function modelCard(item) {
  return item.currentModelView
    ? backgroundCard(item) +
        '<details class="historical-model"><summary>当时的历史验证／旧版首次判断（独立留存）</summary>' +
        legacyModelCard(item) +
        "</details>"
    : legacyModelCard(item);
}
export function modelPanel(data) {
  const s = data.modelStudy;
  if (!s) return "";
  const m = s.model,
    v = s.validation,
    p = s.firstEstimates?.prospective;
  return `<section class="model-panel" id="model-study"><div class="market-heading"><h3>原v1：严格A股9维研究（独立留存）</h3><span class="tag uncertain">${h(s.version)}</span></div><p>输入是已核实截图里的物件、颜色和同帧组合，输出是上证指数下一交易日涨跌的实验估计。熊猫作为中国资产／A股语境候选，普通熊与纯绿植物作为偏空先验；模型系数由历史标签拟合。</p><div class="model-stats"><div><strong>${s.eligibleWorks}</strong><small>合格视频 · ${s.labeledWorks}条有标签</small></div><div><strong>${s.samples.length}</strong><small>目标日去重后训练日</small></div><div><strong>${v.hits} / ${v.n}</strong><small>时间推进验证符合数</small></div><div><strong>${p?.n || 0}</strong><small>已完成前瞻实验目标日</small></div></div><p class="notice">${h(s.conclusion)} 当前验证符合比例 ${pc(v.accuracy)}，始终猜跌 ${pc(v.alwaysDown)}、始终猜涨 ${pc(v.alwaysUp)}。${v.ci ? "Wilson描述区间 " + v.ci.map(pc).join("—") + "，区间极宽，日期仍可能相关。" : ""}</p><p class="caption">最终拟合标签 ${m?.downs || 0}跌 / ${m?.ups || 0}涨，截距会体现这段市场的涨跌比例。训练的是特征预测模型；没有重新训练图像识别网络。历史补录，不能算事前命中。</p><details><summary>查看时间切分、样本与特征权重 <span>可逐项审查</span></summary><p>${h(s.validationMethod)}</p><p>${h(s.selection)}</p><p class="caption">${h(s.labelDefinition)}</p><div class="table-wrap"><table class="history-table"><thead><tr><th>模拟判断时点</th><th>目标日</th><th>训练日数 / 最新标签</th><th>跌概率（未校准）</th><th>实际收益 / 符合</th></tr></thead><tbody>${
    s.folds
      .filter((f) => f.status !== "warmup")
      .map(
        (f) =>
          `<tr><td><a href="${h(f.url)}" target="_blank" rel="noreferrer">${h(at(f.predictionAt))}</a></td><td>${h(f.targetDate)}</td><td>${f.trainN}<small>${h(at(f.lastTrainingLabelAt))}</small></td><td class="prob-down">${pc(f.pDown)}<small>${f.direction === "down" ? "偏跌" : "偏涨"}</small></td><td>${(f.ret1 * 100).toFixed(4)}%<small>${f.hit ? "符合" : "不符合"}</small></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="5">尚无达到最少训练日数的时间验证折。</td></tr>'
  }</tbody></table></div><p class="caption">Brier损失（越低越好）：模型 ${v.brier?.toFixed(6) ?? "—"}，只用过去涨跌比例 ${v.baselineBrier?.toFixed(6) ?? "—"}。验证数据没有用于参数搜索；这点差异不能证明优势。</p><div class="table-wrap"><table class="history-table"><thead><tr><th>模型特征</th><th>代表日期中确认次数</th><th>系数（对估计跌概率）</th><th>说明</th></tr></thead><tbody>${m?.features.map((f) => `<tr><td>${h(f.name)}</td><td>${f.confirmedDays} / ${m.n}</td><td>${f.weight.toFixed(4)}</td><td>${h(f.reason)}</td></tr>`).join("") || ""}</tbody></table></div><p class="caption">正系数提高估计跌概率，负系数降低。系数表示训练期关联，不是对暗语含义的确认；不强制符号迎合先验。${s.collinearPairs.length ? "完全同现，无法分别归因：" + h(s.collinearPairs.map((p) => p.join(" 与 ")).join("；")) + "。" : ""}</p><p>${h(s.limitations.join(" "))}</p><p class="caption">方法参考：${s.references.map((r) => `<a href="${h(r.url)}" target="_blank" rel="noreferrer">${h(r.title)}</a>`).join(" · ")}。</p></details></section>`;
}
export const modelStyles = `.model-panel{margin:24px 0;padding:23px;border:1px solid #c6d6cd;border-radius:13px;background:#fff}.model-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}.model-stats>div{padding:13px;background:#f1f5ed;border-radius:8px}.model-stats strong{display:block;font-size:25px}.model-stats small{font-size:11px;color:var(--muted)}.model-card{padding:15px;margin:17px 0 8px;border:1px solid #d8e3d7;border-radius:10px;background:#f7f9f2;font-size:13px}.model-card .probability{display:flex;gap:18px;margin:12px 0 8px;flex-wrap:wrap}.probability b{font-size:21px;display:block}.prob-up{color:var(--red)}.prob-down{color:#27865b}.probability-bar{height:8px;border-radius:10px;background:var(--red);overflow:hidden;print-color-adjust:exact}.probability-bar i{display:block;height:100%;background:#27865b}.model-conflict{color:#91622a;border-left:2px solid #bc975a;padding-left:8px}@media(max-width:650px){.model-stats{grid-template-columns:repeat(2,1fr)}.model-panel>.market-heading{display:block}.model-panel>.market-heading .tag{display:inline-block;margin:4px 0}}`;

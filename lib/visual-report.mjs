import { backgroundPanel, backgroundStyles } from "./background-report.mjs";
// One renderer serves the hosted snapshot and the self-contained local report.
import {
  interpretationSummary,
  modelCard,
  modelPanel,
  modelStyles,
} from "./model-report.mjs";
export const escapeHTML = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const h = escapeHTML;
export function safeExternalURL(value) {
  try {
    const u = new URL(String(value));
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "#";
  } catch {
    return "#";
  }
}
const pct = (v) =>
  v == null ? "待验证" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
const number = (v) => (v == null ? "—" : Number(v).toFixed(2));
const clock = (t) => {
  if (t == null) return "时点未登记";
  const n = Math.round(t);
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};
const collected = (s) => (s?.collectionKind === "initial" ? "采集" : "补采");
const date = (v) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "未登记";
const tone = (v) =>
  v == null ? "waiting" : v > 0 ? "up" : v < 0 ? "down" : "flat";
function crop(shot, rect, title) {
  if (!shot) return '<div class="missing">暂未留存对应截图</div>';
  const [x, y, w, hh] = rect || [160, 72, 802, 463],
    iw = shot.width || 1280,
    ih = shot.height || 720;
  return `<button class="photo" style="--crop-ratio:${w / hh};aspect-ratio:${w}/${hh};background-image:var(--${h(shot.key)});background-size:${(iw / w) * 100}% ${(ih / hh) * 100}%;background-position:${iw === w ? 50 : (x / (iw - w)) * 100}% ${ih === hh ? 50 : (y / (ih - hh)) * 100}%" data-shot="${h(shot.key)}" data-caption="${h(title)} · ${clock(shot.time)}" aria-label="放大查看${h(title)}的原始截图"><span>${clock(shot.time)} ↗ 原画面</span></button>`;
}
function chain(m) {
  return `<div class="chain"><b>${h(m.cue)}</b><span>↓ ${h(m.mechanism)}</span><strong>${h(m.meaning)}</strong><small>${h(m.meaningConfidence || m.status || "工具推断 / 低支持")}${m.source?.url ? ` · <a href="${h(safeExternalURL(m.source.url))}" target="_blank" rel="noreferrer">${h(m.source.title)}</a>` : ""}</small>${m.alternatives?.length ? `<p>其他解释：${h(m.alternatives.join("；"))}</p>` : ""}</div>`;
}
function chart(rows) {
  if (rows.length < 2)
    return '<div class="chart-empty">后续收盘尚未完成，图表等待真实数据。</div>';
  const vals = rows.map((r) => r.close),
    lo = Math.min(...vals),
    hi = Math.max(...vals),
    range = hi - lo || 1;
  const points = rows
    .map(
      (r, i) =>
        `${40 + (i / (rows.length - 1)) * 570},${125 - ((r.close - lo) / range) * 90}`,
    )
    .join(" ");
  return `<svg class="price-chart" viewBox="0 0 660 170" role="img" aria-label="${h(rows.map((r) => r.date + "收盘" + r.close).join("，"))}"><line x1="40" y1="125" x2="610" y2="125" stroke="#dce4de"/><polyline points="${points}" fill="none" stroke="#28624d" stroke-width="2.6"/>${rows
    .map((r, i) => {
      const x = 40 + (i / (rows.length - 1)) * 570,
        y = 125 - ((r.close - lo) / range) * 90;
      return `<circle cx="${x}" cy="${y}" r="4" fill="#28624d"/><text x="${x}" y="${y - 11}" text-anchor="middle">${r.close.toFixed(2)}</text><text x="${x}" y="151" text-anchor="middle">${r.date.slice(5)}</text>`;
    })
    .join("")}</svg>`;
}
function windowCard(w) {
  return `<div class="window"><span>${h(w.label)}</span><strong class="${tone(w.ret)}">${pct(w.ret)}</strong><small>${h(w.date || "等待对应交易日行情")}</small><small>${w.close != null ? "收盘 " + number(w.close) + " 点" : "收盘未完成 / 数据未取得"}</small></div>`;
}
function recordCard(item, i, defaultDay) {
  const {
    record: r,
    evaluation: e,
    shots,
    observations,
    decoding: lockedDecoding,
    conclusion,
    chartRows,
    windows,
  } = item;
  const decoding = item.currentInterpretation || lockedDecoding;
  const main = shots.find((s) => s.key === conclusion.mainShotKey) || shots[0],
    isReview = !!item.currentInterpretation || !!item.reviewedAt;
  const evidence = observations
    .map((o, j) => {
      const mapping = item.attachments.find(
          (a) => a.observationId === o.id || a.observationIndex === j,
        ),
        s = shots.find((s) => s.key === mapping?.shotKey);
      const matches = [
        ...(decoding?.matches || []),
        ...(decoding?.candidates || []),
      ].filter((m) => m.evidenceIds?.includes(o.id));
      return `<div class="evidence">${crop(s, mapping?.crop, o.name || o.description.slice(0, 14))}<div><div class="evidence-label"><b>${h(o.name || item.labelNames[o.label] || "物件")}</b><span class="tag ${o.verified ? "" : "uncertain"}">${o.verified ? "已辨认" : "未确认"}</span></div><p>${h(o.description)}</p><small>视觉辨认：${o.confidence >= 0.85 ? "较高" : o.confidence >= 0.65 ? "中等" : "较低"} · ${o.position ? h(o.position) + " · " : ""}${s ? "截图 " + clock(s.time) + "（" + collected(s) + "）" : "暂无对应截图"}</small>${o.visibleText?.length ? `<blockquote>${h(o.visibleText.join(" / "))}</blockquote>` : ""}${matches.length ? `<div class="evidence-cue">解码线索：${h(matches.map((m) => m.mechanism).join("；"))}</div>` : ""}${mapping?.note ? `<small class="correction">补采说明：${h(mapping.note)}</small>` : ""}</div></div>`;
    })
    .join("");
  const keyEvidence = observations
    .filter((o) => o.verified && !["text", "scene"].includes(o.kind))
    .sort((a, b) => {
      const priority = [
        "cherry",
        "peach",
        "pear",
        "hat",
        "turtle",
        "bull",
        "horse",
        "foam",
        "globe",
        "green_plant",
        "red_plant",
        "bear",
        "panda",
      ];
      const rank = (o) => {
        const i = priority.indexOf(o.label);
        return i < 0 ? 20 : i;
      };
      return rank(a) - rank(b);
    })
    .slice(0, 3);
  const highlights = keyEvidence
    .map((o) => {
      const a = item.attachments.find((a) => a.observationId === o.id),
        s = shots.find((s) => s.key === a?.shotKey);
      const cue = (decoding?.matches || []).find((m) =>
        m.evidenceIds?.includes(o.id),
      );
      return (
        '<div class="key-evidence">' +
        crop(s, a?.crop, o.name) +
        "<b>" +
        h(o.name) +
        "</b><small>" +
        h(cue?.mechanism || "可见物件，寓意待核实") +
        "</small></div>"
      );
    })
    .join("");
  const sd = e.sameDay;
  return `<article class="video-card" id="${h(r.id)}" data-date="${h(e.timing.date)}" ${defaultDay && e.timing.date !== defaultDay ? "hidden" : ""} data-session="${e.timing.session}" data-search="${h(r.title + " " + observations.map((o) => (o.name || "") + " " + o.description).join(" "))}"><div class="video-heading"><span class="ordinal">${String(i + 1).padStart(2, "0")}</span><div><div class="eyebrow">${h(date(r.publishedAt))} 北京时间 · ${e.timing.beforeClose ? "15:00前发布" : "15:00及之后发布"}</div><h2>${h(r.title)}</h2>${r.sourceType !== "original" ? '<span class="tag uncertain">发布者未核实为本人原发</span>' : ""}</div><a class="original" href="${h(safeExternalURL(r.url))}" target="_blank" rel="noreferrer">原视频 ↗</a></div><div class="overview"><div>${crop(main, [160, 72, 802, 463], r.title)}<p class="caption">${main ? "真实播放画面 · 局部采样 · " + collected(main) + " " + h(date(main.capturedAt)) : "未取得真实播放画面；仅存原链接/页面元数据"}</p>${highlights ? `<div class="key-evidence-grid">${highlights}</div>` : ""}</div><div class="conclusion"><div class="eyebrow">本条视频总结论</div>${interpretationSummary(item)}${modelCard(item)}<div class="confidence"><span>视觉：已列证据</span><span>语义：待确认</span><span>预测：实验</span></div><p class="change"><b>变化</b> ${h(conclusion.change.split("。")[0])}。</p><details class="interpretation-more"><summary>完整解读与替代解释</summary><p>${h(item.currentInterpretation?.summary || conclusion.body)}</p><p>${h(conclusion.body)}</p><p class="caption">视觉：${h(conclusion.visual)}；寓意：${h(conclusion.semantic)}；预测：${h(conclusion.effect)}。</p><p class="caption">${h(conclusion.change)}</p></details></div></div><details class="evidence-details"><summary>可见证据与物品截图 <span>${observations.length} 项 · 点击展开</span></summary><div class="evidence-grid">${evidence}</div><div class="decoding-heading">寓意候选与解码链 ${isReview ? '<span class="tag uncertain">新版事后复盘</span>' : '<span class="tag">锁定解码</span>'}</div><div class="chain-grid">${[...(decoding?.matches || []), ...(decoding?.candidates || [])].map(chain).join("") || "<p>现有画面没有可确认的指数方向暗语。</p>"}</div><p class="caption">${item.currentInterpretation ? "此处按 " + h(item.currentInterpretation.version) + " 另行解读，先验建立于 " + h(date(item.currentInterpretation.establishedAt)) + "；旧答案在原始记录中保留。" : isReview ? "此处使用另存的新版本复盘，未覆盖原答案。复盘时间 " + h(date(item.reviewedAt)) + "。" : "解码锁定于 " + h(date(r.createdAt)) + "。"} 名称、谐音、成语及组合含义均是候选；作者本意尚未确认。</p></details><section class="market"><div class="market-heading"><h3>上证指数 · ${r.market === "a-share" ? "发布后行情验证" : "发布后行情（比较基准）"}</h3><span class="tag">${h(e.evaluationVersion)}</span></div>${r.market !== "a-share" ? '<p class="caption">本条话题包含海外、全球或未确定市场。上证仅作比较基准，不能用它验证其他市场的观点。</p>' : ""}${sd ? `<div class="same-day"><div><b>当天收盘 ${h(sd.date)}</b><p>${sd.status === "ready" ? "收盘 " + number(sd.index) + " 点" : h(sd.reason)}</p></div><div><span>当日涨跌（相对前收）</span><strong class="${tone(sd.dailyReturn)}">${sd.dailyReturn == null ? "—" : pct(sd.dailyReturn)}</strong></div><div><span>发布后首个对应报价 → 收盘</span><strong class="${tone(sd.postPublicationReturn)}">${sd.postPublicationReturn == null ? "缺分钟数据" : pct(sd.postPublicationReturn)}</strong><small>${sd.publicationQuote ? h(sd.publicationQuote.timestamp.slice(11, 16)) + " / " + number(sd.publicationQuote.close) + " 点" : "不以日线或更晚报价替代"}</small></div><p class="same-day-note">${sd.prospective ? "解读在当日收盘前锁定。" : "当日结果属于事后观察，不计作事前预测命中。"} 日涨跌包含发布前走势，与发布后的变化分开列示。</p></div>` : '<p class="caption">发布已在15:00及之后，当天走势发生在发布前；验证从下一交易日开始。</p>'}<div class="windows">${windows.map(windowCard).join("")}</div><details class="market-detail"><summary>行情曲线、验证口径与原始档案</summary><div class="chart-row"><div>${chart(chartRows)}<p class="caption">${item.base ? "基准：" + h(item.base.date) + " 收盘 " + number(item.base.close) + " 点。" : ""} 1 / 3 / 5日收益为基准收盘至目标收盘累计变化；3、5日不是单日涨跌。</p></div><div class="validation-note"><b>${e.status === "pending" ? "已留存，等待目标交易日" : e.prospective ? "目标开盘前留存" : "历史补录 / 事后复盘"}</b><p>${r.forecast ? "方向及窗口按锁定预测单独验证。" : "没有锁定明确方向与时间，不用行情涨跌计算预测命中。"}</p><p>5日风险代理：${e.riskHit == null ? "待验证或不适用" : e.riskHit ? "出现至少2%收盘回撤" : "未出现至少2%收盘回撤"}。</p></div></div><details><summary>60 / 180交易分钟与原始记录</summary><div class="archive"><p>60交易分钟：${pct(item.intraday.ret60)}；180交易分钟：${pct(item.intraday.ret180)}。午休不计，缺失窗口留空。</p><p>原规则 ${h(r.ruleVersion)}；原锁定 ${h(date(r.createdAt))}。</p><p>原总结：${h(conclusion.title)}。${h(conclusion.body)}</p><p>原答案：${h(e.signal.reason)}</p><p>${h(r.notes)}</p>${shots.map((s) => `<p class="hash">截图 ${h(s.file)} · ${clock(s.time)} · ${collected(s)} ${h(date(s.capturedAt))}<br>SHA-256 ${h(s.sha256)}<br><button class="original" style="background:white;font-size:11px" data-shot="${h(s.key)}" data-caption="${h(r.title)} · ${clock(s.time)}">查看这张原图 ↗</button></p>`).join("")}</div></details></details></section></article>`;
}

function annualPanel(data) {
  const s = data.annualStudy;
  if (!s) return "";
  return `<section class="month-panel" id="annual-study"><div class="market-heading"><h3>2026年度系统抽样</h3><span class="tag">${h(s.start)} — ${h(s.end)}</span></div><p>已存档 ${s.archived} / ${s.selectedCount} 条固定抽样 · 待核实 ${s.pending} · 不适用 ${s.excluded} · 有画面 ${s.withVisual} / 缺画面 ${s.withoutVisual}。${h(s.status)}</p><div class="coverage-grid">${s.months.map((m) => `<span class="coverage-day ${m.selectedArchived ? "" : "blank"}"><small>${h(m.month)}</small><b>${m.selectedArchived} 条</b><small>合格 ${m.eligibleBackgrounds} / 排除 ${m.excluded}</small></span>`).join("")}</div><p class="caption">${h(s.method)}</p><p class="caption">${h(s.caveat)}</p></section>`;
}
function monthPanel(data) {
  const m = data.monthStudy;
  if (!m) return "";
  return `<section class="month-panel"><div class="market-heading"><h3>近30天整理 · ${h(m.windowStart)} — ${h(m.windowEnd)}</h3><span class="tag">${m.workCount} 条作品 · 新补 ${m.newCount} 条</span></div><p>${h(m.selection)}</p><div class="coverage-grid">${m.coverage.map((d) => (d.count ? `<a class="coverage-day" href="#day-${h(d.date)}"><small>${h(d.date.slice(5))} · ${d.tradingDay ? "交易日" : "休市"}</small><b>${d.count} 条</b></a>` : `<span class="coverage-day blank"><small>${h(d.date.slice(5))} · ${d.tradingDay ? "交易日" : "休市"}</small><b>未收录</b></span>`)).join("")}</div><p class="caption">${h(m.limitations)} “未收录”表示当前可见列表未采到该日作品，不证明当天从未发布。上交所<a href="https://www.sse.com.cn/disclosure/announcement/general/c/c_20260915_10832273.shtml" target="_blank" rel="noreferrer">休市公告</a>已核对；回测跳过中秋、国庆及周末。</p><details><summary>暗语与后续行情的关联 · 不代表预测准确率</summary><p class="caption">${h(m.interpretation)}符合此口径的作品 ${m.eligibleWorks} 条，已完成不同次日目标 ${m.eligibleNextDays} 个。全窗口共同收益基准覆盖 ${m.benchmark.n} 个不同目标日，平均次日收益 ${pct(m.benchmark.meanReturn)}；其上涨占比 ${m.benchmark.upRate === null ? "待验证" : (m.benchmark.upRate * 100).toFixed(1) + "%"} 是行情基线。</p><div class="table-wrap"><table class="history-table"><thead><tr><th>原v2冻结词典线索（留存历史）</th><th>次日均值 / 不同目标日</th><th>3日均值 / 不同目标日</th><th>5日均值 / 不同目标日</th></tr></thead><tbody>${m.relations.map((r) => `<tr><td>${h(r.name)}<small>${h(r.version)}</small></td>${[r.day1, r.day3, r.day5].map((w) => `<td class="${tone(w.meanReturn)}">${pct(w.meanReturn)}<small>${w.n} 个不同目标日</small></td>`).join("")}</tr>`).join("") || '<tr><td colspan="4">尚无符合统计口径的已完成规则样本。</td></tr>'}</tbody></table></div><p class="caption">样本仍少于30个独立交易日，不能由平均收益或行情上涨占比推算“暗语命中率”。同一目标日只记一次，3/5日窗口可能重叠，不视为统计独立样本；新提出的金锣、“降”字等候选没有并入旧规则成绩，须冻结后用后续作品验证。</p></details></section>`;
}

function historyTable(data) {
  const table = data.monthStudy || data.historyOverview;
  if (!table?.rows?.length) return "";
  return `<section class="history-overview" id="history-overview" hidden><div class="market-heading"><h3>${data.monthStudy ? "近30天回测" : "新增历史复盘"} · 收益速览</h3><span class="tag uncertain">${data.monthStudy ? "事后样本与待验证窗口分列" : "全部事后补录"}</span></div><p class="caption">此表 ${table.rows.length} 条作品，涉及 ${table.independentNextDays} 个已有结果的不同次日目标交易日。同日多视频不能当作独立预测样本。所有收益均以上证指数作统一基准，海外题材不以它验证原观点。</p><div class="table-wrap"><table class="history-table"><thead><tr><th>发布时间 / 原作品</th><th>总结论 / 可见组合</th><th>当天收盘 / 日涨跌</th><th>下一交易日</th><th>3交易日累计</th><th>5交易日累计</th><th>查看证据</th></tr></thead><tbody>${table.rows
    .map((i) => {
      const r = i.record,
        e = i.evaluation,
        sd = e.sameDay;
      return `<tr><td><a href="${h(safeExternalURL(r.url))}" target="_blank" rel="noreferrer">${h(r.publishedAt.slice(0, 16).replace("T", " "))}<br>${h(r.title)}</a><small>${r.market === "a-share" ? "A股话题" : r.market === "hk" ? "港股 / 上证比较" : r.market === "global" ? "全球 / 上证比较" : "范围未确认 / 上证比较"}${i.coauth ? " · 共创" : ""}${r.sourceType === "unknown" ? " · 原发未确认" : ""}</small></td><td>${h(i.currentInterpretation?.headline || i.typeName)}<small>${h(i.typeName)}</small><small>${r.imported ? "本轮历史补录" : e.prospective ? "目标开盘前留存" : "此前历史观察"}</small></td><td class="${tone(sd?.dailyReturn)}">${!sd ? "15:00及之后发布" : sd.status === "non-trading-day" ? "非交易日" : sd.dailyReturn == null ? "缺数据" : pct(sd.dailyReturn)}${sd?.index != null ? `<small>${number(sd.index)} 点</small>` : ""}</td>${[e.ret1, e.ret3, e.ret5].map((v, j) => `<td class="${tone(v)}">${pct(v)}<small>${h(i.windows[j].date || "窗口未完成")}</small></td>`).join("")}<td><a href="#${h(r.id)}">物品截图 ↓</a></td></tr>`;
    })
    .join(
      "",
    )}</tbody></table></div><p class="caption">当天日涨跌包含发布前行情；发布后的首个对应分钟报价未取得时，不伪造发布后收益。下一、3、5日是基准收盘到目标收盘的累计变化。没有锁定明确方向的解读不计算命中率。</p></section>`;
}

function dailyControls(data) {
  const dates = [...new Set(data.items.map((i) => i.evaluation.timing.date))]
      .sort()
      .reverse(),
    latest = dates[0],
    count = data.items.filter(
      (i) => i.evaluation.timing.date === latest,
    ).length;
  const today = new Date(new Date(data.generatedAt).getTime() + 8 * 3600000)
      .toISOString()
      .slice(0, 10),
    isToday = latest === today;
  return `<div class="report-views"><button id="daily-view" aria-pressed="true">按日期查看</button>${data.historyOverview ? `<button id="history-view" aria-pressed="false">${data.monthStudy ? "近30天回测速览" : "历史回测速览"}</button>` : ""}</div><div class="latest-day-notice"><div><b>${isToday ? "今天已收录" : "最新收录日期"} ${h(latest)} · ${count} 条视频</b><small>报告快照更新于 ${h(date(data.generatedAt))}（北京时间）。刷新页面可读取最近一次成功更新的报告。</small></div><button id="latest-day">${isToday ? "查看今天" : "查看最新日期"} · ${count}条</button></div><div class="day-controls" id="day-controls"><label>发布日期（北京时间）<select id="day-select" aria-label="选择视频发布日期">${dates.map((d) => `<option value="${h(d)}">${h(d)} · ${data.items.filter((i) => i.evaluation.timing.date === d).length}条视频</option>`).join("")}<option value="all">全部日期 · 跨日搜索</option></select></label><div class="day-buttons"><button id="earlier-day">← 较早一天</button><button id="later-day">较晚一天 →</button></div><span id="page-state" aria-live="polite"></span></div><p class="caption" id="day-tip">每个日期单独展示，只列已存档日期；可选择全部日期进行跨日检索。</p>`;
}

export function renderVisualReport(
  data,
  imageSources,
  { hosted = false } = {},
) {
  const shotVars = Object.entries(imageSources)
    .map(([key, url]) => `--${key}:url("${url}")`)
    .join(";");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>大霄译站 · 李大霄物件暗语可视化报告</title><meta name="description" content="真实画面、物件解码与发布后上证指数验证"><style>:root{${shotVars};--ink:#213c32;--green:#27634d;--muted:#738077;--line:#dce5dd;--red:#b65045;--paper:#f5f6ef}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.65 'Microsoft YaHei',system-ui,sans-serif}a{color:var(--green);text-decoration:none}button,input,select{font:inherit}button,a,input,select,summary{outline-offset:4px}button{cursor:pointer}header{border-bottom:1px solid var(--line);background:#fafbf6} .topbar{max-width:1240px;margin:auto;padding:22px 32px;display:flex;justify-content:space-between;align-items:center}.brand{display:flex;align-items:center;gap:12px;font-size:23px;font-weight:700}.mark{background:var(--green);color:#fff;border-radius:13px;width:43px;height:43px;display:grid;place-items:center;font-size:23px}.brand small{display:block;font:9px/1.5 system-ui;letter-spacing:2px;color:var(--muted)}.top-links{display:flex;gap:20px;align-items:center}.top-links button{border:1px solid var(--line);background:white;border-radius:8px;padding:6px 15px;color:var(--ink)}main{max-width:1240px;margin:auto;padding:42px 32px}.eyebrow{font-size:12px;letter-spacing:.5px;color:var(--muted)}h1{font-size:36px;line-height:1.35;letter-spacing:-1px;margin:10px 0}h2{font-size:21px;line-height:1.5;margin:5px 0}h3{font-size:20px;line-height:1.5;margin:6px 0 12px}p{margin:8px 0}.intro{max-width:780px;color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(4,1fr);margin:28px 0;background:white;border:1px solid var(--line);border-radius:13px;overflow:hidden}.stat{padding:19px 24px;border-right:1px solid var(--line)}.stat:last-child{border:0}.stat strong{display:block;font-size:28px;line-height:1.3}.stat small{color:var(--muted)}.notice{padding:12px 17px;border-left:3px solid #c6a25d;background:#faf5e9;font-size:13px}.toolbar{display:flex;gap:12px;margin:25px 0;align-items:center}.toolbar input{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;background:white;padding:10px 13px}.toolbar select{border:1px solid var(--line);border-radius:8px;padding:11px;background:white;color:var(--ink)}.toolbar small{color:var(--muted)}.jump-nav{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:23px}.jump-nav a{border:1px solid var(--line);border-radius:20px;padding:4px 13px;font-size:12px;background:#fff}.video-card{background:white;border:1px solid var(--line);border-radius:16px;margin-bottom:26px;padding:25px 28px;scroll-margin-top:18px}.video-heading{display:flex;gap:15px;align-items:center;margin-bottom:22px}.video-heading>div{flex:1}.ordinal{font-size:29px;color:#b8c7bd;font-family:Georgia,serif}.original{border:1px solid var(--line);border-radius:9px;padding:7px 12px;white-space:nowrap;font-size:13px}.overview{display:grid;grid-template-columns:1fr 1.04fr;gap:28px}.photo{width:100%;display:block;border:0;border-radius:10px;position:relative;background-repeat:no-repeat;background-color:#ecefe9;padding:0;overflow:hidden}.photo:focus-visible{outline:3px solid #bd9a5c}.photo span{position:absolute;bottom:9px;right:9px;color:white;background:#172820b8;border-radius:5px;padding:3px 7px;font-size:10px}.caption{color:var(--muted);font-size:12px}.conclusion{padding:3px 0}.conclusion h3{font-size:24px}.confidence{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}.confidence span{background:#f0f4ee;padding:5px 10px;font-size:12px;border-radius:6px}.confidence b{margin-left:5px}.change{font-size:13px;color:#69796f;border-left:2px solid var(--line);padding-left:13px}details{border-top:1px solid var(--line);margin-top:20px}summary{cursor:pointer;font-weight:600;padding:17px 0;list-style-position:inside}summary span{float:right;font-size:12px;font-weight:400;color:var(--muted)}.evidence-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.evidence{display:grid;grid-template-columns:130px 1fr;gap:15px;padding:16px;border:1px solid var(--line);border-radius:10px;align-items:start}.evidence .photo{max-height:180px}.evidence p{font-size:13px}.evidence small{font-size:11px;color:var(--muted);display:block}.evidence-label{display:flex;justify-content:space-between;gap:8px}.tag{border-radius:20px;font-size:10px;padding:2px 8px;background:#eaf3ed;color:#377456;white-space:nowrap}.tag.uncertain{background:#fbf1de;color:#93713c}.evidence-cue{margin-top:8px;padding-top:7px;border-top:1px dashed var(--line);font-size:12px;color:var(--green)}blockquote{margin:8px 0;padding:7px 9px;background:#f6f7f3;border-left:2px solid #b6cabb;font-size:12px}.correction{margin-top:7px;color:#a47a39!important}.missing{min-height:110px;background:#f1f3ee;display:grid;place-items:center;border-radius:8px;font-size:12px;color:var(--muted)}.decoding-heading{margin:23px 0 12px;font-weight:600}.chain-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.chain{background:#f5f7f1;border-radius:9px;padding:15px;font-size:13px}.chain b,.chain span,.chain strong,.chain small{display:block}.chain span{color:var(--green);padding:7px 0}.chain strong{font-weight:500}.chain small{font-size:11px;color:var(--muted);margin-top:8px}.chain p{font-size:12px;color:var(--muted)}.market{border-top:1px solid var(--line);margin-top:20px;padding-top:17px}.market-heading{display:flex;justify-content:space-between;align-items:center}.market-heading h3{font-size:17px}.windows{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:15px 0}.window{background:#f7f8f4;border:1px solid #e8ede6;border-radius:9px;padding:15px}.window>span{font-size:12px;color:var(--muted)}.window strong{display:block;font-size:27px;line-height:1.8}.window small{display:block;font-size:11px;color:var(--muted)}.up{color:var(--red)}.down{color:#27865b}.waiting{color:#98a198}.flat{color:var(--ink)}.chart-row{display:grid;grid-template-columns:1.7fr 1fr;gap:24px;align-items:center}.price-chart{width:100%;height:auto;display:block}.price-chart text{font-size:12px;fill:#64776a}.chart-empty{padding:32px;background:repeating-linear-gradient(0deg,#f9faf7 0,#f9faf7 27px,#e9eee7 28px);text-align:center;font-size:13px;color:var(--muted);border-radius:9px}.validation-note{font-size:12px;color:var(--muted);border-left:1px solid var(--line);padding-left:20px}.validation-note b{color:var(--ink)}.same-day{display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:18px;padding:16px 18px;margin:10px 0;background:#f0f5ed;border:1px solid #dbe8d6;border-radius:9px;font-size:13px}.same-day strong{display:block;font-size:22px}.same-day span,.same-day small{display:block;color:var(--muted);font-size:11px}.same-day-note{grid-column:1/-1;border-top:1px solid #d5e1d0;padding-top:8px;font-size:11px;color:var(--muted)}.archive{font-size:12px;color:var(--muted);padding-bottom:5px}.hash{overflow-wrap:anywhere;font-family:monospace;font-size:10px}.method{padding:22px;background:#ebf0e7;border-radius:13px;font-size:13px}.method h3{font-size:18px}.method-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.method p{color:#627266}footer{padding:25px 0;color:var(--muted);font-size:11px}dialog{border:0;border-radius:12px;padding:16px;max-width:1100px;width:95vw;color:var(--ink)}dialog::backdrop{background:#071a13d9}.dialog-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.dialog-head button{padding:5px 13px;border:1px solid var(--line);border-radius:7px;background:#fff}.full-shot{width:100%;aspect-ratio:1280/720;background-size:100% 100%;background-repeat:no-repeat}.no-results{padding:30px;text-align:center;color:var(--muted)}[hidden]{display:none!important}@media(max-width:850px){main{padding:26px 18px}.topbar{padding:18px}.overview,.chart-row{grid-template-columns:1fr}.evidence-grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.stat:nth-child(2){border-right:0}.stat:nth-child(-n+2){border-bottom:1px solid var(--line)}.video-card{padding:20px}.validation-note{border:0;padding:0}.same-day{grid-template-columns:1fr 1fr}.same-day>div:first-child{grid-column:1/-1}.toolbar small{display:none}h1{font-size:28px}}@media(max-width:520px){.top-links{font-size:11px;gap:10px}.brand small{display:none}.video-heading{flex-wrap:wrap}.original{margin-left:auto}.evidence{grid-template-columns:100px 1fr;padding:12px;gap:11px}.chain-grid,.method-grid{grid-template-columns:1fr}.windows{gap:6px}.window{padding:10px}.window strong{font-size:20px}.same-day{gap:10px}.toolbar{flex-wrap:wrap}.toolbar input{flex-basis:100%}summary span{float:none;display:block;margin-left:18px}.photo span{font-size:8px} }@media print{.toolbar,.jump-nav,.top-links,.photo span{display:none}.video-card{break-inside:avoid;border-radius:0}.photo{print-color-adjust:exact}body{background:white}main{padding:0}.evidence-details:not([open])::after{content:'物件截图请在网页版展开查看';font-size:12px}}.month-panel{margin:24px 0;padding:22px;background:#edf2e9;border:1px solid var(--line);border-radius:13px;font-size:13px}.coverage-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:7px;margin:16px 0}.coverage-day{background:white;padding:8px;border:1px solid var(--line);border-radius:7px}.coverage-day small,.coverage-day b{display:block}.coverage-day small{font-size:10px;color:var(--muted)}.coverage-day.blank{opacity:.55}@media(max-width:850px){.coverage-grid{grid-template-columns:repeat(6,1fr)}}@media(max-width:520px){.coverage-grid{grid-template-columns:repeat(3,1fr)}}.history-overview{background:white;border:1px solid var(--line);border-radius:13px;padding:22px;margin:24px 0}.table-wrap{overflow-x:auto}.history-table{width:100%;border-collapse:collapse;font-size:12px}.history-table th{text-align:left;color:var(--muted);font-weight:500;background:#f3f6ef;padding:11px;white-space:nowrap}.history-table td{padding:12px 11px;border-bottom:1px solid #e7ede5;vertical-align:top}.history-table td:first-child{min-width:205px}.history-table td:nth-child(2){min-width:145px}.history-table small{display:block;font-size:10px;color:var(--muted);white-space:nowrap}.history-table td:nth-child(n+3){white-space:nowrap}.history-table tr:last-child td{border-bottom:0}.report-views{display:flex;gap:8px;margin:24px 0 12px}.report-views button,.day-buttons button{border:1px solid var(--line);border-radius:8px;background:white;padding:8px 14px;color:var(--ink)}.report-views button[aria-pressed="true"]{background:var(--green);border-color:var(--green);color:white}.day-controls{display:flex;gap:18px;align-items:center;padding:17px 20px;background:white;border:1px solid var(--line);border-radius:12px}.day-controls label{font-size:11px;color:var(--muted)}.day-controls select{display:block;min-width:230px;margin-top:5px;border:1px solid var(--line);border-radius:7px;padding:8px;background:white;color:var(--ink)}.day-buttons{display:flex;gap:8px}.day-buttons button:disabled{opacity:.4;cursor:default}#page-state{margin-left:auto;font-size:12px;color:var(--muted)}@media(max-width:700px){.day-controls{flex-wrap:wrap;gap:12px}.day-controls label{width:100%}.day-controls select{width:100%}#page-state{margin:0}.day-buttons{flex:1}}@media print{.report-views,.day-controls,#day-tip{display:none}}.latest-day-notice{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:15px 18px;margin:12px 0;background:#edf4e9;border:1px solid #c6d9bd;border-radius:10px}.latest-day-notice small{display:block;font-size:11px;color:var(--muted);margin-top:4px}.latest-day-notice button{flex-shrink:0;border:1px solid var(--green);border-radius:8px;background:var(--green);color:white;padding:9px 15px;font-weight:600}@media(max-width:650px){.latest-day-notice{align-items:flex-start;flex-direction:column}.latest-day-notice button{width:100%}}@media print{.latest-day-notice{display:none}}.key-evidence-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:16px}.key-evidence{min-width:0;background:#f6f8f3;border:1px solid var(--line);border-radius:9px;padding:9px}.key-evidence .photo{width:min(100%,calc(84px * var(--crop-ratio)));height:auto;display:block;margin:auto}.key-evidence b,.key-evidence small{display:block}.key-evidence b{font-size:12px;margin-top:7px}.key-evidence small{font-size:10px;color:var(--muted);line-height:1.5}.compact-probability .probability b{font-size:30px}.compact-probability .probability{justify-content:space-between}.compact-probability>details{margin-top:12px}.compact-probability summary,.interpretation-more summary{padding:10px 0;font-size:12px}.conclusion .confidence{margin:10px 0}.conclusion .change{font-size:12px}.research-overview{margin-bottom:24px;background:#eef3eb;border:1px solid var(--line);border-radius:10px;padding:0 16px}.research-overview>summary{padding:13px 0}.market-detail>summary{font-size:12px;padding:11px 0}.interpretation-more{font-size:13px}.notice{margin-bottom:18px}@media(max-width:520px){.key-evidence .photo{width:min(100%,calc(68px * var(--crop-ratio)))}.key-evidence b{font-size:11px}.compact-probability .probability b{font-size:26px}}.evidence .photo{width:min(100%,calc(180px * var(--crop-ratio)));height:auto;max-height:none;justify-self:center}${modelStyles}${backgroundStyles}</style></head><body><header><div class="topbar"><a class="brand" href="#top"><span class="mark">译</span><span>大霄译站<small>BACKGROUND OBSERVATORY</small></span></a><div class="top-links">${hosted ? '<a href="/">观察工作台</a>' : ""}<a href="${h(safeExternalURL(data.profile))}" target="_blank" rel="noreferrer">李大霄原账号 ↗</a><button id="print">打印 / 保存PDF</button></div></div></header><main id="top"><div class="eyebrow">物件暗语 · 证据档案 · 收盘验证</div><h1>大霄译站 · 视频背景观察与行情验证</h1><p class="intro">每条视频保留具体物件、真实摆放与可辨文字。解码链与其他解释并列，视觉辨认、寓意支持和预测效果分别呈现。</p><div class="stats"><div class="stat"><strong>${data.items.length}</strong><small>已核实作品链接 · 档案 ${data.items.length} 条</small></div><div class="stat"><strong>${Object.keys(imageSources).length}</strong><small>真实截图 · 记录采集时间</small></div><div class="stat"><strong>${data.completedDays}</strong><small>有次日结果的不同交易日</small></div><div class="stat"><strong>${data.modelStudy?.backgroundStudy?.model ? "已训练 / 实验" : "等待数据"}</strong><small>尚不能估计可靠预测准确率</small></div></div><div class="notice">这是一份证据与行情快照，更新于 ${h(date(data.generatedAt))}。${data.monthStudy ? "近30天按可见列表连续整理，新增样本是事后补录；删除或隐藏作品无法恢复。" : "历史样本非连续选取；"}寓意候选尚未获作者确认。截图补采不会改变原解读或锁定时间。</div><details class="research-overview"><summary>训练、历史覆盖与检验方法 <span>${data.modelStudy?.backgroundStudy?.samples.length || 0}个训练日 · 当前仍为实验</span></summary>${annualPanel(data)}${backgroundPanel(data)}${modelPanel(data)}${monthPanel(data)}</details>${dailyControls(data)}${historyTable(data)}<div class="toolbar" id="filter-toolbar"><input id="search" type="search" placeholder="搜索标题、地球、熊猫、泡沫…" aria-label="搜索视频与物件"><select id="session" aria-label="按发布时间筛选"><option value="all">全部发布时间</option><option value="before-close">15:00前发布</option><option value="after-close">15:00及之后发布</option></select><small id="result-count">${data.items.length} 条视频</small></div><nav class="jump-nav" id="jump-nav" aria-label="跳转视频">${data.items.map((r) => `<a href="#${h(r.record.id)}">${h(r.record.publishedAt.slice(5, 16).replace("T", " "))} · ${h(r.record.title.slice(0, 12))}</a>`).join("")}</nav><div id="records">${data.items.map((item, i) => recordCard(item, i, data.items[0]?.evaluation.timing.date)).join("")}</div><p class="no-results" id="empty" hidden>没有匹配的视频。试试其他物件名称。</p><section class="method"><h3>怎样读这份报告</h3><div class="method-grid"><div><b>时间与行情口径</b><p>北京时间15:00前发布，额外列出当天收盘、当日日涨跌及发布后对应分钟报价到收盘的变化。15:00及之后发布，只列后续完整交易日。非交易日不强行生成当天收盘。</p><p>下一 / 3 / 5交易日按实际行情日历定位。休市跳过；未完成的未来行情留空。基准是发布日或此前最近的已完成收盘。</p></div><div><b>证据与可信度</b><p>物件名称、颜色与摆放是可见事实；谐音和隐喻是解释候选。连续道具不自动定位新的顶部日期。可见证据旁的裁切由原截图定位显示，点击可还原完整浏览器画面。</p><p>事后补录与目标开盘前记录分开；没有预先明确方向和时间的解读不计算命中率。规则修改另存版本，不覆盖旧答案。</p></div></div></section><footer>行情来源：<a href="${h(safeExternalURL(data.marketSource))}" target="_blank" rel="noreferrer">腾讯公开上证指数接口</a> · 抓取 ${h(date(data.marketUpdatedAt))}。历史分钟线未取得的窗口保持缺数据。<br>原始截图带SHA-256校验值；截图日期、视频播放时点和作品发布时间是三种不同时间。</footer></main><dialog id="lightbox" aria-label="查看原始截图"><div class="dialog-head"><b id="photo-caption"></b><button id="close-modal" aria-label="关闭原始截图">关闭 ×</button></div><div class="full-shot" id="full-shot" role="img"></div><p class="caption">原始浏览器截图；没有重新生成或补绘物件。</p></dialog><script>(()=>{
const byId=id=>document.getElementById(id),search=byId('search'),session=byId('session'),day=byId('day-select'),cards=[...document.querySelectorAll('.video-card')],box=byId('lightbox'),overview=byId('history-overview'),dates=[...new Set(cards.map(c=>c.dataset.date))].sort().reverse();
let selected=dates[0]||'all',view='daily';
function render(){const history=view==='history';if(overview)overview.hidden=!history;byId('records').hidden=history;byId('day-controls').hidden=history;byId('day-tip').hidden=history;byId('filter-toolbar').hidden=history;byId('jump-nav').hidden=history;byId('daily-view').setAttribute('aria-pressed',String(!history));byId('history-view')?.setAttribute('aria-pressed',String(history));day.value=selected;let n=0;cards.forEach(c=>{const yes=!history&&(selected==='all'||c.dataset.date===selected)&&c.dataset.search.toLowerCase().includes(search.value.toLowerCase().trim())&&(session.value==='all'||c.dataset.session===session.value);c.hidden=!yes;if(yes)n++;});byId('result-count').textContent=n+' 条视频';byId('empty').hidden=history||n!==0;const index=dates.indexOf(selected);byId('earlier-day').disabled=selected==='all'||index>=dates.length-1;byId('later-day').disabled=selected==='all'||index<=0;byId('page-state').textContent=selected==='all'?n+' 条视频 · 全部日期':'第 '+(index+1)+' / '+dates.length+' 个日期页 · '+n+' 条视频';document.querySelectorAll('.jump-nav a').forEach(a=>{const c=cards.find(c=>c.id===a.getAttribute('href').slice(1));a.hidden=history||!c||c.hidden;});}
function chooseDate(value){if(value!=='all'&&!dates.includes(value))return;selected=value;view='daily';location.hash=value==='all'?'days-all':'day-'+value;render();}
function followHash(){const target=location.hash.slice(1);if(target==='history-overview'&&overview){view='history';render();return;}if(target==='days-all'){selected='all';view='daily';render();return;}if(target.startsWith('day-')&&dates.includes(target.slice(4))){selected=target.slice(4);view='daily';render();return;}const card=cards.find(c=>c.id===target);if(card){selected=card.dataset.date;view='daily';search.value='';session.value='all';render();card.scrollIntoView?.({block:'start'});}}
byId('latest-day').addEventListener('click',()=>{search.value='';session.value='all';chooseDate(dates[0]);byId('day-controls').scrollIntoView?.({block:'start'});});
search.addEventListener('input',render);session.addEventListener('change',render);day.addEventListener('change',()=>chooseDate(day.value));byId('earlier-day').addEventListener('click',()=>chooseDate(dates[dates.indexOf(selected)+1]));byId('later-day').addEventListener('click',()=>chooseDate(dates[dates.indexOf(selected)-1]));byId('daily-view').addEventListener('click',()=>chooseDate(selected));byId('history-view')?.addEventListener('click',()=>{location.hash='history-overview';followHash();});window.addEventListener('hashchange',followHash);document.querySelectorAll('a[href^="#douyin-"]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();location.hash=a.getAttribute('href').slice(1);followHash();}));
document.querySelectorAll('[data-shot]').forEach(b=>b.addEventListener('click',()=>{const shot=byId('full-shot');shot.style.backgroundImage='var(--'+b.dataset.shot+')';shot.setAttribute('aria-label',b.dataset.caption);byId('photo-caption').textContent=b.dataset.caption;box.showModal();}));byId('close-modal').addEventListener('click',()=>box.close());box.addEventListener('click',e=>{if(e.target===box){const r=box.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)box.close();}});byId('print').addEventListener('click',()=>window.print());render();followHash();})();</script></body></html>`;
}

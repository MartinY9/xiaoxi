import { buildAnnualStudy, annualMarkdown } from "../lib/annual-study.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backtest,
  intraday,
  LABELS,
  localDate,
  withCloseConfirmation,
} from "../lib/engine.ts";
import { renderVisualReport } from "../lib/visual-report.mjs";
import { buildMonthStudy } from "../lib/month-study.mjs";
import { addModelArtifacts } from "../lib/model-artifacts.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = JSON.parse(
  await fs.readFile(path.join(root, "work/monitor-state.json"), "utf8"),
);
const index = JSON.parse(
  await fs.readFile(path.join(root, "work/evidence-index.json"), "utf8"),
);
const conclusions = JSON.parse(
  await fs.readFile(path.join(root, "work/report-conclusions.json"), "utf8"),
);
let historySelection = null;
try {
  historySelection = JSON.parse(
    await fs.readFile(path.join(root, "work/history-selection.json"), "utf8"),
  );
} catch {}
let monthSelection = null;
try {
  monthSelection = JSON.parse(
    await fs.readFile(path.join(root, "work/month-study.json"), "utf8"),
  );
} catch {}
let amendments = [];
try {
  amendments = JSON.parse(
    await fs.readFile(path.join(root, "work/evidence-amendments.json"), "utf8"),
  ).items;
} catch {}
let reviews = [];
try {
  reviews = JSON.parse(
    await fs.readFile(
      path.join(
        root,
        "work/reinterpretations/symbolic-codebook-2026-10-13-v2.json",
      ),
      "utf8",
    ),
  ).reviews;
} catch {}
const generatedAt = new Date().toISOString(),
  prices = state.dataset?.complete
    ? withCloseConfirmation(state.dataset.prices, state.dataset.updatedAt)
    : [],
  minutes = state.dataset?.minutes || [];
const today = localDate(generatedAt),
  completed = prices.filter(
    (p) =>
      p.closeConfirmed !== false &&
      (p.date < today ||
        (p.date === today &&
          new Date(generatedAt) >= new Date(today + "T15:05:00+08:00"))),
  );
const evaluation = backtest(state.records, prices, generatedAt, minutes);
const items = evaluation.results
  .sort((a, b) => b.record.publishedAt.localeCompare(a.record.publishedAt))
  .map((e) => {
    const r = e.record,
      review = reviews.find((x) => x.id === r.id),
      shots = index.shots.filter((s) => s.recordId === r.id),
      attachments = index.attachments.filter((a) => a.recordId === r.id),
      day = e.timing.date,
      base = completed.filter((p) => p.date <= day).at(-1),
      future = completed.filter((p) => p.date > day);
    const observations = (review?.observations || r.observations).map((o) => {
      const a = amendments.find(
        (a) => a.recordId === r.id && a.observationId === o.id,
      );
      return a ? { ...o, verified: a.verified, confidence: a.confidence } : o;
    });
    const conclusion = conclusions.items.find((x) => x.id === r.id) || {
      title:
        r.decoding?.bias === "defensive"
          ? "防守寓意候选，时间未明确"
          : "方向尚无法确认",
      body: r.decoding?.summary || e.signal.reason,
      visual: "按各证据列示",
      semantic: "低 / 待验证",
      effect: "待积累",
      change: "请对比此前同场景证据，未完整观察时不宣称新增或消失。",
    };
    return {
      record: r,
      evaluation: e,
      shots,
      attachments,
      observations,
      decoding: review?.decoding || r.decoding,
      reviewedAt: review?.reviewedAt,
      conclusion,
      base,
      labelNames: LABELS,
      intraday: intraday(r.publishedAt, minutes, prices, generatedAt),
      chartRows: base ? [base, ...future.slice(0, 5)] : [],
      windows: [1, 3, 5].map((n) => ({
        label: n === 1 ? "下一交易日" : n + "交易日累计",
        date: future[n - 1]?.date || null,
        close: future[n - 1]?.close || null,
        ret: n === 1 ? e.ret1 : n === 3 ? e.ret3 : e.ret5,
      })),
    };
  });
const modelStudy = await addModelArtifacts(
  root,
  items,
  prices,
  generatedAt,
  monthSelection,
);
const historyRows = historySelection
  ? items
      .filter((i) => historySelection.items.some((s) => s.id === i.record.id))
      .map((i) => ({
        ...i,
        typeName: historySelection.items.find((s) => s.id === i.record.id)
          .typeName,
      }))
  : [];
const historyOverview = historyRows.length
  ? {
      addedAt: historySelection.addedAt,
      note: historySelection.note,
      independentNextDays: new Set(
        historyRows
          .filter((i) => i.evaluation.ret1 !== null)
          .map((i) => i.evaluation.targetDate),
      ).size,
      rows: historyRows,
    }
  : null;
const data = {
  version: "visual-report-v2-month",
  generatedAt,
  profile:
    "https://www.douyin.com/user/MS4wLjABAAAAz-Nssy-G6nNshJODTK3VpEpjWsH1pMHODDPexGS5K-D6EAo5iASK_qCGRb7M5Rbe?from_tab_name=main",
  marketSource: state.dataset?.source,
  marketUpdatedAt: state.dataset?.updatedAt,
  completedDays: new Set(
    evaluation.results.filter((e) => e.ret1 != null).map((e) => e.targetDate),
  ).size,
  items,
  historyOverview,
  monthStudy: buildMonthStudy(monthSelection, items, completed, generatedAt),
};
data.version = "visual-report-v9-strong-only";
data.modelStudy = modelStudy;
let annualSelection = null;
try {
  annualSelection = JSON.parse(
    await fs.readFile(path.join(root, "work/year-study.json"), "utf8"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let qualifications = { items: [] };
try {
  qualifications = JSON.parse(
    await fs.readFile(path.join(root, "work/model-eligibility.json"), "utf8"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
data.annualStudy = buildAnnualStudy(
  annualSelection,
  items,
  [...(monthSelection?.items || []), ...qualifications.items],
  modelStudy.backgroundStudy,
);
if (data.annualStudy)
  await fs.writeFile(
    path.join(root, "outputs/2026年度抽样训练说明.md"),
    annualMarkdown(data.annualStudy),
  );
const inline = {},
  hosted = {};
for (const s of index.shots) {
  const absolute = path.resolve(root, "public/evidence", s.file);
  if (path.dirname(absolute) !== path.join(root, "public/evidence"))
    throw new Error("Invalid screenshot path");
  const bytes = await fs.readFile(absolute);
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(bytes).digest("hex") !== s.sha256)
    throw new Error("Screenshot hash mismatch: " + s.file);
  const mime =
    s.synthetic && s.file.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
  inline[s.key] = "data:" + mime + ";base64," + bytes.toString("base64");
  hosted[s.key] = "/evidence/" + s.file;
}
await fs.mkdir(path.join(root, "outputs"), { recursive: true });
await fs.writeFile(
  path.join(root, "outputs/李大霄可视化报告.html"),
  renderVisualReport(data, inline),
);
await fs.writeFile(
  path.join(root, "public/report.html"),
  renderVisualReport(data, hosted, { hosted: true }),
);
await fs.writeFile(
  path.join(root, "outputs/可视化报告数据.json"),
  JSON.stringify(data, null, 2),
);
await fs.writeFile(
  path.join(root, "public/evidence/manifest.json"),
  JSON.stringify(index, null, 2),
);
console.log(
  JSON.stringify({
    html: path.join(root, "outputs/李大霄可视化报告.html"),
    records: items.length,
    screenshots: index.shots.length,
    version: data.version,
  }),
);

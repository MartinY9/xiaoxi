import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { dashboardAsset } from "../lib/local-server.mjs";
import { recordSchema } from "../lib/schemas.ts";
import { normalizePrices, mergeMinutes } from "../lib/engine.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const [action = "help", argument] = process.argv.slice(2),
  hash = (b) => createHash("sha256").update(b).digest("hex");
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
async function requireRealArchive() {
  const state = await read("work/monitor-state.json");
  if (state.synthetic)
    throw Error("合成演示目录禁止导入真实观察、证据或行情，请使用独立目录");
}
async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + ".tmp", JSON.stringify(value, null, 2));
  await fs.rename(file + ".tmp", file);
}
async function init() {
  for (const p of ["work", "outputs", "public/evidence"])
    await fs.mkdir(p, { recursive: true });
  for (const [p, value] of [
    [
      "work/monitor-state.json",
      {
        records: [],
        seenIds: [],
        status: "等待导入核实观察",
        channel: "local",
        dataset: null,
      },
    ],
    ["work/evidence-index.json", { shots: [], attachments: [] }],
    ["work/report-conclusions.json", { items: [] }],
  ]) {
    try {
      await fs.writeFile(p, JSON.stringify(value, null, 2), { flag: "wx" });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}
function run(script, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  if (r.status !== 0) throw Error("子命令失败：" + script);
}
async function report() {
  await init();
  run("scripts/local-monitor.mjs", ["report"]);
  const state = await read("work/monitor-state.json");
  if (state.synthetic) {
    for (const p of ["outputs/李大霄可视化报告.html", "public/report.html"]) {
      let s = await fs.readFile(p, "utf8");
      s = s
        .replace(
          /<title>[^<]*<\/title>/,
          "<title>大霄译站 · 合成样例（非真实视频）</title>",
        )
        .replace(
          "</head>",
          "<style>.demo-mode-banner{position:sticky;top:0;z-index:50;padding:12px 20px;background:#fff3d9;border-bottom:1px solid #d5b66b;color:#614a22;font-size:13px;line-height:1.6;text-align:center}.demo-mode-banner strong{margin-right:8px}</style></head>",
        )
        .replace(
          "<body>",
          '<body data-report-mode="synthetic"><aside class="demo-mode-banner" role="note"><strong>合成样例 · 非真实视频</strong>只用于安装与功能检查。画面、观察、时间与行情均为程序生成；概率不代表真实预测成绩。查看真实案例，请导入已核实的视频与截图后生成报告。</aside>',
        )
        .replaceAll("A股话题已核实", "合成A股语境示例")
        .replaceAll("作者本意待确认", "不代表作者观点")
        .replaceAll("真实截图", "合成示意图")
        .replaceAll("真实播放画面", "合成示意画面")
        .replaceAll("原视频 ↗", "演示记录 ↗")
        .replaceAll("已核实作品链接", "合成样例记录")
        .replaceAll(
          "原始浏览器截图；没有重新生成或补绘物件。",
          "程序生成的示意图，不是视频截图。",
        );
      await fs.writeFile(p, s);
    }
  }
}
async function demo() {
  await init();
  const state = await read("work/monitor-state.json");
  if (state.records.length && !state.synthetic)
    throw Error("此目录已有真实档案；请在新的解压目录运行演示。");
  const { createDemo } = await import("./synthetic-demo.mjs");
  await createDemo(root);
  await report();
  console.log(
    "安装检查用合成样例已生成（非真实视频）：outputs/李大霄可视化报告.html",
  );
}
async function importRecord(file) {
  if (!file) throw Error("需要观察JSON路径");
  await init();
  await requireRealArchive();
  const body = await read(path.resolve(file)),
    record = recordSchema.parse(body.record || body),
    qualification = body.modelEligibility;
  if (
    !qualification ||
    !["sourceVerified", "everyday", "coauth"].every(
      (k) => typeof qualification[k] === "boolean",
    )
  )
    throw Error("需要显式提供modelEligibility，不能默认合格");
  const ids = record.observations.map((o) => o.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    throw Error("每个观察需要唯一id");
  for (const c of record.semanticCandidates || [])
    if (c.evidenceIds.some((id) => !ids.includes(id)))
      throw Error("语义候选必须引用本条实际观察");
  for (const o of record.observations) {
    for (const rel of o.relations || []) {
      const target = record.observations.find((t) => t.id === rel.targetId);
      if (rel.verified && (!target || target.frameIndex !== o.frameIndex))
        throw Error("已核实关系必须指向同帧物件");
    }
  }
  const safe =
    "work/import-" +
    hash(Buffer.from(JSON.stringify(body))).slice(0, 20) +
    ".json";
  await atomic(safe, body);
  run("scripts/local-monitor.mjs", ["record", safe]);
  const state = await read("work/monitor-state.json"),
    r = state.records.find((r) => r.url === record.url);
  if (r) {
    const {
      typedInterpretation: currentInterpretation,
      TYPE_RESOLUTION_VERSION: USER_PRIOR_VERSION,
    } = await import("../lib/object-types.mjs");
    await fs.mkdir("work/interpretations", { recursive: true });
    try {
      await fs.writeFile(
        "work/interpretations/" + r.id + "-" + USER_PRIOR_VERSION + ".json",
        JSON.stringify(
          {
            recordId: r.id,
            lockedAt: new Date().toISOString(),
            version: USER_PRIOR_VERSION,
            interpretation: currentInterpretation(
              r.observations,
              r.market,
              r.coverage,
              r.semanticCandidates,
            ),
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}
async function importPrices(file) {
  if (!file) throw Error("需要行情JSON/CSV路径");
  await init();
  await requireRealArchive();
  const source = path.resolve(file),
    text = await fs.readFile(source, "utf8");
  let body;
  if (source.endsWith(".csv"))
    throw Error(
      "CSV缺少实际抓取时间，请使用含updatedAt和prices的JSON封装；不能以导入时间假充行情抓取时间。",
    );
  else body = JSON.parse(text);
  if (
    !Number.isFinite(new Date(body.updatedAt).getTime()) ||
    new Date(body.updatedAt) > new Date()
  )
    throw Error("需要有效的实际抓取时间updatedAt");
  const prices = normalizePrices(body.prices),
    state = await read("work/monitor-state.json");
  state.dataset = {
    prices,
    minutes: mergeMinutes([], body.minutes || []),
    source: body.source || "本机导入的已核实报价",
    complete: true,
    updatedAt: body.updatedAt,
  };
  await atomic("work/monitor-state.json", state);
  console.log(
    JSON.stringify({ prices: prices.length, updatedAt: body.updatedAt }),
  );
}
function jpegSize(b) {
  if (b[0] !== 255 || b[1] !== 216) throw Error("证据必须是真实JPEG");
  let p = 2;
  while (p < b.length) {
    if (b[p] !== 255) {
      p++;
      continue;
    }
    const marker = b[p + 1];
    if (marker === 217 || marker === 218) break;
    const length = b.readUInt16BE(p + 2);
    if ([192, 193, 194].includes(marker))
      return { height: b.readUInt16BE(p + 5), width: b.readUInt16BE(p + 7) };
    if (length < 2) break;
    p += 2 + length;
  }
  throw Error("无法核实JPEG尺寸");
}
async function evidence(file) {
  if (!file) throw Error("需要证据清单JSON路径");
  await init();
  await requireRealArchive();
  const manifestPath = path.resolve(file),
    body = await read(manifestPath),
    state = await read("work/monitor-state.json"),
    record = state.records.find((r) => r.id === body.recordId);
  if (!record) throw Error("先导入对应视频观察");
  const index = await read("work/evidence-index.json");
  const prepared = [],
    keys = new Set(),
    frames = new Set();
  for (const s of body.shots || []) {
    if (
      !Number.isFinite(s.time) ||
      s.time < 0 ||
      !Number.isFinite(new Date(s.capturedAt).getTime())
    )
      throw Error("需要真实播放时点与采集时间");
    const bytes = await fs.readFile(
        path.resolve(path.dirname(manifestPath), s.path),
      ),
      sha256 = hash(bytes),
      size = jpegSize(bytes);
    if (s.sha256 && s.sha256 !== sha256) throw Error("截图SHA-256不一致");
    const key = String(s.key);
    if (!/^[a-zA-Z0-9_]+$/.test(key) || keys.has(key))
      throw Error("截图key格式无效或重复");
    keys.add(key);
    if (
      !Number.isInteger(s.frameIndex) ||
      s.frameIndex < 0 ||
      frames.has(s.frameIndex)
    )
      throw Error("需要唯一的实际帧索引frameIndex");
    frames.add(s.frameIndex);
    const existing = index.shots.find((x) => x.key === key);
    if (
      existing &&
      (existing.sha256 !== sha256 ||
        existing.recordId !== record.id ||
        existing.time !== s.time ||
        existing.capturedAt !== s.capturedAt ||
        existing.frameIndex !== s.frameIndex)
    )
      throw Error("不可覆盖旧证据");
    prepared.push({
      bytes,
      shot: {
        recordId: record.id,
        key,
        file:
          record.id +
          "-" +
          Math.round(s.time * 1000) +
          "-" +
          sha256.slice(0, 12) +
          ".jpg",
        sha256,
        time: s.time,
        frameIndex: s.frameIndex,
        capturedAt: s.capturedAt,
        collectionKind: "initial",
        ...size,
      },
    });
  }
  const attachments = [],
    attached = new Set();
  for (const a of body.attachments || []) {
    const o = record.observations.find((o) => o.id === a.observationId),
      s =
        prepared.find((p) => p.shot.key === a.shotKey)?.shot ||
        index.shots.find((s) => s.key === a.shotKey);
    if (
      !o ||
      !s ||
      s.recordId !== record.id ||
      o.evidenceTime !== s.time ||
      o.frameIndex !== s.frameIndex ||
      attached.has(o.id)
    )
      throw Error("物件和真实截图时点不一致");
    const c = a.crop;
    if (
      !Array.isArray(c) ||
      c.length !== 4 ||
      !c.every(Number.isFinite) ||
      c[0] < 0 ||
      c[1] < 0 ||
      c[2] <= 0 ||
      c[3] <= 0 ||
      c[0] + c[2] > s.width ||
      c[1] + c[3] > s.height
    )
      throw Error("裁切越界");
    if (
      index.attachments.some(
        (x) => x.recordId === record.id && x.observationId === o.id,
      )
    )
      throw Error("已有物件证据请另存更正，不覆盖");
    attached.add(o.id);
    attachments.push({ ...a, recordId: record.id });
  }
  for (const p of prepared) {
    try {
      await fs.writeFile("public/evidence/" + p.shot.file, p.bytes, {
        flag: "wx",
      });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (
        hash(await fs.readFile("public/evidence/" + p.shot.file)) !==
        p.shot.sha256
      )
        throw Error("已有截图文件与SHA-256不一致");
    }
    if (!index.shots.some((x) => x.key === p.shot.key))
      index.shots.push(p.shot);
  }
  index.attachments.push(...attachments);
  await atomic("work/evidence-index.json", index);
  console.log(
    JSON.stringify({ shots: prepared.length, attachments: attachments.length }),
  );
}
function serve() {
  const port = Number(process.env.PORT || 4173);
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ),
        relative =
          pathname === "/" ? "李大霄可视化报告.html" : pathname.slice(1),
        asset = await dashboardAsset(path.join(root, "outputs"), relative);
      res.writeHead(200, {
        "Content-Type": asset.contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
      res.end(asset.bytes);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  server.listen(port, "127.0.0.1", () =>
    console.log("本机演示：http://127.0.0.1:" + port),
  );
}
if (action === "init") await init();
else if (action === "demo") await demo();
else if (action === "report") await report();
else if (action === "import") await importRecord(argument);
else if (action === "prices") await importPrices(argument);
else if (action === "evidence") await evidence(argument);
else if (action === "serve") serve();
else
  console.log(
    "用法：node scripts/cli.mjs init | demo | import <观察.json> | evidence <清单.json> | prices <行情.json> | report | serve",
  );

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RULE_VERSION,
  interpret,
  normalizePrices,
  mergeMinutes,
  backtest,
  intraday,
  featureEvidence,
  semanticEvidence,
  withCloseConfirmation,
} from "../lib/engine.ts";
import {
  decodeScene,
  compareScenes,
  CODEBOOK_VERSION,
  CODEBOOK,
} from "../lib/decoder.ts";
import { recordSchema } from "../lib/schemas.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  statePath = process.env.DAXIAO_STATE_PATH
    ? path.resolve(root, process.env.DAXIAO_STATE_PATH)
    : path.join(root, "work", "monitor-state.json");
if (!statePath.startsWith(path.join(root, "work") + path.sep))
  throw new Error("State must be within workspace work directory");
let state;
try {
  state = JSON.parse(await fs.readFile(statePath, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT")
    throw new Error(
      "Existing archive cannot be read or parsed; no state was replaced",
      { cause: e },
    );
  state = {
    records: [],
    seenIds: [],
    firstCheckAt: null,
    lastCheck: null,
    status: "待首次运行",
    channel: "local",
    dataset: null,
  };
}
const args = process.argv.slice(2),
  action = args[0] || "read";
let body = {};
if (args[1]) {
  const resolved = path.resolve(root, args[1]);
  if (!resolved.startsWith(root + path.sep))
    throw new Error("Input must be within this workspace");
  body = JSON.parse(await fs.readFile(resolved, "utf8"));
}
const persist = async () => {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tmp = statePath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, statePath);
};
if (action === "record") {
  const raw = body.record || body;
  const qualification = body.modelEligibility || raw.modelEligibility;
  if (
    qualification &&
    !["sourceVerified", "everyday", "coauth"].every(
      (k) => typeof qualification[k] === "boolean",
    )
  )
    throw Error(
      "Model eligibility requires explicit sourceVerified, everyday and coauth booleans",
    );
  const p = recordSchema.parse({
    ...raw,
    sourceType: raw.sourceType || "original",
  });
  if (
    !/^https:\/\/www\.douyin\.com\/video\/\d+$/.test(p.url) ||
    new Date(p.publishedAt) > new Date()
  )
    throw new Error("Verified video URL and publication timestamp required");
  const id = "douyin-" + p.url.split("/").at(-1);
  if (state.records.some((r) => r.id === id)) {
    process.stdout.write(JSON.stringify({ inserted: false, id }) + "\n");
    process.exit(0);
  }
  const prior = state.records
    .filter((r) => new Date(r.publishedAt) < new Date(p.publishedAt))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  const createdAt = new Date().toISOString(),
    r = {
      ...p,
      id,
      createdAt,
      ruleVersion: RULE_VERSION,
      signal: interpret(
        p.observations,
        p.market,
        RULE_VERSION,
        p.semanticCandidates,
      ),
      decoding: decodeScene(
        p.observations,
        { market: p.market, visibleText: p.visibleText, coverage: p.coverage },
        p.semanticCandidates,
      ),
      comparison: prior
        ? {
            previousId: prior.id,
            ...compareScenes(
              prior.observations,
              p.observations,
              prior.coverage || "partial",
              p.coverage || "partial",
            ),
          }
        : null,
      notifiedAt: raw.baseline ? createdAt : null,
    };
  state.records.unshift(r);
  state.seenIds = [...new Set([...state.seenIds, id.replace("douyin-", "")])];
  await persist();
  if (qualification) {
    const metaPath = path.join(
      path.dirname(statePath),
      "model-eligibility.json",
    );
    let metadata;
    try {
      metadata = JSON.parse(await fs.readFile(metaPath, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      metadata = { items: [] };
    }
    if (metadata.items.some((m) => m.id === id))
      throw Error("Model eligibility already exists; do not overwrite");
    metadata.items.push({
      id,
      sourceVerified: qualification.sourceVerified,
      everyday: qualification.everyday,
      coauth: qualification.coauth,
      verifiedAt: createdAt,
      note: String(qualification.note || ""),
    });
    await fs.writeFile(metaPath + ".tmp", JSON.stringify(metadata, null, 2));
    await fs.rename(metaPath + ".tmp", metaPath);
  }
  process.stdout.write(
    JSON.stringify({ inserted: true, id, codebookVersion: CODEBOOK_VERSION }) +
      "\n",
  );
} else if (action === "decode") {
  const id = String(body.id || "");
  const r = state.records.find((r) => r.id === id);
  if (!r) throw new Error("Record not found");
  process.stdout.write(
    JSON.stringify(
      {
        id,
        originalRuleVersion: r.ruleVersion,
        reviewedAt: new Date().toISOString(),
        kind: "新版本另行复盘，不覆盖原记录",
        decoding: decodeScene(
          body.observations || r.observations,
          {
            market: r.market,
            visibleText: r.visibleText,
            coverage: r.coverage || "partial",
          },
          body.semanticCandidates || r.semanticCandidates,
        ),
      },
      null,
      2,
    ) + "\n",
  );
} else if (action === "codebook") {
  process.stdout.write(
    JSON.stringify({ version: CODEBOOK_VERSION, rules: CODEBOOK }, null, 2) +
      "\n",
  );
} else if (action === "status") {
  state.lastCheck = new Date().toISOString();
  state.firstCheckAt ||= state.lastCheck;
  state.status = String(body.status || "检查完成");
  state.detail = String(body.detail || "");
  state.seenIds = [...new Set([...state.seenIds, ...(body.seenIds || [])])];
  if (body.email) state.email = body.email;
  await persist();
  process.stdout.write(
    JSON.stringify({
      status: state.status,
      lastCheck: state.lastCheck,
      seenCount: state.seenIds.length,
    }) + "\n",
  );
} else if (action === "notified") {
  const r = state.records.find((r) => r.id === body.id);
  if (!r) throw new Error("Record not found");
  r.notifiedAt = new Date().toISOString();
  await persist();
  process.stdout.write('{"ok":true}\n');
} else if (action === "market") {
  if (state.synthetic)
    throw Error("合成演示目录禁止混入真实行情，请使用独立目录");
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
    source = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,2024-01-01,${date},640,qfq`;
  const [daily, minute] = await Promise.allSettled([
    fetch(source, { signal: AbortSignal.timeout(12000) }).then((r) => r.json()),
    fetch("https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh000001", {
      signal: AbortSignal.timeout(12000),
    }).then((r) => r.json()),
  ]);
  if (daily.status !== "fulfilled")
    throw new Error("Daily market data unavailable");
  const rows = daily.value.data?.sh000001?.day;
  if (daily.value.code !== 0 || !Array.isArray(rows))
    throw new Error("Invalid daily market data");
  const prices = normalizePrices(
    rows.map((r) => ({ date: r[0], open: Number(r[1]), close: Number(r[2]) })),
  );
  let minutes = [];
  if (minute.status === "fulfilled") {
    const m = minute.value.data?.sh000001?.data;
    if (/^\d{8}$/.test(m?.date) && Array.isArray(m.data)) {
      const d =
        m.date.slice(0, 4) + "-" + m.date.slice(4, 6) + "-" + m.date.slice(6);
      minutes = m.data.map((r) => {
        const [t, p] = r.split(" ");
        return {
          timestamp: `${d}T${t.slice(0, 2)}:${t.slice(2)}:00+08:00`,
          close: Number(p),
        };
      });
    }
  }
  state.dataset = {
    prices,
    minutes: mergeMinutes(state.dataset?.minutes || [], minutes),
    source,
    complete: true,
    updatedAt: new Date().toISOString(),
  };
  await persist();
  process.stdout.write(
    JSON.stringify({
      prices: prices.length,
      minutes: state.dataset.minutes.length,
      lastDate: prices.at(-1)?.date,
    }) + "\n",
  );
} else if (action === "read") {
  const prices = withCloseConfirmation(
      state.dataset?.prices || [],
      state.dataset?.updatedAt,
    ),
    result = backtest(
      state.records,
      prices,
      new Date().toISOString(),
      state.dataset?.minutes || [],
    ),
    relations = featureEvidence(state.records, prices);
  process.stdout.write(
    JSON.stringify(
      {
        ...state,
        dataset: state.dataset
          ? {
              source: state.dataset.source,
              updatedAt: state.dataset.updatedAt,
              priceCount: prices.length,
              minuteCount: state.dataset.minutes.length,
            }
          : null,
        records: state.records.slice(0, 30),
        summary: {
          prospective: result.prospective,
          retrospective: result.retrospective,
        },
        results: result.results.slice(0, 30).map((r) => ({
          id: r.record.id,
          title: r.record.title,
          publishedAt: r.record.publishedAt,
          targetDate: r.targetDate,
          ret1: r.ret1,
          ret3: r.ret3,
          ret5: r.ret5,
          riskHit: r.riskHit,
          prospective: r.prospective,
          signal: r.signal,
          sameDay: r.sameDay,
          timing: r.timing,
          evaluationVersion: r.evaluationVersion,
          intraday: intraday(
            r.record.publishedAt,
            state.dataset?.minutes || [],
            prices,
          ),
        })),
        relations,
        semanticRelations: semanticEvidence(state.records, prices),
      },
      null,
      2,
    ) + "\n",
  );
} else if (action === "report") {
  const prices = withCloseConfirmation(
      state.dataset?.prices || [],
      state.dataset?.updatedAt,
    ),
    result = backtest(
      state.records,
      prices,
      new Date().toISOString(),
      state.dataset?.minutes || [],
    );
  const fmt = (v) =>
    new Date(v).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
    });
  const pct = (v) =>
    v == null
      ? "待验证 / 缺数据"
      : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
  let out = "# 李大霄背景观察：观察与发布后行情验证\n\n";
  out +=
    "新版已改为名称、谐音、数量、动作与组合解码。旧记录保留原答案与规则版本；新版方案见“暗语解码方案与示例.md”。\n\n";
  out +=
    "本工具可由外部调度器每30分钟调用，通知在当前聊天。通知由调用方配置。记录 " +
    state.records.length +
    " 条已核实作品链接的局部画面。近30天范围与选取方法见可视化报告及近30天回测整理说明，不能估计可靠预测准确率。\n\n";
  for (const r of result.results) {
    const m = intraday(
      r.record.publishedAt,
      state.dataset?.minutes || [],
      prices,
    );
    out += `## ${r.record.title}\n\n原视频：[查看作品](${r.record.url})。发布时间 ${fmt(r.record.publishedAt)}（北京时间）；本机锁定 ${fmt(r.record.createdAt)}；规则 ${r.record.ruleVersion}。\n\n`;
    for (const o of r.record.observations || [])
      out += `- 可见证据：${o.description}\n`;
    out += `\n寓意候选：${r.signal.reason}\n\n${r.record.notes || ""}\n\n|窗口|上证指数变化|\n|---|---|\n${r.sameDay ? `|当天收盘 ${r.sameDay.date}|${r.sameDay.index === null ? r.sameDay.reason : r.sameDay.index.toFixed(2) + "点"}|\n|当日涨跌（相对前收）|${pct(r.sameDay.dailyReturn)}|\n|发布后对应报价至收盘|${pct(r.sameDay.postPublicationReturn)}|\n` : ""}|发布后60交易分钟|${pct(m.ret60)}|\n|发布后180交易分钟|${pct(m.ret180)}|\n|下一交易日 ${r.targetDate || ""}|${pct(r.ret1)}|\n|3交易日|${pct(r.ret3)}|\n|5交易日|${pct(r.ret5)}|\n\n5日风险代理：${r.riskHit == null ? "待验证或不适用" : r.riskHit ? "出现至少2%收盘回撤" : "未出现至少2%收盘回撤"}。${r.status === "pending" ? "目标行情未完成，解读已留存，暂不记录命中或失败。" : r.prospective ? "在目标交易日开盘前锁定；继续积累事前样本。" : "只作事后复盘，不能算作事前命中。"}\n\n`;
  }
  out +=
    "## 可信度与口径\n\n物件辨认与寓意推断分开。作者是否确实使用这些道具表达该寓意，尚未获本人确认。地球可指海外风险，绿色可只是植物常态。次日指发布日后的首个完整交易日；盘中分钟按交易时段计算，排除午休，缺失窗口不评分。顶部风险用未来5日内至少2%收盘回撤作为预设代理。旧解读不覆盖，新规则仅可用于之后样本。\n\n日线和分钟线：[腾讯公开指数接口](" +
    state.dataset?.source +
    ")，抓取于 " +
    fmt(state.dataset?.updatedAt) +
    "。历史分钟线未取得，不用日线替代。公开报道也将盆栽预测称为网友解读：[澎湃号报道](https://www.thepaper.cn/newsDetail_forward_29494013)。\n\n图文网页版见同目录“李大霄可视化报告.html”，包含真实截图、每条视频总结论与15:00分界收盘验证。图文报告是生成时快照；本机自动任务更新档案后重新生成。此报告是生成时的本机快照。\n";
  const file = path.join(root, "outputs", "首次背景解读与验证.md");
  await fs.writeFile(file, out, "utf8");
  process.stdout.write(
    JSON.stringify({ report: file, records: state.records.length }) + "\n",
  );
  try {
    await fs.access(path.join(root, "work", "evidence-index.json"));
    await import("./visual-report.mjs");
  } catch (e) {
    console.error("可视化报告生成失败：" + e.message);
    process.exitCode = 1;
  }
} else
  throw new Error(
    "Supported actions: read, record, decode, codebook, status, notified, market, report",
  );

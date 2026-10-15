import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { decodeScene } from "../lib/decoder.ts";
import { interpret, RULE_VERSION } from "../lib/engine.ts";
export async function createDemo(root) {
  const prices = [],
    records = [],
    metadata = [],
    shots = [],
    attachments = [];
  let close = 3200;
  const now = new Date().toISOString();
  for (
    let d = new Date("2026-01-02T00:00:00Z"), j = 0;
    j < 68;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    if ([0, 6].includes(d.getUTCDay())) continue;
    const date = d.toISOString().slice(0, 10);
    close *= 1 + (j % 3 === 0 ? 0.012 : j % 3 === 1 ? -0.008 : 0.004);
    prices.push({ date, open: close * 0.998, close: Number(close.toFixed(2)) });
    if (j < 64) {
      const id = "demo-" + String(j).padStart(3, "0"),
        pub = date + "T18:00:00+08:00",
        color = j % 2 ? "green" : "red";
      const observations = [
        {
          id: id + "-plant",
          label: color + "_plant",
          name: color === "green" ? "绿叶盆栽（合成）" : "红花盆栽（合成）",
          kind: "plant",
          colors: [color],
          count: 1,
          position: "右下",
          description: "程序生成的示意盆栽，没有对应真实视频。",
          frameIndex: 0,
          evidenceTime: 4,
          verified: true,
          confidence: 1,
        },
        {
          id: id + "-bear",
          label: "bear",
          name: "普通熊玩具（合成）",
          kind: "toy",
          colors: ["white"],
          count: 1,
          position: "右侧",
          description: "程序生成的白熊示意。",
          frameIndex: 0,
          evidenceTime: 4,
          verified: true,
          confidence: 1,
        },
      ];
      if (j % 4 !== 0)
        observations.push({
          id: id + "-globe",
          label: "globe",
          name: "地球仪（合成）",
          kind: "object",
          colors: ["blue"],
          count: 1,
          position: "熊头顶",
          description: "示意地球位于熊头顶，同帧关系来自合成布局。",
          frameIndex: 0,
          evidenceTime: 4,
          verified: true,
          confidence: 1,
          relations: [
            { type: "on_top_of", targetId: id + "-bear", verified: true },
          ],
        });
      const r = {
        id,
        title:
          "合成演示 " +
          (j + 1) +
          " · " +
          (color === "green" ? "绿植与普通熊" : "红花与普通熊"),
        url: "https://example.org/xiaoxi-demo/" + id,
        publishedAt: pub,
        createdAt: now,
        timeVerified: true,
        sourceType: "original",
        market: "a-share",
        coverage: "partial",
        imported: true,
        observations,
        visibleText: ["合成演示，非真实视频"],
        notes:
          "合成数据仅供验证软件运行，观察、时间与价格不代表真实发布或交易。",
        ruleVersion: RULE_VERSION,
        notifiedAt: now,
      };
      r.signal = interpret(observations, r.market, RULE_VERSION);
      r.decoding = decodeScene(observations, {
        market: r.market,
        coverage: r.coverage,
      });
      records.push(r);
      metadata.push({
        id,
        sourceVerified: true,
        everyday: true,
        coauth: false,
        verifiedAt: now,
        note: "合成资格，只在演示数据中存在。",
      });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#edf1e7"/><rect x="160" y="72" width="802" height="463" rx="20" fill="#faf7ed"/><text x="235" y="180" font-size="34" fill="#284738">霄息 · 合成画面</text><text x="235" y="230" font-size="20" fill="#657666">不是李大霄真实视频截图</text><ellipse cx="816" cy="424" rx="88" ry="95" fill="white" stroke="#b1bbb0"/><circle cx="816" cy="340" r="60" fill="white" stroke="#b1bbb0"/><circle cx="775" cy="290" r="22" fill="white" stroke="#b1bbb0"/><circle cx="857" cy="290" r="22" fill="white" stroke="#b1bbb0"/><circle cx="797" cy="337" r="5"/><circle cx="835" cy="337" r="5"/><ellipse cx="816" cy="359" rx="10" ry="8" fill="#8a6c51"/>${j % 4 !== 0 ? '<circle cx="816" cy="246" r="31" fill="#7eb9d3"/><path d="M800 223l20 8-8 27 18 13" fill="#719568"/>' : ""}<rect x="877" y="478" width="47" height="51" rx="6" fill="#ded8cb"/><path d="M900 479v-66m0 24q-35-34-40-15q10 26 40 22m0 9q26-43 34-16q-12 26-34 20" fill="${color === "green" ? "#3e8552" : "#b95148"}" stroke="${color === "green" ? "#3e8552" : "#b95148"}" stroke-width="5"/><text x="235" y="475" font-size="22" fill="#284738">仅演示功能 · 无预测意义</text></svg>`;
      const bytes = Buffer.from(svg),
        sha256 = createHash("sha256").update(bytes).digest("hex"),
        file = id + ".svg",
        key = id.replace("-", "_");
      await fs.writeFile(path.join(root, "public/evidence", file), bytes);
      shots.push({
        recordId: id,
        key,
        file,
        sha256,
        time: 4,
        capturedAt: now,
        collectionKind: "initial",
        width: 1280,
        height: 720,
        synthetic: true,
      });
      for (const o of observations)
        attachments.push({
          recordId: id,
          observationId: o.id,
          shotKey: key,
          crop: o.label.includes("plant")
            ? [858, 405, 76, 126]
            : o.label === "globe"
              ? [782, 210, 72, 73]
              : [724, 279, 184, 250],
        });
    }
    j++;
  }
  await fs.writeFile(
    path.join(root, "work/monitor-state.json"),
    JSON.stringify(
      {
        synthetic: true,
        records,
        seenIds: records.map((r) => r.id),
        channel: "local",
        status: "合成演示",
        dataset: {
          prices,
          minutes: [],
          source: "合成价格，非真实指数行情",
          updatedAt: now,
          complete: true,
        },
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(root, "work/model-eligibility.json"),
    JSON.stringify({ items: metadata }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "work/evidence-index.json"),
    JSON.stringify({ shots, attachments }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "work/report-conclusions.json"),
    JSON.stringify({ items: [] }, null, 2),
  );
}

import fs from "node:fs/promises";
import { publicationWindow } from "../lib/publication-window.mjs";
const state = JSON.parse(await fs.readFile("work/monitor-state.json", "utf8")),
  end = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
  result = publicationWindow(state.records, { end });
const clock = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
await fs.writeFile(
  "work/publication-window.json",
  JSON.stringify(
    {
      ...result,
      generatedAt: new Date().toISOString(),
      operationalWindow: {
        from: "07:00",
        through: "23:30",
        intervalMinutes: 30,
        status: "依据现有样本试行；年度补录后复核",
      },
    },
    null,
    2,
  ),
);
await fs.writeFile(
  "outputs/发布时间与检查时段.md",
  `# 霄息 · 发布时间与检查时段\n\n统计范围2026-01-01至${end}，已核实本人原发${result.verifiedOriginals}条。档案目前覆盖${result.coveredDates.length}个发布日期，尚不是全年完整记录。\n\n最早${clock(result.firstMinute)}，最晚${clock(result.lastMinute)}。22:00–次日08:00已有${result.overnight.length}条，不能关闭整个时段。先按北京时间07:00–23:30每30分钟检查；夜间其余时间暂停，早上首轮仍按作品ID查补漏。年度补录后继续复核。\n\n|小时|已核实作品数|\n|---|---:|\n${result.hours.map((h) => `|${String(h.hour).padStart(2, "0")}:00|${h.count}|`).join("\n")}\n\n## 22:00–08:00实际发布记录\n\n${result.overnight.map((r) => `- ${r.local.slice(0, 16).replace("T", " ")} [${r.title}](${r.url})`).join("\n")}\n\n${result.coverageCaveat}\n`,
);
console.log(
  JSON.stringify({
    originals: result.verifiedOriginals,
    overnight: result.overnight.length,
    earliest: clock(result.firstMinute),
    latest: clock(result.lastMinute),
  }),
);

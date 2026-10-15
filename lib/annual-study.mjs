import { localDate } from "./engine.ts";
export function buildAnnualStudy(selection, items, metadata, backgroundStudy) {
  if (!selection) return null;
  const byId = new Map(
      items.map((i) => [i.record.id.replace("douyin-", ""), i]),
    ),
    qualified = new Map(metadata.map((m) => [m.id, m]));
  const selected = selection.selected.map((s) => {
    const i = byId.get(s.id),
      m = i && qualified.get(i.record.id);
    return {
      ...s,
      publishedAt: i?.record.publishedAt ?? null,
      archived: !!i,
      hasVisual: !!i?.shots?.length,
      everyday: m?.everyday ?? null,
      sourceVerified: m?.sourceVerified ?? null,
      excluded: !!i && (!m?.everyday || m.coauth || !m.sourceVerified),
      hasProbability: i?.currentModelView?.pDown != null,
    };
  });
  const months = Array.from(
    { length: Number(selection.end.slice(5, 7)) },
    (_, j) => {
      const month =
          selection.start.slice(0, 4) + "-" + String(j + 1).padStart(2, "0"),
        rows = selected.filter((s) => s.publishedAt?.startsWith(month));
      return {
        month,
        selectedArchived: rows.length,
        eligibleBackgrounds: rows.filter((s) => !s.excluded).length,
        excluded: rows.filter((s) => s.excluded).length,
        firstDate:
          rows.map((s) => s.publishedAt.slice(0, 10)).sort()[0] || null,
      };
    },
  );
  return {
    version: selection.version,
    start: selection.start,
    end: selection.end,
    method: selection.method,
    candidateCount: selection.candidateCount,
    profileCoauth: selection.profileCoauth,
    selectedCount: selected.length,
    archived: selected.filter((s) => s.archived).length,
    withVisual: selected.filter((s) => s.hasVisual).length,
    withoutVisual: selected.filter((s) => s.archived && !s.hasVisual).length,
    pending: selected.filter((s) => !s.archived).length,
    excluded: selected.filter((s) => s.excluded).length,
    selected,
    months,
    trainingDays: backgroundStudy?.samples.length ?? 0,
    validation: backgroundStudy?.validation ?? null,
    firstCompletedProspective:
      backgroundStudy?.firstEstimatesSummary?.completedTargetDays ?? 0,
    status: selected.every((s) => s.archived)
      ? "固定抽样链接已核查；缺画面条目不作背景解读；不是全年全量"
      : "系统抽样补录中；未核实月份留空",
    caveat:
      "候选清单按可见主页顺序取得，发布时间只对抽样/既有存档逐条核实。系统抽样是历史研究，不代表全年每条作品均已解析，不能算前瞻成绩。",
  };
}
export function annualMarkdown(s) {
  if (!s) return "";
  const v = s.validation,
    pc = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%");
  return `# 大霄译站 · 2026年度抽样训练\n\n研究范围${s.start}至${s.end}。${s.status}。\n\n${s.method}\n\n可见候选链接${s.candidateCount}条，其中主页标共创${s.profileCoauth}条未作为新抽样候选；固定选取${s.selectedCount}条，已存档${s.archived}条、待核实${s.pending}条、已核实不适用${s.excluded}条；${s.withVisual}条有真实截图、${s.withoutVisual}条缺画面。缺画面不提供背景结论或训练概率。\n\n## 实际月份覆盖\n\n|月份|抽样已存档|合格日常背景|不适用|\n|---|---:|---:|---:|\n${s.months.map((m) => `|${m.month}|${m.selectedArchived}|${m.eligibleBackgrounds}|${m.excluded}|`).join("\n")}\n\n未有样本的月份不是零发布。${s.caveat}\n\n## 当前训练与历史检验\n\n包含既有档案与本次已冻结观察，按上证目标日去重后${s.trainingDays}个训练日。时间推进验证${v?.hits ?? 0}/${v?.n ?? 0}，符合比例${pc(v?.accuracy)}；始终猜涨${pc(v?.alwaysUp)}、始终猜跌${pc(v?.alwaysDown)}。当前模型重看旧图不算历史命中。独立前瞻实验已完成${s.firstCompletedProspective}个目标日。\n\n参数固定、未按此验证结果搜索；概率未校准，历史特征目录在行情公开后建立，不足以证明作者本意或可靠预测能力。所有原记录和各版本首次判断保留。\n`;
}

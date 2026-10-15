// Derived type resolution only. Original names and verified observations are immutable.
import {
  currentInterpretation,
  extractFeatures,
} from "./current-interpretation.mjs";
export const TYPE_RESOLUTION_VERSION = "verified-label-types-2026-10-15-v1";
const names = {
  cherry: "樱桃",
  peach: "桃子",
  pear: "梨",
  hat: "草帽",
  turtle: "乌龟",
  globe: "地球仪",
  globe_on_top: "地球仪",
  bull: "牛",
  bear: "熊",
  panda: "熊猫",
  horse: "马",
  foam: "泡沫",
};
export function typedObservations(observations) {
  return observations.map((o) => {
    const originalName = o.name,
      canonical = names[o.label];
    if (!canonical) return { ...o };
    // An incompatible explicit identity is a review item, not permission to infer a bear.
    const pandaName =
      /熊猫|panda/i.test(originalName || "") &&
      !/非熊猫|不是熊猫|排除熊猫/.test(originalName || "");
    if (o.label === "bear" && pandaName)
      return {
        ...o,
        verified: false,
        originalName,
        typeIssue: "普通熊标签与熊猫名称冲突，待复核",
      };
    return {
      ...o,
      originalName,
      name: canonical,
      typeResolution: TYPE_RESOLUTION_VERSION,
    };
  });
}
export function extractTypedFeatures(observations) {
  const f = extractFeatures(typedObservations(observations));
  const ids = new Set(
    f.nodes
      .filter(
        (o) =>
          !o.colors.some((c) =>
            [
              "red",
              "purple",
              "pink",
              "white",
              "yellow",
              "orange",
              "blue",
              "gold",
            ].includes(c),
          ),
      )
      .map((o) => o.id),
  );
  f.anchors.green_plant = f.anchors.green_plant.filter((id) => ids.has(id));
  f.values[0] = Number(f.anchors.green_plant.length > 0);
  return f;
}
export function typedInterpretation(
  observations,
  market,
  coverage = "partial",
  candidates = [],
) {
  const result = currentInterpretation(
      typedObservations(observations),
      market,
      coverage,
      candidates,
    ),
    features = extractTypedFeatures(observations);
  result.matches = result.matches.flatMap((m) => {
    if (m.id !== "green-down-v3") return [m];
    const evidenceIds = m.evidenceIds.filter((id) =>
      features.anchors.green_plant.includes(id),
    );
    return evidenceIds.length ? [{ ...m, evidenceIds }] : [];
  });
  const dirs = [...result.matches, ...result.candidates].filter(
      (m) => m.bias !== "unknown",
    ),
    up = dirs.some((m) => m.bias === "bullish"),
    down = dirs.some((m) =>
      ["bearish", "defensive", "weakness"].includes(m.bias),
    );
  result.bias =
    up && down ? "mixed" : down ? "bearish" : up ? "bullish" : "unknown";
  result.headline =
    result.bias === "bearish"
      ? "暗语倾向：偏空／警惕调整"
      : result.bias === "bullish"
        ? "暗语倾向：偏多／转强候选"
        : result.bias === "mixed"
          ? "暗语倾向：多空线索冲突"
          : "暗语倾向：暂无线索支持涨跌";
  result.summary =
    (dirs.map((m) => m.cue + " → " + m.meaning).join("；") ||
      "当前确认物件只支持语境或装饰解释。") +
    (features.pandaIds.length
      ? " 熊猫仅作中国资产／A股语境候选，未计入偏空票数。"
      : "") +
    " 未给出明确时间的物件暗语不自动译成明日方向。";
  return {
    ...result,
    features,
    typeResolutionVersion: TYPE_RESOLUTION_VERSION,
    typeResolutionNote:
      "具体名称原样留存；已核实类别用于匹配对应规则，有其他明确花/叶色的植物不作为纯绿；棕色枝干不排除绿叶。旧语义记录未覆盖。",
  };
}

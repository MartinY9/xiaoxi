import { decodeScene, sceneGraph } from "./decoder.ts";

export const USER_PRIOR_VERSION = "user-symbol-priors-2026-10-14-v3";
export const PRIOR_ESTABLISHED_AT = "2026-10-14T03:29:36.000Z";
export const FEATURES = Object.freeze([
  { id: "green_plant", name: "确认的纯绿植物" },
  { id: "red_plant", name: "确认的红色植物" },
  { id: "bear", name: "普通熊玩具（排除熊猫）" },
  { id: "globe_top", name: "同帧确认的地球置顶" },
  { id: "bull_on_horse", name: "同帧确认牛在马背上" },
  { id: "escape", name: "樱桃／摘桃／梨离开候选" },
  { id: "withered", name: "确认枯萎植物" },
  { id: "inverted_bull", name: "确认牛倒立" },
  { id: "globe_bubble", name: "确认泡沫包裹地球" },
]);

export function extractFeatures(observations) {
  const nodes = sceneGraph(observations),
    decoded = decodeScene(observations),
    matches = decoded.matches;
  const anchored = {};
  const set = (id, ids) => {
    anchored[id] = [...new Set(ids)];
  };
  const plants = nodes.filter(
    (o) =>
      o.name === "plant" ||
      ["green_plant", "red_plant", "withered_plant"].includes(o.label) ||
      o.kind === "plant",
  );
  set(
    "green_plant",
    plants
      .filter((o) => o.colors.includes("green") && !o.colors.includes("red"))
      .map((o) => o.id),
  );
  set(
    "red_plant",
    plants.filter((o) => o.colors.includes("red")).map((o) => o.id),
  );
  set(
    "bear",
    nodes
      .filter(
        (o) =>
          (o.name === "bear" || o.label === "bear") &&
          o.name !== "panda" &&
          o.label !== "panda",
      )
      .map((o) => o.id),
  );
  for (const [feature, rules] of Object.entries({
    globe_top: ["globe-top"],
    bull_on_horse: ["bull-on-horse"],
    escape: ["cherry-escape", "pick-peach", "peach-escape", "pear-leave"],
    withered: ["withered-plant"],
    inverted_bull: ["inverted-bull"],
    globe_bubble: ["globe-bubble"],
  }))
    set(
      feature,
      matches.filter((m) => rules.includes(m.id)).flatMap((m) => m.evidenceIds),
    );
  return {
    version: USER_PRIOR_VERSION,
    values: FEATURES.map((f) => Number(anchored[f.id].length > 0)),
    anchors: anchored,
    pandaIds: nodes.filter((o) => o.name === "panda").map((o) => o.id),
    nodes,
    decoded,
    missingMeaning: "0表示本次采样未确认该线索，不表示完整视频里一定不存在。",
  };
}

export function currentInterpretation(
  observations,
  market,
  coverage = "partial",
  candidates = [],
) {
  const f = extractFeatures(observations),
    decoded = decodeScene(observations, { market, coverage }, candidates),
    chain = decoded.matches.filter(
      (m) => !["panda-bear", "bear-candidate", "green-plant"].includes(m.id),
    );
  const add = (id, cue, mechanism, meaning, bias, ids, alternatives) =>
    chain.push({
      id,
      cue,
      mechanism,
      meaning,
      bias,
      evidenceIds: ids,
      meaningConfidence: "用户先验 / 作者本意未确认",
      alternatives,
      source: { type: "user-hypothesis", title: "用户于2026-10-14提出的解释" },
    });
  if (f.pandaIds.length)
    add(
      "panda-context-v3",
      "熊猫摆件",
      "国宝／中国资产 → A股语境候选",
      "优先用来解释市场范围，不单凭熊猫判涨跌。",
      "unknown",
      f.pandaIds,
      ["常驻装饰、生活玩偶", "中国资产不一定专指上证指数"],
    );
  if (f.anchors.bear.length)
    add(
      "bear-market-v3",
      "普通熊玩具",
      "熊 → 熊市／偏空",
      "偏空、警惕调整；这是检验假设，尚不能指定明日必跌。",
      "bearish",
      f.anchors.bear,
      ["常驻玩具或摆设", "名称联想不等于作者明示"],
    );
  if (f.anchors.green_plant.length)
    add(
      "green-down-v3",
      "纯绿植物",
      "A股绿色 → 下跌",
      "按用户先验解读为偏空／下跌提示。",
      "bearish",
      f.anchors.green_plant,
      ["植物的自然颜色", "装饰与话题无关"],
    );
  const dirs = [...chain, ...decoded.candidates].filter(
      (m) => m.bias !== "unknown",
    ),
    up = dirs.some((m) => m.bias === "bullish"),
    down = dirs.some((m) =>
      ["bearish", "defensive", "weakness"].includes(m.bias),
    );
  const bias =
    up && down ? "mixed" : down ? "bearish" : up ? "bullish" : "unknown";
  const scope =
    market === "a-share"
      ? "A股话题已核实"
      : market === "global"
        ? "全球话题已核实；熊猫语境不替代市场范围"
        : market === "hk"
          ? "港股话题已核实；A股指数适用未核实"
          : f.pandaIds.length
            ? "熊猫支持中国资产／A股语境候选，范围仍待核实"
            : "范围未核实";
  const headline =
    bias === "bearish"
      ? "暗语倾向：偏空／警惕调整"
      : bias === "bullish"
        ? "暗语倾向：偏多／转强候选"
        : bias === "mixed"
          ? "暗语倾向：多空线索冲突"
          : "暗语倾向：暂无线索支持涨跌";
  const decisive = dirs.map((m) => m.cue + " → " + m.meaning).join("；");
  return {
    version: USER_PRIOR_VERSION,
    establishedAt: PRIOR_ESTABLISHED_AT,
    bias,
    headline,
    scope,
    summary:
      (decisive || "当前确认物件只支持语境或装饰解释。") +
      (f.pandaIds.length
        ? " 熊猫仅作中国资产／A股语境候选，未计入偏空票数。"
        : "") +
      " 未给出明确时间的物件暗语不自动译成明日方向。",
    matches: chain,
    candidates: decoded.candidates,
    features: f,
    confidence: "语义：用户先验，未获作者确认",
    coverage,
    isReinterpretation: true,
  };
}

export const CODEBOOK_VERSION = "symbolic-codebook-2026-10-13-v2";
export const ARTICLE_SOURCE = {
  title: "李大霄再放“摘桃”暗语！",
  url: "https://zhuanlan.zhihu.com/p/2053026762821474298",
  author: "数码网",
  editedAt: "2026-06-24",
  type: "commentary",
};
const fanSource = {
  title: "李大霄背景摆件的网友解读",
  url: "https://caifuhao.eastmoney.com/news/20250915143915858975850",
  type: "commentary",
};
export type Relation = {
  type: string;
  targetId?: string;
  targetName?: string;
  verified?: boolean;
};
export type SceneObservation = {
  id?: string;
  label: string;
  name?: string;
  kind?: string;
  colors?: string[];
  count?: number;
  position?: string;
  orientation?: string;
  actions?: string[];
  relations?: Relation[];
  visibleText?: string[];
  description: string;
  confidence: number;
  frameIndex: number;
  evidenceTime?: number;
  verified: boolean;
};
export type SemanticCandidate = {
  id: string;
  cue: string;
  evidenceIds: string[];
  mechanism: string;
  meaning: string;
  bias: "bullish" | "bearish" | "defensive" | "weakness" | "unknown";
  scope: string;
  horizon: string;
  confidence: "low" | "medium";
  alternatives: string[];
  source?: { title: string; url: string };
};
type Rule = {
  id: string;
  cue: string;
  mechanism: string;
  meaning: string;
  bias: "bullish" | "bearish" | "defensive" | "weakness";
  horizon: string;
  scope: string;
  priority: number;
  match: string;
  support: "user_example" | "reported" | "inferred";
  source: { title: string; url: string; type?: string };
  alternatives: string[];
};
export const CODEBOOK: Rule[] = [
  {
    id: "cherry-escape",
    cue: "樱桃",
    mechanism: "樱桃（yīng táo）→ 应逃（yīng táo）",
    meaning: "提示回避高位风险、转为防守；不自动等同于次日大盘必跌。",
    bias: "defensive",
    horizon: "未明确；风险提醒",
    scope: "需结合字幕区分大盘、板块或海外",
    priority: 100,
    match: "cherry",
    support: "user_example",
    source: ARTICLE_SOURCE,
    alternatives: ["普通水果照片或生活分享；需结合发布语境与历史同类画面。"],
  },
  {
    id: "pick-peach",
    cue: "摘桃动作 / 手指向桃子",
    mechanism: "桃 → 逃；摘取果实 → 收取成果",
    meaning: "可能在提示落袋为安、从进攻转防御，尤其关注已上涨较多的部分。",
    bias: "defensive",
    horizon: "未明确；阶段性",
    scope: "需结合上下文，不默认全面看空",
    priority: 110,
    match: "pick_peach",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["真实采摘或介绍水果；手势可能只是指认物件。"],
  },
  {
    id: "peach-escape",
    cue: "桃子",
    mechanism: "桃（táo）→ 逃（táo）",
    meaning: "避险或离场候选；出现摘取动作时，收取成果的含义更强。",
    bias: "defensive",
    horizon: "未明确",
    scope: "待上下文确定",
    priority: 85,
    match: "peach",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["单独桃子也可能只是生活道具。"],
  },
  {
    id: "globe-top",
    cue: "地球仪实际置于其他物件顶部",
    mechanism: "地球 + 顶部位置 → 地球顶",
    meaning: "顶部或高位风险候选；需要结合市场范围和其他物件进一步解码。",
    bias: "defensive",
    horizon: "未明确；短期或阶段性",
    scope: "地球可能指全球；A股需上下文支持",
    priority: 95,
    match: "globe_top",
    support: "user_example",
    source: {
      title: "用户提供的地球置顶暗语示例",
      url: "",
      type: "user_example",
    },
    alternatives: ["道具固定摆放或支撑方式；长期不变时可能只是持续提示。"],
  },
  {
    id: "globe-bubble",
    cue: "泡沫包裹地球仪",
    mechanism: "泡沫 + 地球 → 全球资产泡沫",
    meaning: "可能提示海外或全球市场估值风险，不直接推导A股次日下跌。",
    bias: "defensive",
    horizon: "未明确；阶段性",
    scope: "海外 / 全球优先",
    priority: 100,
    match: "globe_foam",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["保护地球仪的包装材料；需确认泡沫确实包裹该物件。"],
  },
  {
    id: "inverted-bull",
    cue: "牛摆件倒挂或倒立",
    mechanism: "牛 + 回头 / 反向姿态 → 牛回头",
    meaning: "牛市中的回撤、调整或上方压力候选；不直接等同于长期熊市。",
    bias: "bearish",
    horizon: "未明确；短期调整候选",
    scope: "大盘或局部行情待上下文确认",
    priority: 100,
    match: "inverted_bull",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["摆件姿态不清，或镜头/照片旋转造成倒立错觉。"],
  },
  {
    id: "bull-on-horse",
    cue: "牛实际放在马背上",
    mechanism: "马 + 上面的牛 → 马上牛",
    meaning:
      "可能预示行情转强、牛市启动或继续上行；“马上”不等于精确下一交易日。",
    bias: "bullish",
    horizon: "接下来；未精确到交易日",
    scope: "待字幕与语境确定",
    priority: 110,
    match: "bull_horse",
    support: "reported",
    source: fanSource,
    alternatives: ["牛和马只是并排摆放时，不能解作“马上牛”。"],
  },
  {
    id: "panda-bear",
    cue: "熊猫摆件",
    mechanism: "名称中的熊 → 熊市 / 风险联想",
    meaning:
      "可能提示偏弱或谨慎；也可能通过“国宝”指中国资产或护盘，需组合判别。",
    bias: "defensive",
    horizon: "未明确",
    scope: "不能仅凭熊猫确定市场",
    priority: 45,
    match: "panda",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["国宝 → 中国资产 / 国家力量；也可能是常驻玩偶。"],
  },
  {
    id: "bear-candidate",
    cue: "熊玩偶 / 熊摆件",
    mechanism: "熊 → 熊市联想",
    meaning: "偏弱或防守候选；与顶部、倒立、泡沫等关系线索组合时再加强解释。",
    bias: "defensive",
    horizon: "未明确",
    scope: "待上下文确定",
    priority: 35,
    match: "bear",
    support: "inferred",
    source: { title: "由物件名称提出的语义候选", url: "", type: "inference" },
    alternatives: ["常驻玩偶或普通装饰，名称本身不能确认作者意图。"],
  },
  {
    id: "hat-top",
    cue: "草帽",
    mechanism: "帽子位于头顶 → 顶部联想",
    meaning: "参考文章列为高位风险线索；仍需确认摆放位置与讲话语境。",
    bias: "defensive",
    horizon: "未明确",
    scope: "待上下文确定",
    priority: 45,
    match: "hat",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["日常遮阳或旅游场景，未必与行情有关。"],
  },
  {
    id: "pear-leave",
    cue: "梨",
    mechanism: "梨（lí）→ 离（lí）的谐音候选",
    meaning:
      "可能提示离开风险区域。文章将梨列为偏空线索，谐音机制是本工具提出的候选解释。",
    bias: "defensive",
    horizon: "未明确",
    scope: "待上下文确定",
    priority: 75,
    match: "pear",
    support: "inferred",
    source: ARTICLE_SOURCE,
    alternatives: ["水果本身；需有语境支持，不能仅因出现梨就确认离场。"],
  },
  {
    id: "red-plant",
    cue: "红花 / 红色植物",
    mechanism: "A股红色对应上涨的惯例联想",
    meaning: "可能表达偏多、上涨范围扩大或情绪转暖；不能只凭色彩确定精确时点。",
    bias: "bullish",
    horizon: "未明确",
    scope: "A股惯例；其他市场需核对",
    priority: 20,
    match: "red_plant",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["植物天然颜色或常驻装饰；也可能只指部分股票。"],
  },
  {
    id: "red-fruit",
    cue: "红色果实",
    mechanism: "红色 → 上涨联想",
    meaning: "一般偏多色彩候选；果实名称若另有明确谐音，应优先解名称。",
    bias: "bullish",
    horizon: "未明确",
    scope: "A股惯例",
    priority: 15,
    match: "red_fruit",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["樱桃、桃子等名称可能表达避险，不能用红色覆盖名称寓意。"],
  },
  {
    id: "green-plant",
    cue: "纯绿盆栽",
    mechanism: "绿色 + 无明显红花 → 弱势、震荡或探底候选",
    meaning: "可能表达震荡、分化、探底；不固定翻译成下一交易日必跌。",
    bias: "weakness",
    horizon: "未明确",
    scope: "需区分大盘与个股涨跌家数",
    priority: 15,
    match: "green_plant",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["绝大多数植物天然呈绿色；红绿同时出现还可能表达市场分化。"],
  },
  {
    id: "gold-turtle",
    cue: "金色乌龟",
    mechanism: "文章列为偏多道具；慢行寓意只作补充联想",
    meaning: "偏多或耐心持有候选，不能据此推出准确点位。",
    bias: "bullish",
    horizon: "未明确",
    scope: "待上下文确定",
    priority: 60,
    match: "gold_turtle",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["金色装饰或收藏品；“慢牛”属于未确认的补充联想。"],
  },
  {
    id: "withered-plant",
    cue: "枯萎植物 / 枯树小花",
    mechanism: "植物状态 → 疲弱、探底或局部生机的比喻",
    meaning: "市场偏弱、修复尚不充分的候选；小花可能提示局部机会。",
    bias: "weakness",
    horizon: "未明确",
    scope: "大盘或局部板块待判断",
    priority: 55,
    match: "withered",
    support: "reported",
    source: ARTICLE_SOURCE,
    alternatives: ["植物自然生长状态或未养护；不能凭枯黄直接确认行情信号。"],
  },
];
const names: Record<string, string[]> = {
  cherry: ["樱桃", "樱桃照片", "cherry", "cherries"],
  peach: ["桃", "桃子", "peach"],
  pear: ["梨", "梨子", "pear"],
  globe: ["地球", "地球仪", "globe", "globe_on_top"],
  bull: ["牛", "公牛", "牛摆件", "牛玩偶", "bull"],
  horse: ["马", "马摆件", "horse"],
  bear: ["熊", "白熊", "熊玩偶", "白熊玩偶", "bear"],
  panda: ["熊猫", "熊猫摆件", "panda"],
  hat: ["帽子", "草帽", "hat"],
  turtle: ["乌龟", "金龟", "龟", "turtle"],
  plant: [
    "植物",
    "盆栽",
    "绿植",
    "plant",
    "green_plant",
    "red_plant",
    "withered_plant",
  ],
  red_fruit: ["红色果实", "red_fruit"],
  foam: ["泡沫", "foam"],
};
const colorNames: Record<string, string> = {
  红: "red",
  红色: "red",
  绿: "green",
  绿色: "green",
  蓝: "blue",
  蓝色: "blue",
  金: "gold",
  金色: "gold",
  黄: "yellow",
  黄色: "yellow",
  白: "white",
  白色: "white",
  黑: "black",
  黑色: "black",
};
const canonical = (name: string) => {
  const n = name.trim().toLowerCase();
  return Object.entries(names).find(([_, a]) => a.includes(n))?.[0] || n;
};
const orientation = (value: string | undefined) =>
  ["倒立", "倒挂", "upside_down", "inverted"].includes(value || "")
    ? "upside_down"
    : value || "unknown";
export function sceneGraph(observations: SceneObservation[]) {
  return observations
    .map((o, i) => ({ ...o, id: o.id || "object-" + i }))
    .filter((o) => o.verified && o.confidence >= 0.65)
    .map((o) => {
      const name = canonical(o.name || o.label);
      let colors = (o.colors || []).map(
        (c) => colorNames[c] || c.toLowerCase(),
      );
      if (o.label === "red_plant" || o.label === "red_fruit")
        colors = [...colors, "red"];
      if (o.label === "green_plant") colors = [...colors, "green"];
      const kind =
        o.kind ||
        (["cherry", "peach", "pear", "red_fruit"].includes(name)
          ? "fruit"
          : name === "plant"
            ? "plant"
            : "object");
      return {
        ...o,
        name,
        kind,
        colors: [...new Set(colors)],
        orientation: orientation(o.orientation),
        relations: o.relations || [],
        actions: o.actions || [],
      };
    });
}
function related(
  node: ReturnType<typeof sceneGraph>[number],
  type: string,
  target: string | undefined,
  all: ReturnType<typeof sceneGraph>,
) {
  return node.relations.flatMap((r) => {
    if (r.verified !== true || r.type !== type) return [];
    const other = all.find(
      (n) =>
        n.id !== node.id &&
        n.frameIndex === node.frameIndex &&
        (r.targetId
          ? n.id === r.targetId
          : !!r.targetName && n.name === canonical(r.targetName)),
    );
    return other && (!target || other.name === target) ? [other] : [];
  });
}
function relation(
  node: ReturnType<typeof sceneGraph>[number],
  type: string,
  target: string | undefined,
  all: ReturnType<typeof sceneGraph>,
) {
  return related(node, type, target, all).length > 0;
}
export function decodeScene(
  observations: SceneObservation[],
  context: { market?: string; visibleText?: string[]; coverage?: string } = {},
  candidates: SemanticCandidate[] = [],
) {
  const objects = sceneGraph(observations);
  let matches = CODEBOOK.flatMap((rule) =>
    objects
      .filter((o) => {
        switch (rule.match) {
          case "cherry":
          case "peach":
          case "pear":
          case "panda":
          case "bear":
          case "hat":
            return o.name === rule.match;
          case "pick_peach":
            return (
              o.name === "peach" &&
              o.actions.some((a) =>
                [
                  "摘",
                  "摘桃",
                  "采摘",
                  "手指桃子",
                  "指向",
                  "pick",
                  "picking",
                  "pointing",
                ].includes(a),
              )
            );
          case "globe_top":
            return (
              o.name === "globe" &&
              (o.label === "globe_on_top" ||
                relation(o, "on_top_of", undefined, objects))
            );
          case "globe_foam":
            return (
              o.name === "globe" && relation(o, "wrapped_by", "foam", objects)
            );
          case "inverted_bull":
            return o.name === "bull" && o.orientation === "upside_down";
          case "bull_horse":
            return (
              o.name === "bull" && relation(o, "on_top_of", "horse", objects)
            );
          case "red_plant":
            return o.kind === "plant" && o.colors.includes("red");
          case "green_plant":
            return (
              o.kind === "plant" &&
              o.colors.includes("green") &&
              !o.colors.includes("red")
            );
          case "red_fruit":
            return o.kind === "fruit" && o.colors.includes("red");
          case "gold_turtle":
            return o.name === "turtle" && o.colors.includes("gold");
          case "withered":
            return (
              o.label === "withered_plant" ||
              (o.kind === "plant" && o.actions.includes("枯萎"))
            );
          default:
            return false;
        }
      })
      .map((o) => ({
        ...rule,
        evidenceIds: [o.id],
        evidenceFrames: [o.frameIndex],
        evidenceTimes: o.evidenceTime === undefined ? [] : [o.evidenceTime],
        visualConfidence: o.confidence,
        objectName: o.name,
        sourceStatus: rule.support,
      })),
  );
  matches = matches.filter(
    (m) =>
      !matches.some(
        (other) =>
          other.id !== m.id &&
          other.priority > m.priority &&
          m.evidenceIds.every((id) => other.evidenceIds.includes(id)) &&
          ((m.id === "red-fruit" &&
            [
              "cherry-escape",
              "peach-escape",
              "pick-peach",
              "pear-leave",
            ].includes(other.id)) ||
            (m.id === "peach-escape" && other.id === "pick-peach")),
      ),
  );
  matches = matches
    .filter(
      (m, i, a) =>
        a.findIndex((x) => x.id === m.id && x.objectName === m.objectName) ===
        i,
    )
    .sort((a, b) => b.priority - a.priority);
  // 组合解码列出全部支撑物件，置信度取最弱一项；不能仅确认牛而未确认马。
  const supportedMatches = matches.map((m) => {
    const node = objects.find((o) => o.id === m.evidenceIds[0])!;
    const peers =
      m.id === "bull-on-horse"
        ? related(node, "on_top_of", "horse", objects)
        : m.id === "globe-bubble"
          ? related(node, "wrapped_by", "foam", objects)
          : m.id === "globe-top"
            ? related(node, "on_top_of", undefined, objects)
            : [];
    return {
      ...m,
      evidenceIds: [...new Set([...m.evidenceIds, ...peers.map((o) => o.id)])],
      visualConfidence: Math.min(
        m.visualConfidence,
        ...peers.map((o) => o.confidence),
      ),
      meaningConfidence:
        m.support === "inferred"
          ? "低"
          : m.support === "user_example"
            ? "用户提供的先验，待验证"
            : "第三方解读支持，待验证",
    };
  });
  const groundedCandidates = candidates
    .filter(
      (c) =>
        c.evidenceIds.length > 0 &&
        c.evidenceIds.every((id) => objects.some((o) => o.id === id)),
    )
    .map((c) => ({ ...c, status: "工具提出的候选，未获作者确认" }));
  const biases = new Set<string>([
      ...matches.map((m) => m.bias),
      ...groundedCandidates.map((c) => c.bias),
    ]),
    positive = biases.has("bullish"),
    risk = biases.has("defensive") || biases.has("bearish");
  const bias =
    positive && (risk || biases.has("weakness"))
      ? "mixed"
      : risk
        ? "defensive"
        : positive
          ? "bullish"
          : biases.has("weakness")
            ? "weakness"
            : "unknown";
  const summary = matches.length
    ? matches
        .slice(0, 4)
        .map((m) => `${m.cue} → ${m.mechanism} → ${m.meaning}`)
        .join("\n")
    : "词典尚未覆盖这些物件或关系；保留具体名称、数量、动作与摆放证据，另提有画面锚点的语义候选。";
  return {
    codebookVersion: CODEBOOK_VERSION,
    objects,
    matches: supportedMatches,
    candidates: groundedCandidates,
    bias,
    risk,
    context,
    summary:
      summary +
      (groundedCandidates.length
        ? "\n新增候选：" +
          groundedCandidates
            .map((c) => c.cue + " → " + c.mechanism + " → " + c.meaning)
            .join("\n")
        : ""),
    unknownObjects: objects.filter(
      (o) =>
        !supportedMatches.some((m) => m.evidenceIds.includes(o.id)) &&
        !groundedCandidates.some((c) => c.evidenceIds.includes(o.id)),
    ),
    timing:
      "未因谐音或颜色自动指定下一交易日；如字幕明确时间，再单独锁定预测窗口。",
  };
}
export function compareScenes(
  previous: SceneObservation[],
  current: SceneObservation[],
  previousCoverage = "partial",
  currentCoverage = "partial",
) {
  const before = sceneGraph(previous),
    after = sceneGraph(current);
  const out: { kind: string; name: string; detail: string }[] = [];
  const value = (
    node: (typeof before)[number],
    field: string,
    all: typeof before,
  ) => {
    if (field === "relations") {
      const rel = node.relations
        .filter((r) => r.verified === true)
        .map((r) => {
          const target =
            all.find(
              (o) => o.id === r.targetId && o.frameIndex === node.frameIndex,
            )?.name || (r.targetName ? canonical(r.targetName) : undefined);
          return target ? r.type + ":" + target : null;
        })
        .filter(Boolean)
        .sort();
      return rel.length ? rel : undefined;
    }
    if (field === "colors" || field === "actions") {
      const a = node[field];
      return a.length ? [...a].sort() : undefined;
    }
    return node[field as "position" | "orientation" | "count"];
  };
  for (const node of after) {
    const options = before.filter((n) => n.name === node.name);
    const positioned = node.position
      ? options.filter((n) => n.position === node.position)
      : [];
    const old =
      positioned.length === 1
        ? positioned[0]
        : options.length === 1
          ? options[0]
          : undefined;
    if (!options.length) {
      out.push({
        kind: previousCoverage === "complete" ? "appeared" : "newly_observed",
        name: node.name,
        detail:
          previousCoverage === "complete"
            ? "本次新增物件"
            : "本次才辨认到；上条未完整观察，不能确认新增",
      });
      continue;
    }
    if (!old) {
      out.push({
        kind: "unmatched_instance",
        name: node.name,
        detail: "存在多个同名物件，无法可靠对应，不断言位置变化",
      });
      continue;
    }
    for (const field of [
      "position",
      "orientation",
      "colors",
      "count",
      "relations",
      "actions",
    ]) {
      const a = value(old, field, before),
        b = value(node, field, after);
      if (
        a === undefined ||
        b === undefined ||
        a === "unknown" ||
        b === "unknown"
      )
        continue;
      if (JSON.stringify(a) !== JSON.stringify(b))
        out.push({
          kind: "changed",
          name: node.name,
          detail: field + " 发生变化",
        });
    }
  }
  if (previousCoverage === "complete" && currentCoverage === "complete")
    for (const old of before)
      if (!after.some((n) => n.name === old.name))
        out.push({
          kind: "removed",
          name: old.name,
          detail: "本次未出现该物件",
        });
  return {
    changes: out,
    continuingCues: after.filter((n) => before.some((o) => o.name === n.name)),
    caution:
      "只比较已辨认且可比较的字段。物件未变可能是持续提示；未完整观察时不宣称新增或消失。",
  };
}

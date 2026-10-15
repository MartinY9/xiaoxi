import test from "node:test";
import assert from "node:assert/strict";
import { decodeScene, compareScenes } from "../lib/decoder.ts";
import { parseVisionObservations, recordSchema } from "../lib/schemas.ts";
import { semanticEvidence, RULE_VERSION } from "../lib/engine.ts";
const obj = (label, extra = {}) => ({
  id: label,
  label,
  description: "测试用可见证据",
  confidence: 0.9,
  frameIndex: 0,
  verified: true,
  ...extra,
});
test("红色樱桃优先解应逃，不被颜色解成看涨；照片同样保留名称", () => {
  const d = decodeScene([
    obj("other", { name: "樱桃", kind: "fruit", colors: ["red"] }),
  ]);
  assert.equal(d.bias, "defensive");
  assert.deepEqual(
    d.matches.map((m) => m.id),
    ["cherry-escape"],
  );
  assert.ok(d.matches[0].mechanism.includes("应逃"));
  assert.equal(
    decodeScene([obj("cherry", { kind: "photo" })]).matches[0].id,
    "cherry-escape",
  );
});
test("牛马共现不等于马上牛，需同帧核实叠放；组合取最低辨认把握", () => {
  const bull = obj("bull"),
    horse = obj("horse", { confidence: 0.7 });
  assert.equal(decodeScene([bull, horse]).matches.length, 0);
  const verified = {
    ...bull,
    relations: [{ type: "on_top_of", targetId: "horse", verified: true }],
  };
  const d = decodeScene([verified, horse]);
  assert.equal(d.matches[0].id, "bull-on-horse");
  assert.equal(d.matches[0].visualConfidence, 0.7);
  assert.deepEqual(d.matches[0].evidenceIds, ["bull", "horse"]);
  assert.equal(
    decodeScene([verified, { ...horse, frameIndex: 1 }]).matches.length,
    0,
  );
  assert.equal(
    decodeScene([
      {
        ...verified,
        relations: [{ type: "on_top_of", targetId: "horse", verified: false }],
      },
      horse,
    ]).matches.length,
    0,
  );
});
test("牛倒立和摘桃动作会改变解码", () => {
  assert.equal(
    decodeScene([obj("bull", { orientation: "倒挂" })]).matches[0].id,
    "inverted-bull",
  );
  const ids = decodeScene([
    obj("peach", { actions: ["摘桃"], kind: "fruit", colors: ["red"] }),
  ]).matches.map((m) => m.id);
  assert.deepEqual(ids, ["pick-peach"]);
});
test("泡沫和地球仅共现不算全球泡沫；未确认对象不能支撑关系", () => {
  const globe = obj("globe"),
    foam = obj("foam");
  assert.equal(decodeScene([globe, foam]).matches.length, 0);
  const wrapped = {
    ...globe,
    relations: [{ type: "wrapped_by", targetName: "泡沫", verified: true }],
  };
  assert.equal(decodeScene([wrapped, foam]).matches[0].id, "globe-bubble");
  assert.equal(
    decodeScene([wrapped, { ...foam, verified: false }]).matches.length,
    0,
  );
});
test("未知具体名称不丢弃，也不因名字含牛就匹配牛；候选必须锚定已确认画面", () => {
  const o = obj("other", { name: "牛油果" }),
    d = decodeScene([o]);
  assert.equal(d.unknownObjects[0].name, "牛油果");
  assert.equal(d.matches.length, 0);
  const c = {
    id: "c",
    cue: "测试候选",
    evidenceIds: ["other"],
    mechanism: "名称联想",
    meaning: "未经证实的含义",
    bias: "unknown",
    scope: "待确定",
    horizon: "未明确",
    confidence: "low",
    alternatives: ["普通水果"],
  };
  assert.equal(decodeScene([o], {}, [c]).candidates.length, 1);
  assert.equal(
    decodeScene([o], {}, [{ ...c, evidenceIds: ["unseen"] }]).candidates.length,
    0,
  );
});
test("多帧同道具不累计成多条命中；局部比较不臆称消失", () => {
  assert.equal(
    decodeScene([obj("cherry"), obj("cherry", { id: "frame2", frameIndex: 1 })])
      .matches.length,
    1,
  );
  const before = [obj("bear"), obj("globe_on_top")],
    after = [obj("globe_on_top"), obj("panda")];
  const d = compareScenes(before, after, "partial", "partial");
  assert.equal(
    d.changes.find((c) => c.name === "panda").kind,
    "newly_observed",
  );
  assert.equal(
    d.changes.some((c) => c.kind === "removed"),
    false,
  );
  assert.equal(
    compareScenes(before, after, "complete", "partial").changes.some(
      (c) => c.kind === "removed",
    ),
    false,
  );
  assert.equal(
    compareScenes(before, after, "complete", "complete").changes.some(
      (c) => c.kind === "removed",
    ),
    true,
  );
});
test("连续物件更换提取ID不冒充摆放变化，未知颜色和同名多物件不强行对应", () => {
  const before = [
      obj("globe", {
        relations: [{ type: "on_top_of", targetId: "bear", verified: true }],
      }),
      obj("bear"),
    ],
    after = [
      obj("globe", {
        id: "g2",
        relations: [{ type: "on_top_of", targetId: "b2", verified: true }],
        colors: ["blue"],
      }),
      obj("bear", { id: "b2" }),
    ];
  assert.equal(compareScenes(before, after).changes.length, 0);
  const many = [obj("bull", { id: "a" }), obj("bull", { id: "b" })];
  assert.equal(
    compareScenes(many, [obj("bull", { position: "右侧" })]).changes[0].kind,
    "unmatched_instance",
  );
});
test("视觉响应保留开放名称与关系，不能由模型自行确认", () => {
  const parsed = parseVisionObservations(
    [
      obj("unknown", {
        name: "有字的钟",
        relations: [{ type: "on_top_of", targetId: "horse", verified: true }],
      }),
    ],
    1,
  );
  assert.equal(parsed[0].name, "有字的钟");
  assert.equal(parsed[0].label, "other");
  assert.equal(parsed[0].verified, false);
  assert.equal(parsed[0].relations[0].verified, false);
  const r = recordSchema.parse({
    title: "示例",
    url: "https://www.douyin.com/video/1",
    publishedAt: "2026-10-13T12:27:00+08:00",
    sourceType: "original",
    timeVerified: true,
    market: "a-share",
    observations: parsed,
    notes: "",
    signal: { direction: "up" },
    createdAt: "伪造锁定时间",
  });
  assert.equal(r.observations[0].name, "有字的钟");
  assert.equal("signal" in r, false);
  assert.equal("createdAt" in r, false);
});
test("暗语统计按冻结版本和交易日去重，当前尚不可得的观察不参与", () => {
  const observations = [obj("cherry")],
    r = {
      id: "1",
      title: "测试",
      url: "https://www.douyin.com/video/1",
      publishedAt: "2025-01-02T16:00:00+08:00",
      createdAt: "2025-01-02T16:01:00+08:00",
      sourceType: "original",
      timeVerified: true,
      market: "a-share",
      observations,
      notes: "",
      ruleVersion: RULE_VERSION,
      decoding: decodeScene(observations),
    },
    prices = [
      { date: "2025-01-02", close: 100 },
      { date: "2025-01-03", close: 98 },
    ];
  const rows = semanticEvidence(
    [
      r,
      { ...r, id: "2", url: "https://www.douyin.com/video/2" },
      { ...r, id: "future", createdAt: "2025-02-01T00:00:00Z" },
    ],
    prices,
    "2025-01-03T16:00:00+08:00",
  );
  assert.equal(rows[0].day1.n, 1);
  assert.ok(Math.abs(rows[0].day1.meanReturn + 0.02) < 1e-9);
  assert.equal(rows[0].day3.n, 0);
  const versions = semanticEvidence(
    [
      r,
      {
        ...r,
        id: "b",
        decoding: { ...r.decoding, codebookVersion: "other-version" },
      },
    ],
    prices,
    "2025-01-03T16:00:00+08:00",
  );
  assert.equal(versions.length, 2);
});

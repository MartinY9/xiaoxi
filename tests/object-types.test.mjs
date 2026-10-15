import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  typedObservations,
  typedInterpretation,
} from "../lib/object-types.mjs";
import {
  backgroundFeatures,
  addBackgroundInference,
  BACKGROUND_VERSION,
  BACKGROUND_ESTABLISHED_AT,
} from "../lib/background-inference.mjs";
import { backgroundFeatures as v3Features } from "../lib/background-inference-v3.mjs";
const object = (id, label, name, extra = {}) => ({
  id,
  label,
  name,
  description: "测试用核实观察",
  frameIndex: 0,
  evidenceTime: 4,
  confidence: 0.9,
  verified: true,
  ...extra,
});
test("具体名称不再吞掉已核实类别、位置与同帧组合，原观察不改写", () => {
  const observations = [
    object("g", "globe", "蓝色地图样地球仪", {
      position: "右侧高位",
      relations: [{ type: "on_top_of", targetId: "b", verified: true }],
    }),
    object("b", "bear", "棕色普通熊玩偶"),
    object("p", "panda", "高位黑白熊猫玩偶"),
  ];
  const item = {
      observations,
      attachments: [
        { observationId: "g", shotKey: "s", crop: [800, 100, 60, 60] },
      ],
      shots: [{ key: "s", width: 1280, height: 720 }],
    },
    before = JSON.stringify(item),
    get = (f, id) => f.fields.find((x) => x.id === id).value;
  assert.equal(get(v3Features(item), "globe_present"), 0);
  const f = backgroundFeatures(item);
  assert.equal(get(f, "globe_present"), 1);
  assert.equal(get(f, "panda_present"), 1);
  assert.equal(get(f, "bear"), 1);
  assert.equal(get(f, "globe_top"), 1);
  assert.equal(get(f, "globe_x"), 830 / 1280);
  assert.equal(get(f, "globe_y"), 130 / 720);
  assert.equal(JSON.stringify(item), before);
  const d = typedInterpretation(observations, "unknown");
  assert.ok(d.matches.some((m) => m.id === "panda-context-v3"));
  assert.ok(!d.matches.some((m) => m.id === "panda-bear"));
});
test("未知词不猜物种；熊与熊猫冲突、未确认与跨帧关系均保留限制", () => {
  const unknown = object("u", "other", "牛油果");
  assert.equal(typedObservations([unknown])[0].name, "牛油果");
  const conflict = object("x", "bear", "黑白熊猫玩偶");
  assert.equal(typedObservations([conflict])[0].verified, false);
  const bull = object("bull", "bull", "黄色公牛玩偶", {
      relations: [{ type: "on_top_of", targetId: "horse", verified: true }],
    }),
    horse = object("horse", "horse", "木质马玩偶");
  assert.equal(
    typedInterpretation([bull, horse], "a-share").features.anchors.bull_on_horse
      .length > 0,
    true,
  );
  assert.equal(
    typedInterpretation([bull, { ...horse, frameIndex: 1 }], "a-share").features
      .anchors.bull_on_horse.length,
    0,
  );
  assert.equal(
    backgroundFeatures({
      observations: [{ ...bull, verified: false }],
    }).fields.find((f) => f.id === "bull_present").value,
    0,
  );
  const purple = object("flower", "other", "淡紫色花与绿叶", {
    kind: "plant",
    colors: ["purple", "pink", "green"],
  });
  const f = backgroundFeatures({ observations: [purple] });
  assert.equal(f.fields.find((x) => x.id === "green_plant").value, 0);
  assert.equal(f.fields.find((x) => x.id === "red_plant").value, 0);
  assert.ok(
    !typedInterpretation([purple], "a-share").matches.some(
      (m) => m.id === "green-down-v3",
    ),
  );
  for (const color of ["white", "yellow"])
    assert.equal(
      backgroundFeatures({
        observations: [{ ...purple, colors: ["green", color] }],
      }).fields.find((x) => x.id === "green_plant").value,
      0,
    );
});
test("新版编码按新建立时点收录首次判断，不给旧视频补造新版事前判断", async () => {
  const root = await fs.mkdtemp(
    path.join(process.cwd(), "work/type-first-test-"),
  );
  try {
    await fs.mkdir(path.join(root, "outputs"));
    await fs.mkdir(path.join(root, "work"));
    const prices = [
      { date: "2026-10-13", close: 3800 },
      { date: "2026-10-14", close: 3790 },
      { date: "2026-10-15", close: 3780 },
      { date: "2026-10-16", close: 3850 },
    ];
    const old = {
      record: {
        id: "old",
        publishedAt: "2026-10-14T12:00:00+08:00",
        createdAt: "2026-10-14T12:01:00+08:00",
        timeVerified: true,
        sourceType: "original",
        market: "unknown",
      },
      observations: [object("old-g", "globe", "蓝色地图地球仪")],
      modelView: { status: "excluded" },
    };
    const fresh = structuredClone(old);
    fresh.record = {
      ...fresh.record,
      id: "fresh",
      publishedAt: "2026-10-15T12:00:00+08:00",
      createdAt: "2026-10-15T12:01:00+08:00",
    };
    assert.ok(
      new Date(fresh.record.createdAt) > new Date(BACKGROUND_ESTABLISHED_AT),
    );
    const seed = structuredClone(old);
    seed.record = {
      ...seed.record,
      id: "seed",
      publishedAt: "2026-10-13T18:00:00+08:00",
      imported: true,
    };
    const metadata = ["old", "fresh", "seed"].map((id) => ({
      id,
      sourceVerified: true,
      everyday: true,
      coauth: false,
    }));
    const legacy = {
      generatedAt: "2026-10-15T12:05:00+08:00",
      labelDefinition: "test",
    };
    await addBackgroundInference(
      root,
      [old, fresh, seed],
      legacy,
      metadata,
      prices,
    );
    const p = path.join(root, "work/background-predictions.json"),
      before = await fs.readFile(p, "utf8"),
      first = JSON.parse(before).predictions;
    assert.deepEqual(
      first.map((s) => s.recordId),
      ["fresh"],
    );
    assert.equal(first[0].modelVersion, BACKGROUND_VERSION);
    await addBackgroundInference(
      root,
      [old, fresh, seed],
      { ...legacy, generatedAt: "2026-10-16T15:10:00+08:00" },
      metadata,
      prices,
    );
    assert.equal(await fs.readFile(p, "utf8"), before);
  } finally {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve("work") + path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

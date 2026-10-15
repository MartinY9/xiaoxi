import test from "node:test";
import assert from "node:assert/strict";
import { observationSchema, parseVisionObservations } from "../lib/schemas.ts";
const o = {
  label: "other",
  name: "片尾书封面",
  description: "测试夹具",
  confidence: 0.9,
  frameIndex: 6,
  verified: true,
};
test("本机第7张核实截图保留真实索引，视觉接口仍限制到实际输入帧数", () => {
  assert.equal(observationSchema.parse(o).frameIndex, 6);
  const model = parseVisionObservations([o], 6)[0];
  assert.equal(model.frameIndex, 5);
  assert.equal(model.verified, false);
  assert.equal(
    observationSchema.safeParse({ ...o, frameIndex: -1 }).success,
    false,
  );
  assert.equal(
    observationSchema.safeParse({ ...o, frameIndex: 1.5 }).success,
    false,
  );
});

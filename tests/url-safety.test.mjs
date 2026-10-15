import test from "node:test";
import assert from "node:assert/strict";
import { safeExternalURL } from "../lib/visual-report.mjs";
import { candidateSchema } from "../lib/schemas.ts";
test("公开报告不生成脚本协议或携带凭据的来源链接", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///private",
    "https://user:secret@example.org/",
  ])
    assert.equal(safeExternalURL(value), "#");
  assert.equal(
    safeExternalURL("https://example.org/source"),
    "https://example.org/source",
  );
  const candidate = {
    id: "test",
    cue: "test",
    evidenceIds: ["object"],
    mechanism: "test",
    meaning: "test",
    bias: "unknown",
    scope: "test",
    horizon: "unknown",
    confidence: "low",
    alternatives: ["test"],
    source: { title: "test", url: "javascript:alert(1)" },
  };
  assert.equal(candidateSchema.safeParse(candidate).success, false);
});

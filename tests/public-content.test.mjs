import test from "node:test";
import assert from "node:assert/strict";
import { publicContentIssues } from "../lib/public-content.mjs";
test("公开站点链接不属于凭据或私人路径", () => {
  assert.deepEqual(
    publicContentIssues('<a href="https://xiaoxi.martin.wiki/">在线体验</a>'),
    [],
  );
});
test("发布内容检测会话凭据、令牌、邮箱与本机路径，只返回规则名", () => {
  const session = "session" + "id=" + "x".repeat(40);
  const api = "sk-" + "z".repeat(40);
  const text =
    session +
    " " +
    api +
    " " +
    ("12345" + "@" + "qq.com") +
    " " +
    ("C:" +
      String.fromCharCode(92) +
      "Users" +
      String.fromCharCode(92) +
      "sample");
  const result = publicContentIssues(text);
  for (const expected of [
    "session-credential",
    "api-key",
    "personal-qq-email",
    "personal-path",
  ])
    assert.ok(result.includes(expected));
  assert.ok(!JSON.stringify(result).includes(session));
  assert.ok(!JSON.stringify(result).includes(api));
});
test("发布器不接受内联位图，避免绕过登记JPEG清单", () => {
  assert.ok(
    publicContentIssues("data:image/" + "jpeg;base64,example").includes(
      "inline-image",
    ),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { dashboardAsset } from "../lib/local-server.mjs";
test("本机服务只读报告目录，拒绝目录穿越、JSON与指向外部的链接", async (t) => {
  const base = path.resolve("work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "server-test-"));
  try {
    const out = path.join(root, "outputs");
    await fs.mkdir(out);
    await fs.writeFile(path.join(out, "report.html"), "<p>test</p>");
    await fs.writeFile(path.join(root, "private.html"), "private fixture");
    await fs.writeFile(path.join(out, "state.json"), "{}");
    assert.equal(
      (await dashboardAsset(out, "report.html")).bytes.toString(),
      "<p>test</p>",
    );
    await assert.rejects(dashboardAsset(out, "../private.html"));
    await assert.rejects(dashboardAsset(out, "state.json"));
    try {
      await fs.symlink(
        path.join(root, "private.html"),
        path.join(out, "link.html"),
      );
    } catch (e) {
      if (["EPERM", "EACCES"].includes(e.code)) {
        t.diagnostic("本机无符号链接权限，目录穿越与扩展名检查已验证");
        return;
      }
      throw e;
    }
    await assert.rejects(dashboardAsset(out, "link.html"));
  } finally {
    assert.ok(path.resolve(root).startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

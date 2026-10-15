import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkRelease } from "../scripts/release-check.mjs";
test("工作区已清理也不能漏掉仍在Git暂存区的凭据", async (t) => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("Git unavailable");
    return;
  }
  const base = path.resolve("work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "git-index-scan-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
  try {
    for (const f of [
      "README.md",
      "LICENSE",
      "NOTICE.md",
      "package.json",
      "package-lock.json",
      ".gitignore",
    ])
      await fs.writeFile(path.join(root, f), "placeholder");
    await fs.mkdir(path.join(root, "examples"));
    const file = path.join(root, "examples", "staged.txt"),
      secret = "sk-" + "q".repeat(40);
    await fs.writeFile(file, secret);
    git("init");
    git("add", ".");
    await fs.writeFile(file, "clean workspace text");
    const result = await checkRelease(root);
    assert.equal(result.ok, false);
    assert.ok(
      result.issues.some(
        (i) =>
          i.file === "examples/staged.txt" &&
          i.rule === "API密钥格式" &&
          i.source === "git-index",
      ),
    );
    assert.ok(!JSON.stringify(result).includes(secret));
  } finally {
    assert.ok(root.startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("发布检查只报文件与规则，不回显秘密，禁止媒体与私人路径", async () => {
  const base = path.resolve("work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "release-check-"));
  try {
    for (const f of [
      "README.md",
      "LICENSE",
      "NOTICE.md",
      "package.json",
      "package-lock.json",
      ".gitignore",
    ])
      await fs.writeFile(path.join(root, f), "placeholder");
    await fs.mkdir(path.join(root, "examples"));
    assert.equal((await checkRelease(root)).ok, true);
    const secret = "sk-" + "x".repeat(40);
    await fs.writeFile(path.join(root, "examples/bad.json"), secret);
    await fs.writeFile(
      path.join(root, "examples/frame.jpg"),
      "not an allowed image",
    );
    const result = await checkRelease(root);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.rule === "API密钥格式"));
    assert.ok(result.issues.some((i) => /运行图片/.test(i.rule)));
    assert.ok(!JSON.stringify(result).includes(secret));
  } finally {
    assert.ok(path.resolve(root).startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("发布检查拒绝会话文件及敏感命名配置，即使强行放进允许目录", async () => {
  const base = path.resolve("work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "release-config-"));
  try {
    for (const f of [
      "README.md",
      "LICENSE",
      "NOTICE.md",
      "package.json",
      "package-lock.json",
      ".gitignore",
    ])
      await fs.writeFile(path.join(root, f), "placeholder");
    await fs.mkdir(path.join(root, "examples"));
    for (const name of [
      "deploy.json",
      "cookies.json",
      "known_hosts",
      "id_ed25519",
      "session-storage-state.json",
    ])
      await fs.writeFile(path.join(root, "examples", name), "fixture only");
    await fs.writeFile(
      path.join(root, "examples", "leaked.txt"),
      "session" + "id=" + "x".repeat(40),
    );
    const result = await checkRelease(root);
    assert.equal(result.ok, false);
    for (const name of [
      "deploy.json",
      "cookies.json",
      "known_hosts",
      "id_ed25519",
      "session-storage-state.json",
    ])
      assert.ok(result.issues.some((i) => i.file === "examples/" + name));
    assert.ok(result.issues.some((i) => i.rule === "浏览器会话凭据"));
  } finally {
    assert.ok(root.startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { prepareSite } from "../scripts/publish-site.mjs";
import { syncReport } from "../scripts/sync-site.mjs";

async function fixture(t) {
  const base = path.resolve("work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "publish-test-"));
  for (const d of ["work", "outputs", "public/evidence"])
    await fs.mkdir(path.join(root, d), { recursive: true });
  t.after(async () => {
    assert.ok(root.startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const write = async (name, value) =>
    fs.writeFile(
      path.join(root, name),
      typeof value === "object" && !Buffer.isBuffer(value)
        ? JSON.stringify(value)
        : value,
    );
  const jpg = Buffer.from([255, 216, 255, 217]);
  await write("public/evidence/fixture.jpg", jpg);
  await write(
    "public/report.html",
    '<html><div style="background-image:url(/evidence/fixture.jpg)">fixture</div></html>',
  );
  await write("work/evidence-index.json", {
    shots: [
      {
        file: "fixture.jpg",
        sha256: createHash("sha256").update(jpg).digest("hex"),
      },
    ],
    attachments: [],
  });
  await write("outputs/可视化报告数据.json", {
    generatedAt: "2026-01-01T00:00:00Z",
    items: [{ record: { id: "fixture" } }],
  });
  return { root, write };
}
test("准备清单只包含首页与引用JPEG，不复制私有配置或未引用图片", async (t) => {
  const { root, write } = await fixture(t);
  await write("work/deploy.json", { exampleOnly: true });
  await write(
    "public/evidence/unreferenced.jpg",
    Buffer.from([255, 216, 255, 217]),
  );
  const prepared = await prepareSite(root);
  assert.deepEqual(Object.keys(prepared.manifest.files), [
    "index.html",
    "evidence/fixture.jpg",
  ]);
  assert.deepEqual(
    (await fs.readdir(path.join(prepared.directory, "site"))).sort(),
    ["evidence", "index.html"],
  );
  assert.deepEqual(
    await fs.readdir(path.join(prepared.directory, "site/evidence")),
    ["fixture.jpg"],
  );
});
test("准备阶段拒绝合成报告、凭据文本、未登记图片与损坏JPEG", async (t) => {
  const { root, write } = await fixture(t);
  await write(
    "public/report.html",
    '<body data-report-mode="synthetic">example</body>',
  );
  await assert.rejects(prepareSite(root), /real report/);
  await write(
    "public/report.html",
    "<html>session" + "id=" + "x".repeat(40) + "</html>",
  );
  await assert.rejects(prepareSite(root), /Private reference/);
  await write("public/report.html", '<img src="/evidence/unknown.jpg">');
  await assert.rejects(prepareSite(root), /Unregistered/);
  await write("public/report.html", '<img src="/evidence/fixture.jpg">');
  await write("public/evidence/fixture.jpg", "corrupt");
  await assert.rejects(prepareSite(root), /integrity/);
});
test("同步无变化不联网，失败保留旧成功记录，恢复需实际确认送达", async (t) => {
  const { root, write } = await fixture(t);
  assert.equal((await syncReport({ root })).status, "disabled");
  await write("work/site-publish-config.json", {
    enabled: true,
    connectionConfig: "work/deploy.json",
  });
  await write("work/deploy.json", { publicUrl: "https://example.com/" });
  let published = 0,
    fetched = 0;
  const opts = {
    root,
    publish: async () => {
      published++;
    },
    fetchPublic: async () => {
      fetched++;
      return fs.readFile(path.join(root, "public/report.html"));
    },
  };
  assert.equal((await syncReport(opts)).verified, true);
  assert.equal((await syncReport(opts)).status, "unchanged");
  assert.equal(published, 1);
  assert.equal(fetched, 1);
  await write("public/report.html", "new revision");
  const fail = await syncReport({
    ...opts,
    publish: async () => {
      throw Error("fixture disconnect");
    },
  });
  assert.equal(fail.status, "failed");
  assert.equal(fail.previousSuccessRetained, true);
  assert.equal(fail.notice.pending, true);
  assert.equal(
    (
      await syncReport({
        ...opts,
        fetchPublic: async () => Buffer.from("wrong content"),
      })
    ).status,
    "failed",
  );
  const recovered = await syncReport(opts);
  assert.equal(recovered.notice.kind, "recovered");
  assert.equal((await syncReport(opts)).notice.pending, true);
  await syncReport({ ...opts, ackNotice: true });
  assert.equal((await syncReport(opts)).notice, null);
});
test("同一报告更换域名后重新发布核验，再次同步才跳过联网", async (t) => {
  const { root, write } = await fixture(t);
  await write("work/site-publish-config.json", {
    enabled: true,
    connectionConfig: "work/deploy.json",
  });
  await write("work/deploy.json", { publicUrl: "https://old.example.com/" });
  let published = 0;
  const fetched = [];
  const opts = {
    root,
    publish: async () => {
      published++;
    },
    fetchPublic: async (url) => {
      fetched.push(url);
      return fs.readFile(path.join(root, "public/report.html"));
    },
  };
  assert.equal((await syncReport(opts)).verified, true);
  await write("work/deploy.json", { publicUrl: "https://new.example.com" });
  const migrated = await syncReport(opts);
  assert.equal(migrated.verified, true);
  assert.equal(migrated.url, "https://new.example.com/");
  assert.equal(published, 2);
  assert.deepEqual(fetched, [
    "https://old.example.com/",
    "https://new.example.com/",
  ]);
  assert.equal((await syncReport(opts)).status, "unchanged");
  assert.equal(published, 2);
  assert.equal(fetched.length, 2);
  await write("work/deploy.json", {
    publicUrl: "https://user:password@new.example.com/",
  });
  await assert.rejects(syncReport(opts), /without credentials/);
});

test("同步锁与损坏状态不被覆盖，配置不能跳出工作区", async (t) => {
  const { root, write } = await fixture(t);
  await write("work/site-publish-config.json", {
    enabled: true,
    connectionConfig: "../outside.json",
  });
  await assert.rejects(syncReport({ root }), /inside the workspace/);
  await write("work/site-publish.lock", "fixture-running");
  assert.equal((await syncReport({ root })).status, "busy");
  await fs.unlink(path.join(root, "work/site-publish.lock"));
  await write("work/site-publish-state.json", "{broken");
  await assert.rejects(syncReport({ root }), SyntaxError);
  assert.equal(
    await fs.readFile(path.join(root, "work/site-publish-state.json"), "utf8"),
    "{broken",
  );
});
test("服务端发布协议拒绝越界、损坏上传、并发激活及无关目录", (t) => {
  const candidates = process.env.PYTHON
    ? [process.env.PYTHON]
    : ["python3", "python"];
  const python = candidates.find(
    (binary) =>
      spawnSync(binary, ["--version"], { encoding: "utf8", windowsHide: true })
        .status === 0,
  );
  if (!python) {
    t.skip("Python3 unavailable; server protocol checks require Python3");
    return;
  }
  const result = spawnSync(python, ["tests/static_publish_checks.py"], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).passed, 8);
});

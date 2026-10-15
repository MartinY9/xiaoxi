import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
async function fixture(t) {
  const base = path.resolve(project, "work");
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, "cli-test-"));
  for (const name of ["scripts", "lib"])
    await fs.cp(path.join(project, name), path.join(dir, name), {
      recursive: true,
    });
  await fs.copyFile(
    path.join(project, "package.json"),
    path.join(dir, "package.json"),
  );
  t.after(async () => {
    const target = path.resolve(dir);
    if (!target.startsWith(base + path.sep))
      throw Error("Test cleanup outside workspace");
    await fs.rm(target, { recursive: true, force: true });
  });
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/cli.mjs", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  const initialized = run("init");
  assert.equal(initialized.status, 0, initialized.stderr);
  return {
    dir,
    run,
    read: async (name) =>
      JSON.parse(await fs.readFile(path.join(dir, name), "utf8")),
    write: async (name, data) => {
      await fs.writeFile(path.join(dir, name), JSON.stringify(data));
      return path.join(dir, name);
    },
  };
}
test("初次空档案可生成报告，重复init不覆盖观察，旧ID不重复插入", async (t) => {
  const { dir, run, read, write } = await fixture(t);
  const empty = run("report");
  assert.equal(empty.status, 0, empty.stderr);
  const html = await fs.readFile(
    path.join(dir, "outputs/李大霄可视化报告.html"),
    "utf8",
  );
  assert.match(html, /等待训练数据/);
  assert.ok(!html.includes("背景特征模型已训练"));
  const body = JSON.parse(
    await fs.readFile(path.join(project, "examples/observation.json"), "utf8"),
  );
  body.record.title = "CLI test only";
  const input = await write("input.json", body);
  assert.equal(run("import", input).status, 0);
  assert.equal(run("init").status, 0);
  assert.equal((await read("work/monitor-state.json")).records.length, 1);
  body.record.title = "attempted replacement";
  await write("input.json", body);
  const duplicate = run("import", input);
  assert.equal(duplicate.status, 0, duplicate.stderr);
  const state = await read("work/monitor-state.json");
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].title, "CLI test only");
});
test("非法分钟行情被拒绝，不写入已有行情；真实抓取时间原样保留", async (t) => {
  const { run, read, write } = await fixture(t);
  const body = {
    updatedAt: "2026-01-05T14:30:00+08:00",
    prices: [{ date: "2026-01-05", close: 3200 }],
    minutes: [{ timestamp: "2026-01-05T14:30:00+08:00", close: 3199 }],
  };
  const file = await write("prices.json", body);
  assert.equal(run("prices", file).status, 0);
  const before = (await read("work/monitor-state.json")).dataset;
  assert.equal(before.updatedAt, body.updatedAt);
  body.minutes[0].close = -1;
  await write("prices.json", body);
  assert.notEqual(run("prices", file).status, 0);
  assert.deepEqual((await read("work/monitor-state.json")).dataset, before);
});
test("跨帧关系与无证据语义引用不能进入档案", async (t) => {
  const { run, read, write } = await fixture(t);
  const body = JSON.parse(
    await fs.readFile(path.join(project, "examples/observation.json"), "utf8"),
  );
  body.record.observations.push({
    ...body.record.observations[0],
    id: "second",
    frameIndex: 1,
  });
  body.record.observations[0].relations = [
    { type: "on_top_of", targetId: "second", verified: true },
  ];
  const file = await write("invalid.json", body);
  assert.notEqual(run("import", file).status, 0);
  assert.equal((await read("work/monitor-state.json")).records.length, 0);
  body.record.observations[0].relations = [];
  body.record.semanticCandidates = [
    {
      id: "bad",
      cue: "test",
      evidenceIds: ["not-an-object"],
      mechanism: "test",
      meaning: "test",
      bias: "unknown",
      scope: "test",
      horizon: "unknown",
      confidence: "low",
      alternatives: ["decoration"],
    },
  ];
  await write("invalid.json", body);
  assert.notEqual(run("import", file).status, 0);
  assert.equal((await read("work/monitor-state.json")).records.length, 0);
});

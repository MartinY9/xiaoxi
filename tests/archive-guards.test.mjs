import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
const project = path.resolve(import.meta.dirname, "..");
async function fixture(t) {
  const base = path.join(project, "work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "archive-guard-"));
  for (const n of ["lib", "scripts"])
    await fs.cp(path.join(project, n), path.join(root, n), { recursive: true });
  await fs.copyFile(
    path.join(project, "package.json"),
    path.join(root, "package.json"),
  );
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const run = (script, args = []) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
    });
  assert.equal(run("scripts/cli.mjs", ["init"]).status, 0);
  return { root, run };
}
test("损坏JSON拒绝写入，既有字节不变", async (t) => {
  const { root, run } = await fixture(t),
    file = path.join(root, "work/monitor-state.json"),
    broken = '{"records": invalid';
  await fs.writeFile(file, broken);
  const r = run("scripts/local-monitor.mjs", ["status"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Existing archive cannot be read/);
  assert.equal(await fs.readFile(file, "utf8"), broken);
});
test("合成目录不能混入真实观察或行情，也不发起行情抓取", async (t) => {
  const { root, run } = await fixture(t),
    file = path.join(root, "work/monitor-state.json"),
    state = JSON.parse(await fs.readFile(file, "utf8"));
  state.synthetic = true;
  await fs.writeFile(file, JSON.stringify(state));
  const before = await fs.readFile(file, "utf8");
  const body = JSON.parse(
    await fs.readFile(path.join(project, "examples/observation.json"), "utf8"),
  );
  await fs.writeFile(path.join(root, "input.json"), JSON.stringify(body));
  let r = run("scripts/cli.mjs", ["import", "input.json"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /合成演示目录禁止/);
  r = run("scripts/local-monitor.mjs", ["market"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /合成演示目录禁止/);
  assert.equal(await fs.readFile(file, "utf8"), before);
});
test("已核实物件不得借用其他视频的截图", async (t) => {
  const { root, run } = await fixture(t),
    statePath = path.join(root, "work/monitor-state.json"),
    state = JSON.parse(await fs.readFile(statePath, "utf8"));
  state.records = [
    {
      id: "new-record",
      observations: [{ id: "object", frameIndex: 0, evidenceTime: 4 }],
    },
  ];
  await fs.writeFile(statePath, JSON.stringify(state));
  const index = {
      shots: [
        {
          recordId: "other-record",
          key: "foreign",
          frameIndex: 0,
          time: 4,
          width: 1280,
          height: 720,
        },
      ],
      attachments: [],
    },
    indexPath = path.join(root, "work/evidence-index.json");
  await fs.writeFile(indexPath, JSON.stringify(index));
  await fs.writeFile(
    path.join(root, "input.json"),
    JSON.stringify({
      recordId: "new-record",
      shots: [],
      attachments: [
        { observationId: "object", shotKey: "foreign", crop: [1, 1, 20, 20] },
      ],
    }),
  );
  const r = run("scripts/cli.mjs", ["evidence", "input.json"]);
  assert.notEqual(r.status, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(indexPath, "utf8")), index);
});

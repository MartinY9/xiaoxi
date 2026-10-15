import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
async function saveJSON(file, data) {
  await fs.writeFile(file + ".tmp", JSON.stringify(data, null, 2));
  await fs.rename(file + ".tmp", file);
}
function workspaceFile(root, value) {
  const resolved = path.resolve(root, value);
  if (!resolved.startsWith(root + path.sep))
    throw Error("Configuration must stay inside the workspace");
  return resolved;
}
async function publishDefault(root, connection) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, "scripts", "publish-site.mjs"),
        "publish",
        "--workspace",
        root,
        "--config",
        connection,
      ],
      { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let tail = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (b) => {
        tail = (tail + b).slice(-5000);
      });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(Error("Publisher failed: " + tail)),
    );
  });
}

export async function syncReport({
  root,
  force = false,
  ackNotice = false,
  publish = publishDefault,
  fetchPublic = async (url) => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(25000),
      redirect: "error",
    });
    if (response.status !== 200)
      throw Error("Public page HTTP " + response.status);
    return Buffer.from(await response.arrayBuffer());
  },
  now = () => new Date().toISOString(),
}) {
  root = path.resolve(root);
  const work = path.join(root, "work");
  const config = await readJSON(path.join(work, "site-publish-config.json"), {
    enabled: false,
  });
  if (config.enabled !== true) return { status: "disabled", uploaded: false };
  await fs.mkdir(work, { recursive: true });
  const statePath = path.join(work, "site-publish-state.json");
  const lockPath = path.join(work, "site-publish.lock");
  let lock;
  try {
    lock = await fs.open(lockPath, "wx");
  } catch (e) {
    if (e.code === "EEXIST") return { status: "busy", uploaded: false };
    throw e;
  }
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: now() }),
    );
    const state = await readJSON(statePath, {});
    if (ackNotice) {
      if (state.notice) state.notice.pending = false;
      await saveJSON(statePath, state);
      return { status: "acknowledged" };
    }
    const report = await fs.readFile(path.join(root, "public", "report.html"));
    const reportSHA256 = digest(report);
    if (!force && state.lastSuccess?.reportSHA256 === reportSHA256)
      return {
        status: "unchanged",
        uploaded: false,
        notice: state.notice?.pending ? state.notice : null,
      };
    const connectionPath = workspaceFile(root, config.connectionConfig);
    const connection = await readJSON(connectionPath);
    const url = new URL(connection.publicUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error("Use a public site URL without credentials");
    state.lastAttemptAt = now();
    await saveJSON(statePath, state);
    try {
      await publish(root, connectionPath);
      const remote = await fetchPublic(url.href);
      if (digest(remote) !== reportSHA256)
        throw Error("Published page SHA-256 differs from the prepared report");
      const recovered = state.status === "failed";
      state.status = "ok";
      state.lastSuccess = {
        at: now(),
        reportSHA256,
        url: url.href,
        bytes: remote.length,
      };
      delete state.lastError;
      state.notice = recovered
        ? { kind: "recovered", pending: true, at: now() }
        : null;
      await saveJSON(statePath, state);
      return {
        status: "published",
        uploaded: true,
        verified: true,
        ...state.lastSuccess,
        notice: state.notice,
      };
    } catch (e) {
      const firstFailure = state.status !== "failed";
      state.status = "failed";
      state.lastError = { at: now(), message: String(e.message).slice(-2000) };
      if (firstFailure)
        state.notice = { kind: "publish-failed", pending: true, at: now() };
      await saveJSON(statePath, state);
      return {
        status: "failed",
        uploaded: false,
        verified: false,
        previousSuccessRetained: Boolean(state.lastSuccess),
        notice: state.notice?.pending ? state.notice : null,
      };
    }
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  syncReport({
    root,
    force: process.argv.includes("--force"),
    ackNotice: process.argv.includes("--ack-notice"),
  })
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.status === "failed") process.exitCode = 1;
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { publicContentIssues } from "../lib/public-content.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2),
  action = args[0] || "prepare";
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith("--"))
    throw Error("Missing value: " + name);
  return args[i + 1];
};
const root = path.resolve(option("--workspace", path.dirname(here)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));

export async function prepareSite(rootDirectory = root) {
  const root = path.resolve(rootDirectory);
  const stageRoot = path.join(root, "work", "site-releases");
  const html = await fs.readFile(path.join(root, "public", "report.html"));
  const text = html.toString("utf8");
  if (text.includes('data-report-mode="synthetic"'))
    throw Error("This deployment requires the real report");
  const privacyIssues = publicContentIssues(text);
  if (privacyIssues.length)
    throw Error(
      "Private reference detected in public HTML: " + privacyIssues.join(", "),
    );
  const index = await json(path.join(root, "work", "evidence-index.json"));
  const report = await json(path.join(root, "outputs", "可视化报告数据.json"));
  const references = [
    ...new Set(
      [...text.matchAll(/\/evidence\/([A-Za-z0-9_.-]+\.jpg)/g)].map(
        (m) => m[1],
      ),
    ),
  ].sort();
  if (!references.length) throw Error("No real screenshot references");
  const release =
    new Date().toISOString().replace(/[-:.]/g, "") +
    "-" +
    randomBytes(4).toString("hex");
  const directory = path.join(stageRoot, release),
    site = path.join(directory, "site");
  await fs.mkdir(path.join(site, "evidence"), { recursive: true });
  const files = { "index.html": { sha256: sha(html), bytes: html.length } };
  await fs.writeFile(path.join(site, "index.html"), html, { flag: "wx" });
  for (const filename of references) {
    const entry = index.shots.find((s) => s.file === filename);
    if (!entry || path.basename(filename) !== filename)
      throw Error("Unregistered image: " + filename);
    const bytes = await fs.readFile(
      path.join(root, "public", "evidence", filename),
    );
    if (bytes[0] !== 255 || bytes[1] !== 216 || sha(bytes) !== entry.sha256)
      throw Error("Image integrity mismatch: " + filename);
    await fs.writeFile(path.join(site, "evidence", filename), bytes, {
      flag: "wx",
    });
    files["evidence/" + filename] = {
      sha256: entry.sha256,
      bytes: bytes.length,
    };
  }
  const manifest = {
    release,
    preparedAt: new Date().toISOString(),
    reportGeneratedAt: report.generatedAt,
    records: report.items.length,
    screenshots: references.length,
    files,
  };
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(stageRoot, "latest.json"),
    JSON.stringify({ release, directory }, null, 2),
  );
  console.log(
    JSON.stringify({
      prepared: true,
      uploaded: false,
      directory,
      records: manifest.records,
      screenshots: manifest.screenshots,
    }),
  );
  return { directory, manifest };
}

async function config() {
  const c = await json(
    path.resolve(option("--config", path.join(root, "work", "deploy.json"))),
  );
  if (
    !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(c.host || "") ||
    !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(c.user || "")
  )
    throw Error("Fill the confirmed SSH host and username first");
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535)
    throw Error("Invalid SSH port");
  return c;
}

function execute(binary, argv, input) {
  const r = spawnSync(binary, argv, {
    input,
    encoding: "utf8",
    timeout: 1800000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw Error(
      binary + " failed (" + r.status + "): " + (r.stderr || r.stdout),
    );
  return r.stdout;
}

const sshArgs = (c) => [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ConnectTimeout=10",
  ...(c.knownHostsFile
    ? ["-o", "UserKnownHostsFile=" + path.resolve(c.knownHostsFile)]
    : []),
  "-p",
  String(c.port),
  ...(c.identityFile ? ["-i", path.resolve(c.identityFile)] : []),
  c.user + "@" + c.host,
];
const sftpArgs = (c) => [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ConnectTimeout=10",
  ...(c.knownHostsFile
    ? ["-o", "UserKnownHostsFile=" + path.resolve(c.knownHostsFile)]
    : []),
  "-P",
  String(c.port),
  ...(c.identityFile ? ["-i", path.resolve(c.identityFile)] : []),
  "-b",
  "-",
  c.user + "@" + c.host,
];
const quotedSftp = (value) => {
  if (/[\r\n\0"]/.test(value)) throw Error("Unsupported transfer path");
  return '"' + value.replaceAll("\\", "/") + '"';
};

async function remote(c, mode, manifest) {
  if (
    !/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(c.remoteBase || "") ||
    c.remoteBase.split("/").some((s) => s === "." || s === "..")
  )
    throw Error(
      "Set a confirmed dedicated absolute remoteBase, for example /srv/xiaoxi",
    );
  const program = await fs.readFile(
    path.join(here, "deploy", "static-publish.py"),
    "utf8",
  );
  const payload = Buffer.from(
    JSON.stringify({ mode, remoteBase: c.remoteBase, manifest }),
  ).toString("base64");
  const source =
    program +
    '\nimport base64\nrun(json.loads(base64.b64decode("' +
    payload +
    '")))\n';
  return JSON.parse(
    execute("ssh", [...sshArgs(c), "python3", "-"], source).trim(),
  );
}

async function main() {
  if (action === "prepare") {
    await prepareSite();
    return;
  }
  if (action === "check") {
    const c = await config();
    const inspection = await fs.readFile(
      path.join(here, "deploy", "inspect-ubuntu.sh"),
      "utf8",
    );
    console.log(
      execute(
        "ssh",
        [...sshArgs(c), "bash", "-s"],
        inspection.replaceAll("\r\n", "\n"),
      ),
    );
    return;
  }
  if (action !== "publish")
    throw Error("Usage: prepare | check --config PATH | publish --config PATH");
  const c = await config();
  // An explicit publish command is required; prepare/check never upload files.
  const prepared = await prepareSite();
  const plan = await remote(c, "plan", prepared.manifest);
  if (
    plan.stage !== c.remoteBase + "/incoming/" + prepared.manifest.release ||
    plan.site !== c.remoteBase + "/site"
  )
    throw Error("Unexpected remote staging path");
  if (
    !Array.isArray(plan.missing) ||
    plan.missing.some((n) => !prepared.manifest.files[n] || n === "index.html")
  )
    throw Error("Invalid remote upload plan");
  const lines = [
    "put " +
      quotedSftp(path.join(prepared.directory, "site", "index.html")) +
      " " +
      quotedSftp(plan.stage + "/index.html"),
  ];
  for (const name of plan.missing)
    lines.push(
      "put " +
        quotedSftp(path.join(prepared.directory, "site", name)) +
        " " +
        quotedSftp(plan.stage + "/" + name),
    );
  execute("sftp", sftpArgs(c), lines.join("\n") + "\n");
  const activated = await remote(c, "activate", prepared.manifest);
  await fs.writeFile(
    path.join(prepared.directory, "publish-result.json"),
    JSON.stringify(
      {
        ...activated,
        publishedAt: new Date().toISOString(),
        host: c.host,
        user: c.user,
        transferredImages: plan.missing.length,
        publicUrlNotVerified: c.publicUrl || null,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ...activated,
      uploaded: true,
      transferredImages: plan.missing.length,
      urlVerified: false,
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });

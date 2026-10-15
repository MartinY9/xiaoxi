import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const topFiles = new Set([
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "NOTICE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  ".gitignore",
  ".gitattributes",
  ".nvmrc",
  "SOURCE-MANIFEST.json",
]);
const directories = new Set([
  "lib",
  "scripts",
  "tests",
  "examples",
  "docs",
  ".github",
]);
const rules = [
  {
    name: "个人主目录路径",
    re: /\b[A-Za-z]:[\\/]+Users[\\/]+|\/Users\/[A-Za-z0-9_-]+\/|\/home\/[A-Za-z0-9_-]+\//,
  },
  { name: "个人QQ邮箱", re: /\b[0-9]{5,}@qq\.com\b/i },
  { name: "API密钥格式", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/ },
  {
    name: "GitHub令牌格式",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  },
  {
    name: "私钥",
    re: new RegExp("-----BEGIN " + "(?:[A-Z]+ )?" + "PRIVATE " + "KEY-----"),
  },
  { name: "长Bearer凭据", re: /Bearer\s+[A-Za-z0-9_.-]{30,}/ },
  {
    name: "浏览器会话凭据",
    re: /\b(?:sessionid|sessionid_ss|ttwid|msToken|access_token|refresh_token)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9%._-]{16,}/i,
  },
];
async function walk(root, relative = "") {
  const files = [];
  for (const e of await fs.readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    if (
      !relative &&
      [".git", "node_modules", "work", "outputs", "public"].includes(e.name)
    )
      continue;
    const rel = path.posix.join(relative, e.name);
    if (e.isDirectory()) files.push(...(await walk(root, rel)));
    else files.push(rel);
  }
  return files;
}
export async function checkRelease(root) {
  root = path.resolve(root);
  let files,
    mode = "source-tree";
  let top;
  const indexed = new Set();
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* A clean ZIP can be checked before git init. */
  }
  if (top && path.resolve(top) === root) {
    files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean);
    mode = "git-index-and-unignored";
    for (const name of execFileSync("git", ["ls-files", "--cached", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean))
      indexed.add(name.replaceAll("\\", "/"));
  }
  files = [...new Set(files || (await walk(root)))].sort();
  const issues = [];
  for (const relative of files) {
    const rel = relative.replaceAll("\\", "/"),
      pieces = rel.split("/");
    if (!topFiles.has(rel) && !directories.has(pieces[0])) {
      issues.push({ file: rel, rule: "不在公开源码允许目录" });
      continue;
    }
    const resolved = path.resolve(root, rel);
    if (!resolved.startsWith(root + path.sep)) {
      issues.push({ file: rel, rule: "路径越界" });
      continue;
    }
    let st;
    try {
      st = await fs.lstat(resolved);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      issues.push({ file: rel, rule: "暂存或列出的文件在工作区缺失" });
    }
    if (st?.isSymbolicLink()) {
      issues.push({ file: rel, rule: "源码包不接收符号链接" });
      continue;
    }
    if (
      /\.(?:jpe?g|png|webp|mp4|mov|pem|key|ppk|pub|p12|pfx|env|zip)$/i.test(
        rel,
      ) ||
      /(?:^|\/)(?:id_ed25519[^/]*|id_rsa[^/]*|known_hosts[^/]*|authorized_keys[^/]*|deploy\.json|site-publish-config\.json|[^/]*storage-state[^/]*\.json|cookies[^/]*\.json)$/i.test(
        rel,
      )
    ) {
      issues.push({ file: rel, rule: "包含运行图片、视频、凭据或打包文件" });
      continue;
    }
    const versions = [];
    if (st)
      versions.push({ source: "worktree", bytes: await fs.readFile(resolved) });
    if (indexed.has(rel))
      versions.push({
        source: "git-index",
        bytes: execFileSync("git", ["show", ":" + rel], {
          cwd: root,
          stdio: ["ignore", "pipe", "ignore"],
          maxBuffer: 16 * 1024 * 1024,
        }),
      });
    for (const { source, bytes } of versions) {
      if (bytes.includes(0)) {
        issues.push({ file: rel, rule: "存在未声明的二进制文件", source });
        continue;
      }
      const content = bytes.toString("utf8");
      for (const r of rules)
        if (r.re.test(content))
          issues.push({ file: rel, rule: r.name, source });
    }
  }
  for (const required of [
    "README.md",
    "LICENSE",
    "NOTICE.md",
    "package.json",
    "package-lock.json",
    ".gitignore",
  ])
    if (!files.includes(required))
      issues.push({ file: required, rule: "缺少发布必需文件" });
  return { ok: issues.length === 0, mode, checkedFiles: files.length, issues };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await checkRelease(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

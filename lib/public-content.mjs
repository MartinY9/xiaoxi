// Return rule names only. Never put matched credential values into logs.
export function publicContentIssues(text) {
  const rules = [
    [
      "personal-path",
      /\b[A-Za-z]:[\\/]+Users[\\/]+|\/Users\/[A-Za-z0-9_-]+\/|\/home\/[A-Za-z0-9_-]+\//,
    ],
    ["local-file-url", /file:\/\//i],
    ["personal-qq-email", /\b[0-9]{5,}@qq\.com\b/i],
    [
      "private-key",
      new RegExp("-----BEGIN " + "(?:[A-Z]+ )?" + "PRIVATE " + "KEY-----"),
    ],
    ["api-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
    [
      "github-token",
      /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
    ],
    ["bearer-token", /Bearer\s+[A-Za-z0-9_.-]{30,}/],
    [
      "session-credential",
      /\b(?:sessionid|sessionid_ss|ttwid|msToken|access_token|refresh_token)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9%._-]{16,}/i,
    ],
    ["inline-image", /data:image\/(?:jpeg|png|webp);base64,/i],
  ];
  return rules
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

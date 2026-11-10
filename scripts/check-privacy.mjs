import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const excluded = new Set([".git", "node_modules", ".artifacts", "coverage"]);
const folders = new Set(["client", "server", "shared", "tests", "scripts", "assets", ".github"]);
const rootFiles = new Set([
  "package.json",
  "package-lock.json",
  "paseo-plugin.json",
  "tsconfig.json",
  "biome.json",
  ".gitignore",
  ".npmrc",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "OVERVIEW.md",
  "OVERVIEW.zh-CN.md",
  "PRIVACY.md",
  "index.client.tsx",
  "index.server.ts",
]);
const publicHosts = new Set([
  "github.com",
  "registry.npmjs.org",
  "paseo.sh",
  "learn.chatgpt.com",
  "biomejs.dev",
  "opencollective.com",
  "tidelift.com",
  "feross.org",
  "www.patreon.com",
  "paulmillr.com",
  "www.npmjs.com",
  "opensource.org",
  "127.0.0.1",
  "localhost",
  "[::1]",
  "paypal.me",
  "www.i18next.com",
  "www.locize.com",
]);
const patterns = [
  /(?:\/data\d+)?\/home\/[^\s/"'<>]+\//,
  /[A-Za-z]:\\Users\\[^\s\\"'<>]+\\/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
  /\bBearer\s+[A-Za-z0-9._~-]{25,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}/,
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
];
const findings = new Set();

function checkFile(path, content) {
  const name = basename(path);
  if (
    /\.(?:sqlite\d*|db|jsonl|log)(?:-|$)|^\.env(?:\.|$)|^(?:auth\.json|config\.json|local-credential|paseo\.pid)$/.test(
      name,
    )
  ) {
    findings.add(`${path}: forbidden data file`);
  }
  if (path.endsWith(".png")) {
    if (
      !path.startsWith("assets/") ||
      content.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      findings.add(`${path}: unexpected image`);
    return;
  }
  const text = content.toString("utf8");
  if (patterns.some((pattern) => pattern.test(text)))
    findings.add(`${path}: potential private path or credential`);
  const emails = text.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g);
  for (const [email] of emails) {
    // Public npm deprecation notices can contain the upstream maintainer's contact.
    if (path !== "package-lock.json" && !email.endsWith("@users.noreply.github.com"))
      findings.add(`${path}: potential personal email`);
  }
  for (const [raw] of text.matchAll(/https?:\/\/[A-Za-z0-9[\]][^\s"'<>`$}{)\]]*/g)) {
    try {
      if (!publicHosts.has(new URL(raw).hostname)) findings.add(`${path}: unreviewed URL host`);
    } catch {
      findings.add(`${path}: malformed URL`);
    }
  }
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    const path = relative(root, absolute).replaceAll("\\", "/");
    if (entry.isSymbolicLink()) {
      findings.add(`${path}: symlink is not publishable`);
      continue;
    }
    if (directory === root.replace(/\/$/, "") || directory === root) {
      if (entry.isDirectory() && !folders.has(entry.name))
        findings.add(`${path}: unexpected top-level directory`);
      if (entry.isFile() && !rootFiles.has(entry.name))
        findings.add(`${path}: unexpected top-level file`);
    }
    if (entry.isDirectory()) walk(absolute);
    else checkFile(path, readFileSync(absolute));
  }
}

walk(root);
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
for (const [name, entry] of Object.entries(lock.packages)) {
  if (entry.resolved && !entry.resolved.startsWith("https://registry.npmjs.org/"))
    findings.add(`${name}: non-public dependency origin`);
}
const npmrc = readFileSync(join(root, ".npmrc"), "utf8").trim().split("\n");
for (const line of npmrc) {
  if (!["registry=https://registry.npmjs.org/", "fund=false", "audit=false"].includes(line.trim()))
    findings.add(".npmrc: unreviewed configuration");
}

if (
  existsSync(join(root, ".git")) &&
  spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, stdio: "ignore" }).status === 0
) {
  const identities = execFileSync("git", ["log", "--all", "--format=%ae%n%ce"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  for (const email of identities) {
    if (!email.endsWith("@users.noreply.github.com"))
      findings.add("Git history: non-private author or committer email");
  }
  const objects = execFileSync("git", ["rev-list", "--objects", "--all"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  for (const object of objects) {
    const separator = object.indexOf(" ");
    if (separator < 0) continue;
    const sha = object.slice(0, separator);
    const path = object.slice(separator + 1);
    const type = execFileSync("git", ["cat-file", "-t", sha], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    if (type === "blob")
      checkFile(
        path,
        execFileSync("git", ["cat-file", "blob", sha], { cwd: root, maxBuffer: 8 * 1024 * 1024 }),
      );
  }
}

if (findings.size) {
  for (const finding of findings) process.stderr.write(`${finding}\n`);
  process.exitCode = 1;
} else
  process.stdout.write(
    "Privacy checks passed for source, dependency origins, and available Git history. Review images and staged files before publication.\n",
  );

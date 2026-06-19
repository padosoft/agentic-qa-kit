import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const cwd = process.cwd();
const repoRoot = basename(cwd) === "docs-site" ? join(cwd, "..") : cwd;
const docsDir = join(repoRoot, "docs-site", "docs");
const siteDir = join(repoRoot, "_site");

const allowedMarkdownHtml = /```[\s\S]*?```/g;
const rawHtmlPattern = /<([a-z][a-z0-9-]*)(\s|>|\/>)/i;
const leakedContainerPattern = /:::\s*(callout|tabs|steps|collapsible|grids|grid|card|button|warning|tip|danger|info|note|caution)/i;

function walk(dir, predicate = () => true) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path, predicate));
    } else if (predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

function stripCodeBlocks(markdown) {
  return markdown.replace(allowedMarkdownHtml, "");
}

if (!existsSync(docsDir)) {
  throw new Error(`Missing docs source directory: ${docsDir}`);
}

for (const file of walk(docsDir, (path) => path.endsWith(".md"))) {
  const body = stripCodeBlocks(readFileSync(file, "utf8"));
  if (rawHtmlPattern.test(body)) {
    throw new Error(`Raw HTML is not allowed in docs markdown: ${file}`);
  }
  if (/:::\s*button/i.test(body)) {
    throw new Error(`docmd button containers are not allowed: ${file}`);
  }
}

if (existsSync(siteDir)) {
  for (const file of walk(siteDir, (path) => path.endsWith(".html"))) {
    const html = readFileSync(file, "utf8");
    if (leakedContainerPattern.test(html)) {
      throw new Error(`Leaked docmd container marker in built HTML: ${file}`);
    }
  }
}

console.log("docs guard passed");

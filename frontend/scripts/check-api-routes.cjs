#!/usr/bin/env node

const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const scanRoots = ["app", "components", "hooks", "lib"].map((dir) => path.join(root, dir))

const allowedApiPrefixes = [
  "/api/chat/stream",
  "/api/retrieval/search",
  "/api/admin/logs",
  "/api/feedback",
  "/api/conversations",
]

const forbiddenApiPaths = [
  {
    path: "/api/chat",
    reason: "production nginx maps /api/chat to backend /chat, not /chat/stream",
    use: "/api/chat/stream",
  },
  {
    path: "/api/logs",
    reason: "backend logs endpoint is /admin/logs",
    use: "/api/admin/logs",
  },
  {
    path: "/api/search",
    reason: "search debug endpoint is /retrieval/search",
    use: "/api/retrieval/search",
  },
]

const extensions = new Set([".ts", ".tsx", ".js", ".jsx"])
const ignoreDirs = new Set([".next", "node_modules", "logs"])

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) continue
      walk(path.join(dir, entry.name), files)
      continue
    }
    if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name))
    }
  }
  return files
}

function lineColumn(content, index) {
  const prefix = content.slice(0, index)
  const lines = prefix.split(/\r?\n/)
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

const failures = []
const files = scanRoots.flatMap((dir) => walk(dir))

for (const file of files) {
  const content = fs.readFileSync(file, "utf8")

  for (const rule of forbiddenApiPaths) {
    let start = 0
    while (true) {
      const idx = content.indexOf(rule.path, start)
      if (idx === -1) break
      start = idx + rule.path.length

      const after = content[idx + rule.path.length] ?? ""
      if (after === "/") continue
      if (/[-_A-Za-z0-9]/.test(after)) continue

      const loc = lineColumn(content, idx)
      failures.push({ file, ...loc, rule })
    }
  }
}

if (failures.length > 0) {
  console.error("Forbidden frontend API routes found. Production nginx forwards /api/* directly to backend.")
  console.error("Use only production-compatible backend paths from the browser:")
  for (const route of allowedApiPrefixes) console.error(`  - ${route}`)
  console.error("")

  for (const failure of failures) {
    const rel = path.relative(root, failure.file).replace(/\\/g, "/")
    console.error(`${rel}:${failure.line}:${failure.column} uses ${failure.rule.path}`)
    console.error(`  reason: ${failure.rule.reason}`)
    console.error(`  use: ${failure.rule.use}`)
  }
  process.exit(1)
}

console.log(`API route check passed (${files.length} files scanned).`)
#!/usr/bin/env node
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const repliesPath = path.join(process.cwd(), ".review", "replies.json")

if (!fs.existsSync(repliesPath)) {
  process.exit(0)
}

let replies
try {
  const raw = fs.readFileSync(repliesPath, "utf-8")
  replies = JSON.parse(raw)
} catch {
  process.exit(0)
}

if (!Array.isArray(replies) || replies.length === 0) {
  process.exit(0)
}

let output = "[clodiff replies]\n"
for (const reply of replies) {
  output += `<reply id="${reply.id}" comment_id="${reply.comment_id}" created_at="${reply.created_at}">\n`
  output += reply.body + "\n"
  output += "</reply>\n"
}

process.stdout.write(output)

// Clear replies after reading
fs.writeFileSync(repliesPath, "[]", "utf-8")

import { readFile, writeFile, mkdir, copyFile } from "fs/promises"
import { join, dirname } from "path"
import { existsSync } from "fs"
import { spawnSync } from "child_process"
import { parseDiff } from "./diff-parser"
import { loadSession, saveSession } from "./session"
import type { SessionFile, Review } from "./session"
import { reanchorComments } from "./anchoring"
import { startServer } from "./server"

export interface CliArgs {
  base: string
  port: number
  resume: boolean
  stdin: boolean
  patch?: string
  from?: string
  to?: string
  installHooks: boolean
}

function nextValue(argv: string[], i: number, flag: string): string {
  const val = argv[i + 1]
  if (val === undefined || val.startsWith("--")) throw new Error(`${flag} requires a value`)
  return val
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    base: "main",
    port: 7777,
    resume: false,
    stdin: false,
    installHooks: false,
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]

    if (arg === "--base") {
      args.base = nextValue(argv, i, "--base")
      i++
    } else if (arg === "--port") {
      args.port = parseInt(nextValue(argv, i, "--port"), 10)
      if (isNaN(args.port)) throw new Error("--port must be a valid number")
      i++
    } else if (arg === "--resume") {
      args.resume = true
    } else if (arg === "--stdin") {
      args.stdin = true
    } else if (arg === "--patch") {
      args.patch = nextValue(argv, i, "--patch")
      i++
    } else if (arg === "--from") {
      args.from = nextValue(argv, i, "--from")
      i++
    } else if (arg === "--to") {
      args.to = nextValue(argv, i, "--to")
      i++
    } else if (arg === "--install-hooks") {
      args.installHooks = true
    } else if (arg.startsWith("--")) {
      throw new Error("Unknown flag: " + arg)
    }

    i++
  }

  if ((args.from && !args.to) || (!args.from && args.to)) {
    throw new Error("--from and --to must be provided together")
  }

  return args
}

export async function installHooks(repoDir: string): Promise<void> {
  const settingsDir = join(repoDir, ".claude")
  const settingsPath = join(settingsDir, "settings.json")

  await mkdir(settingsDir, { recursive: true })

  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    const raw = await readFile(settingsPath, "utf-8")
    settings = JSON.parse(raw)
  }

  const hooksConfig = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "node .review/hooks/inject-replies.js" }] },
      ],
      SessionStart: [
        { hooks: [{ type: "command", command: "node .review/hooks/load-session.js" }] },
      ],
    },
  }

  const existingHooks = typeof settings.hooks === "object" && settings.hooks !== null
    ? settings.hooks as Record<string, unknown[]>
    : {}

  const merged: Record<string, unknown[]> = { ...existingHooks }
  for (const [event, entries] of Object.entries(hooksConfig.hooks)) {
    const existing = Array.isArray(merged[event]) ? merged[event] : []
    merged[event] = [...existing, ...entries]
  }
  settings = { ...settings, hooks: merged }
  await writeFile(settingsPath, JSON.stringify(settings, null, 2))

  // Copy hook scripts to .review/hooks/
  const hooksTargetDir = join(repoDir, ".review", "hooks")
  await mkdir(hooksTargetDir, { recursive: true })

  // Source hooks are relative to this file's location, in the project root hooks/ dir
  const hooksSourceDir = join(dirname(import.meta.path), "..", "hooks")
  await copyFile(
    join(hooksSourceDir, "inject-replies.js"),
    join(hooksTargetDir, "inject-replies.js")
  )
  await copyFile(
    join(hooksSourceDir, "load-session.js"),
    join(hooksTargetDir, "load-session.js")
  )
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf-8")
}

function getHeadCommit(repoDir: string): string {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      encoding: "utf-8",
    })
    return result.stdout.trim()
  } catch {
    return "unknown"
  }
}

function openBrowser(url: string): void {
  const platform = process.platform
  if (platform === "darwin") {
    spawnSync("open", [url])
  } else if (platform === "win32") {
    spawnSync("cmd", ["/c", "start", url])
  } else {
    spawnSync("xdg-open", [url])
  }
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const repoDir = process.cwd()

  if (args.installHooks) {
    await installHooks(repoDir)
    console.log("clodiff: hooks installed to .claude/settings.json")
    process.exit(0)
  }

  // --- Determine diff text ---
  let diffText: string

  if (args.stdin) {
    diffText = await readStdin()
  } else if (args.patch) {
    diffText = await readFile(args.patch, "utf-8")
  } else if (args.from && args.to) {
    const result = spawnSync("git", ["diff", args.from, args.to], {
      cwd: repoDir,
      encoding: "utf-8",
    })
    diffText = result.stdout
  } else {
    const result = spawnSync("git", ["diff", args.base], {
      cwd: repoDir,
      encoding: "utf-8",
    })
    diffText = result.stdout
  }

  const parsedDiff = parseDiff(diffText)

  // --- Load or create session ---
  const existingSession = await loadSession(repoDir)
  const headCommit = getHeadCommit(repoDir)

  let session: SessionFile

  if (existingSession && !args.resume) {
    // Warn and continue with existing session, don't overwrite
    console.warn("clodiff: existing session found, continuing (use --resume to suppress this warning)")
    session = existingSession
  } else if (existingSession && args.resume) {
    session = existingSession
  } else {
    // Create a new session
    const now = new Date().toISOString()
    const review: Review = {
      id: crypto.randomUUID(),
      commit_id: headCommit,
      event: "COMMENT",
      comments: [],
      created_at: now,
      source: "claude-code",
    }
    session = {
      version: 1,
      repo: repoDir,
      base_branch: args.base,
      head_commit: headCommit,
      current_commit: headCommit,
      reviews: [review],
      created_at: now,
      updated_at: now,
    }
  }

  // Re-anchor comments if HEAD changed since last save
  if (session.current_commit && session.current_commit !== headCommit && parsedDiff.length > 0) {
    const allComments = session.reviews.flatMap(r => r.comments)
    const reanchored = reanchorComments(allComments, parsedDiff)
    // Distribute reanchored comments back to reviews (by id)
    const commentMap = new Map(reanchored.map(c => [c.id, c]))
    for (const review of session.reviews) {
      review.comments = review.comments.map(c => commentMap.get(c.id) ?? c)
    }
    session.current_commit = headCommit
  }

  // Start the server
  const { port, server: _server } = await startServer({
    port: args.port,
    repoDir,
    viewerDir: join(dirname(import.meta.path), "..", "viewer"),
    getInitPayload: async () => {
      const freshSession = (await loadSession(repoDir)) ?? session
      return {
        type: "init",
        diff: parsedDiff,
        comments: freshSession.reviews.flatMap((r) => r.comments),
        session: freshSession,
      }
    },
  })

  // Update session with actual port (may differ if port was taken)
  session.port = port

  await saveSession(repoDir, session)

  const url = `http://localhost:${port}`

  openBrowser(url)

  console.log(`clodiff: listening at ${url}`)
}

if (import.meta.main) {
  main().catch(console.error)
}

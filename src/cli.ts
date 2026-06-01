#!/usr/bin/env node
import { readFile } from "fs/promises"
import { join } from "path"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"
import { parseDiff } from "./diff-parser.ts"
import { loadSession, saveSession } from "./session.ts"
import type { SessionFile, Review } from "./session.ts"
import { reanchorComments } from "./anchoring.ts"
import { startServer } from "./server.ts"
import { fetchPRInfo, fetchPRThreads, fetchPRConversation } from "./github.ts"

// Sentinel "to" endpoint meaning the working tree (uncommitted changes), as
// opposed to a committed ref. `git diff <from>` (no second arg) compares the
// working tree to <from>.
export const WORKING_TREE = "WORKING"

export interface CliArgs {
  base: string
  port: number
  resume: boolean
  stdin: boolean
  patch?: string
  from?: string
  to?: string
  working?: boolean
  pr?: number
}

function nextValue(argv: string[], i: number, flag: string): string {
  const val = argv[i + 1]
  if (val === undefined || val.startsWith("--")) throw new Error(`${flag} requires a value`)
  return val
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    base: "",
    port: 7777,
    resume: false,
    stdin: false,
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
    } else if (arg === "--working" || arg === "--uncommitted") {
      args.working = true
    } else if (arg === "--pr") {
      const n = parseInt(nextValue(argv, i, "--pr"), 10)
      if (isNaN(n)) throw new Error("--pr must be a valid number")
      args.pr = n
      i++
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf-8")
}

function getHeadCommit(repoDir: string): string {
  return resolveRef(repoDir, "HEAD")
}

function resolveRef(repoDir: string, ref: string): string {
  try {
    const result = spawnSync("git", ["rev-parse", ref], {
      cwd: repoDir,
      encoding: "utf-8",
    })
    return result.stdout.trim() || "unknown"
  } catch {
    return "unknown"
  }
}

function runGitDiff(repoDir: string, from: string, to: string): string {
  const opts = { cwd: repoDir, encoding: "utf-8" as const, maxBuffer: 50 * 1024 * 1024 }

  if (to === WORKING_TREE) {
    // Uncommitted changes vs `from`: tracked changes (`git diff <from>`) plus
    // untracked files rendered as new-file diffs. We use `git diff --no-index`
    // per untracked file so the index is never modified.
    const tracked = spawnSync("git", ["diff", from], opts)
    if (tracked.error) throw tracked.error
    let out = tracked.stdout
    const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], opts)
      .stdout.split("\n").map((s) => s.trim()).filter(Boolean)
    for (const file of untracked) {
      // --no-index exits 1 when files differ (expected); stdout holds the diff.
      const d = spawnSync("git", ["diff", "--no-index", "--", "/dev/null", file], opts)
      if (d.stdout) out += d.stdout
    }
    return out
  }

  const result = spawnSync("git", ["diff", from, to], opts)
  if (result.error) throw result.error
  return result.stdout
}

function getRefs(repoDir: string) {
  const result = spawnSync(
    "git",
    ["for-each-ref", "refs/heads", "--format=%(refname:short)|%(objectname:short)|%(contents:subject)|%(committerdate:relative)", "--sort=-committerdate"],
    { cwd: repoDir, encoding: "utf-8" }
  )
  const lines = (result.stdout || "").trim().split("\n").filter(Boolean)
  return lines.map((line) => {
    const [name, sha, ...rest] = line.split("|")
    // Last segment is the date, everything before is the subject
    const date = rest[rest.length - 1] ?? ""
    const subject = rest.slice(0, -1).join("|")
    return { name, sha, subject, date }
  })
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

  // --- Determine diff text ---
  let diffText: string
  let currentFrom: string | null = null
  let currentTo: string | null = null

  // Auto-detect PR from current branch only when no diff source is specified.
  // --working (and an explicit base/from/to) opt out of PR detection.
  let prInfo = null
  if (!args.stdin && !args.patch && !args.from && !args.to && !args.base && !args.working) {
    prInfo = await fetchPRInfo(repoDir, args.pr)
    if (prInfo) {
      console.log(`clodiff: PR #${prInfo.number} detected — ${prInfo.title}`)
      // Fetch the branch from origin so we can diff against it
      spawnSync("git", ["fetch", "origin", prInfo.headRefName], { cwd: repoDir })
      currentFrom = prInfo.baseRefName
      currentTo = `origin/${prInfo.headRefName}`
    }
  }

  if (args.working) {
    // Uncommitted changes vs a ref (default HEAD, or --base <ref>)
    currentFrom = args.base || "HEAD"
    currentTo = WORKING_TREE
    diffText = runGitDiff(repoDir, currentFrom, WORKING_TREE)
  } else if (args.stdin) {
    diffText = await readStdin()
  } else if (args.patch) {
    diffText = await readFile(args.patch, "utf-8")
  } else if (args.from && args.to) {
    currentFrom = args.from
    currentTo = args.to
    diffText = runGitDiff(repoDir, args.from, args.to)
  } else if (currentFrom && currentTo) {
    // Set by PR auto-detect above
    diffText = runGitDiff(repoDir, currentFrom, currentTo)
  } else if (args.base) {
    // Working tree vs a base branch (includes uncommitted changes)
    currentFrom = args.base
    currentTo = WORKING_TREE
    diffText = runGitDiff(repoDir, args.base, WORKING_TREE)
  } else {
    // Default: uncommitted changes vs the last commit (the common case)
    currentFrom = "HEAD"
    currentTo = WORKING_TREE
    diffText = runGitDiff(repoDir, "HEAD", WORKING_TREE)
  }

  // Mutable diff state — updated on /rediff
  const diffState = { parsed: parseDiff(diffText), from: currentFrom, to: currentTo }

  // --- Load or create session ---
  const existingSession = await loadSession(repoDir)
  // Use the target ref's commit as the review's commit_id so GitHub PR reviews
  // reference the right commit. In working-tree mode `to` is a sentinel, so
  // anchor to the `from` ref (e.g. HEAD) instead.
  const commitRef = currentTo === WORKING_TREE ? currentFrom : currentTo
  const headCommit = commitRef
    ? resolveRef(repoDir, commitRef)
    : getHeadCommit(repoDir)

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
    }
    const prNumber = prInfo?.number ?? args.pr
    const prMeta = prInfo ? {
      number: prInfo.number,
      title: prInfo.title,
      author: prInfo.author,
      body: prInfo.body,
      state: prInfo.state?.toUpperCase() as "OPEN" | "CLOSED" | "MERGED" | undefined,
      is_draft: prInfo.is_draft,
      viewer_login: prInfo.viewer_login,
      viewer_is_author: !!prInfo.viewer_login && prInfo.viewer_login === prInfo.author,
      checks_status: prInfo.checks_status,
    } : undefined

    session = {
      version: 1,
      repo: repoDir,
      base_branch: args.base || prInfo?.baseRefName || "",
      head_commit: headCommit,
      current_commit: headCommit,
      ...(prNumber !== undefined ? { pr_number: prNumber } : {}),
      ...(prMeta ? { pr_meta: prMeta } : {}),
      reviews: [review],
      created_at: now,
      updated_at: now,
    }

    // Import existing GitHub PR review threads + the top-level conversation
    if (prNumber && headCommit) {
      const [existingThreads, conversation] = await Promise.all([
        fetchPRThreads(repoDir, prNumber, headCommit),
        fetchPRConversation(repoDir, prNumber),
      ])
      if (existingThreads.length > 0) {
        console.log(`clodiff: importing ${existingThreads.length} existing review thread(s)`)
        review.comments.push(...existingThreads)
      }
      if (conversation.length > 0) {
        console.log(`clodiff: importing ${conversation.length} conversation comment(s)`)
        session.pr_conversation = conversation
      }
    }
  }

  // Re-anchor comments if HEAD changed since last save
  if (session.current_commit && session.current_commit !== headCommit && diffState.parsed.length > 0) {
    const allComments = session.reviews.flatMap(r => r.comments)
    const reanchored = reanchorComments(allComments, diffState.parsed)
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
    viewerDir: join(import.meta.dirname, "..", "viewer"),
    getInitPayload: async () => {
      const freshSession = (await loadSession(repoDir)) ?? session
      return {
        type: "init",
        diff: diffState.parsed,
        comments: freshSession.reviews.flatMap((r) => r.comments),
        session: { ...freshSession, _from: diffState.from, _to: diffState.to },
      }
    },
    getRefs: async () => getRefs(repoDir),
    onRediff: async (from: string, to: string) => {
      const text = runGitDiff(repoDir, from, to)
      diffState.parsed = parseDiff(text)
      diffState.from = from
      diffState.to = to
      const freshSession = (await loadSession(repoDir)) ?? session
      return {
        type: "init",
        diff: diffState.parsed,
        comments: freshSession.reviews.flatMap((r) => r.comments),
        session: { ...freshSession, _from: from, _to: to },
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error)
}

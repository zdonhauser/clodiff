#!/usr/bin/env node
import { readFile } from "fs/promises"
import { realpathSync, openSync, mkdirSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { spawn, spawnSync } from "child_process"
import { fileURLToPath } from "url"
import { parseDiff } from "./diff-parser.ts"
import { loadSession, saveSession, reviewDir } from "./session.ts"
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

// Refs available in the ref picker: recent commits (working tree backwards) +
// local branches + remote branches, each tagged with a `kind` for grouping.
// Uses \x1f (unit separator) so commit messages containing "|" don't break parsing.
function getRefs(repoDir: string) {
  const run = (args: string[]) =>
    (spawnSync("git", args, { cwd: repoDir, encoding: "utf-8" }).stdout || "")
  const SEP = "\x1f"

  const commits = run(["log", "-n", "30", `--format=%h${SEP}%s${SEP}%cr`])
    .trim().split("\n").filter(Boolean).map((line) => {
      const [name, subject, date] = line.split(SEP)
      return { name, sha: "", subject, date, kind: "commit" as const }
    })

  const branchFmt = `%(refname:short)${SEP}%(objectname:short)${SEP}%(contents:subject)${SEP}%(committerdate:relative)`
  const parseBranches = (out: string, kind: "local" | "remote") =>
    out.trim().split("\n").filter(Boolean).map((line) => {
      const [name, sha, subject, date] = line.split(SEP)
      return { name, sha, subject, date, kind }
    })

  const local = parseBranches(
    run(["for-each-ref", "refs/heads", `--format=${branchFmt}`, "--sort=-committerdate"]), "local")
  const remote = parseBranches(
    run(["for-each-ref", "refs/remotes", `--format=${branchFmt}`, "--sort=-committerdate"]), "remote")
    .filter((r) => !r.name.endsWith("/HEAD")) // skip the origin/HEAD symref

  return [...commits, ...local, ...remote]
}

// Best-effort default branch (origin/HEAD → main/master fallback).
function detectDefaultBranch(repoDir: string): string {
  const sym = (spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: repoDir, encoding: "utf-8" }).stdout || "").trim()
  if (sym) return sym.replace(/^refs\/remotes\/origin\//, "")
  for (const b of ["main", "master", "trunk"]) {
    if (spawnSync("git", ["rev-parse", "--verify", "--quiet", b], { cwd: repoDir, encoding: "utf-8" }).status === 0) return b
  }
  return "main"
}

function openBrowser(url: string): void {
  if (process.env.BROWSER === "none") return
  const platform = process.platform
  if (platform === "darwin") {
    spawnSync("open", [url])
  } else if (platform === "win32") {
    spawnSync("cmd", ["/c", "start", url])
  } else {
    spawnSync("xdg-open", [url])
  }
}

async function readVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf-8"))
    return pkg.version || "unknown"
  } catch {
    return "unknown"
  }
}

const HELP = `clodiff — a live code-diff viewer for reviews

Usage: clodiff [options]

Diff source (default: working tree vs the base branch):
  --base <ref>          Diff the working tree against <ref> (e.g. main)
  --from <ref> --to <ref>   Diff an explicit range (both required together)
  --working, --uncommitted  Working tree vs last commit
  --pr <number>         Review an open pull request by number
  --patch <text>        Render a unified diff passed as a string
  --stdin               Read a unified diff from stdin

Other:
  --port <number>       Port to serve on (default 7777)
  --resume              Reuse the existing session for this repo
  --stop                Stop the clodiff server running for this repo
  --status              Show whether a server is running for this repo (port/pid)
  -h, --help            Show this help
  -v, --version         Print the version

clodiff runs as a background daemon detached from the shell that launched it,
so the viewer survives when that terminal or Claude session ends. Stop it with
'clodiff --stop' (the review state is kept so you can resume later).`

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

  const defaultBranch = detectDefaultBranch(repoDir)

  // Build the init payload from the on-disk session + current diff state.
  const buildInit = async () => {
    const fresh = (await loadSession(repoDir)) ?? session
    return {
      type: "init",
      diff: diffState.parsed,
      comments: fresh.reviews.flatMap((r) => r.comments),
      session: { ...fresh, _from: diffState.from, _to: diffState.to, _default_branch: defaultBranch },
    }
  }

  // Recompute the diff for ref-based modes so the viewer always reflects the
  // latest working tree (hot reload). stdin/patch diffs are static (from/to null).
  const refreshDiff = () => {
    if (diffState.from !== null && diffState.to !== null) {
      try { diffState.parsed = parseDiff(runGitDiff(repoDir, diffState.from, diffState.to)) } catch { /* keep last good diff */ }
    }
  }

  const setRange = async (from: string, to: string, clearPR: boolean) => {
    diffState.from = from
    diffState.to = to
    diffState.parsed = parseDiff(runGitDiff(repoDir, from, to))
    if (clearPR) {
      const s = (await loadSession(repoDir)) ?? session
      delete s.pr_meta; delete s.pr_number; delete s.pr_conversation
      delete s.pending_resolves; delete s.pending_replies
      session = s
      await saveSession(repoDir, s)
    }
    return buildInit()
  }

  // Switch diff mode from the UI (Settings). "pr" imports the PR's review data.
  const onSetMode = async (mode: string) => {
    if (mode === "working") return setRange("HEAD", WORKING_TREE, true)
    if (mode === "base") return setRange(defaultBranch, WORKING_TREE, true)
    if (mode === "base-remote") return setRange(`origin/${defaultBranch}`, WORKING_TREE, true)
    if (mode === "last-commit") return setRange("HEAD~1", "HEAD", true)
    if (mode === "pr") {
      const info = await fetchPRInfo(repoDir)
      if (!info) throw new Error("No open PR found for the current branch")
      spawnSync("git", ["fetch", "origin", info.headRefName], { cwd: repoDir })
      diffState.from = info.baseRefName
      diffState.to = `origin/${info.headRefName}`
      diffState.parsed = parseDiff(runGitDiff(repoDir, diffState.from, diffState.to))
      const headCommit = resolveRef(repoDir, diffState.to)
      const s = (await loadSession(repoDir)) ?? session
      s.pr_number = info.number
      s.pr_meta = {
        number: info.number, title: info.title, author: info.author, body: info.body,
        state: info.state?.toUpperCase() as "OPEN" | "CLOSED" | "MERGED" | undefined,
        is_draft: info.is_draft, viewer_login: info.viewer_login,
        viewer_is_author: !!info.viewer_login && info.viewer_login === info.author,
        checks_status: info.checks_status,
      }
      s.head_commit = headCommit
      s.current_commit = headCommit
      const [threads, conv] = await Promise.all([
        fetchPRThreads(repoDir, info.number, headCommit),
        fetchPRConversation(repoDir, info.number),
      ])
      const review = s.reviews[s.reviews.length - 1]
      const existing = new Set(review.comments.filter((c) => c.github_id !== undefined).map((c) => c.github_id))
      review.comments.push(...threads.filter((t) => !existing.has(t.github_id)))
      s.pr_conversation = conv
      session = s
      await saveSession(repoDir, s)
      return buildInit()
    }
    throw new Error(`Unknown mode: ${mode}`)
  }

  // Start the server
  const { port, server, getStats } = await startServer({
    port: args.port,
    repoDir,
    viewerDir: join(import.meta.dirname, "..", "viewer"),
    getInitPayload: async () => { refreshDiff(); return buildInit() },
    getRefs: async () => getRefs(repoDir),
    onRediff: async (from: string, to: string) => {
      diffState.from = from
      diffState.to = to
      diffState.parsed = parseDiff(runGitDiff(repoDir, from, to))
      return buildInit()
    },
    onSetMode,
  })

  // Record the actual port (may differ if the requested one was taken) and our
  // PID so `clodiff --stop` can find and signal this daemon.
  session.port = port
  session.pid = process.pid

  await saveSession(repoDir, session)

  // Shut down cleanly on SIGTERM/SIGINT (e.g. from `clodiff --stop`). We keep
  // session.json so the review can be resumed; the stale port/pid is harmless
  // because the reuse-guard liveness-probes before trusting it.
  const shutdown = () => {
    try { server.close() } catch { /* already closing */ }
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  // Idle/orphan watchdog — a detached daemon would otherwise run forever. Shut
  // down when (a) the repo/worktree it serves is gone (e.g. `git worktree remove`
  // orphaned it), or (b) it's been idle past the timeout: no viewer connected AND
  // no API activity. Default 3h; set CLODIFF_IDLE_HOURS=0 to disable. session.json
  // is kept, so a later `clodiff` relaunch resumes the review where it left off.
  const idleHours = Number(process.env.CLODIFF_IDLE_HOURS ?? 3)
  const idleMs = idleHours > 0 ? idleHours * 3_600_000 : 0
  // Check every 60s normally; scale down for short timeouts so tests don't wait.
  // CLODIFF_CHECK_SECONDS overrides the cadence (used by tests; also lets the
  // orphan check run faster even when the idle timeout is disabled).
  const checkMs = process.env.CLODIFF_CHECK_SECONDS
    ? Math.max(250, Number(process.env.CLODIFF_CHECK_SECONDS) * 1000)
    : idleMs > 0 ? Math.min(60_000, Math.max(1_000, Math.floor(idleMs / 3))) : 60_000
  const watchdog = setInterval(() => {
    if (!existsSync(repoDir)) {
      console.log(`clodiff: ${repoDir} no longer exists — shutting down`)
      shutdown()
    }
    if (idleMs > 0) {
      const { clients, lastActivity } = getStats()
      if (clients === 0 && Date.now() - lastActivity > idleMs) {
        console.log(`clodiff: idle ${idleHours}h with no viewer — shutting down (run 'clodiff' to resume)`)
        shutdown()
      }
    }
  }, checkMs)
  watchdog.unref()

  const url = `http://localhost:${port}`
  openBrowser(url)
  console.log(`clodiff: listening at ${url} — serving ${repoDir} (pid ${process.pid})`)
}

// Re-launch clodiff as a detached background daemon, then return so the caller
// (the shell / Claude tool) exits immediately. The daemon runs in its own
// session — `spawn({ detached: true })` calls setsid() — so it is NOT in the
// launcher's process group and survives when that terminal or Claude session is
// torn down. This is the fix for "dead localhost servers": previously the server
// was a non-detached child and got group-killed when its session ended.
async function daemonize(rawArgs: string[], repoDir: string): Promise<void> {
  // Reuse an already-running server for THIS repo (verify the repo matches, so a
  // recycled port now owned by a different repo's clodiff isn't mistaken for ours).
  const prior = await loadSession(repoDir)
  if (prior?.port) {
    const live = await fetch(`http://localhost:${prior.port}/session`, { signal: AbortSignal.timeout(600) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    if (live && live.repo === repoDir) {
      const url = `http://localhost:${prior.port}`
      console.log(`clodiff: already running at ${url} — reusing it (it hot-reloads on changes)`)
      openBrowser(url)
      return
    }
  }

  // stdin can't cross the fork, so materialize a piped diff to a temp patch file
  // and hand the daemon a --patch instead.
  let args = rawArgs
  if (rawArgs.includes("--stdin")) {
    const diff = await readStdin()
    const tmp = join(tmpdir(), `clodiff-stdin-${process.pid}-${Date.now()}.patch`)
    writeFileSync(tmp, diff)
    args = rawArgs.filter((a) => a !== "--stdin").concat(["--patch", tmp])
  }

  const dir = reviewDir(repoDir)
  mkdirSync(dir, { recursive: true })
  const logFile = join(dir, "clodiff.log")
  const out = openSync(logFile, "a")
  const script = fileURLToPath(import.meta.url)
  const child = spawn(process.execPath, [script, ...args], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, CLODIFF_DAEMON: "1" },
  })
  child.unref()
  console.log(`clodiff: starting in the background for ${repoDir} — the viewer will open shortly (logs: ${logFile})`)
}

// Stop the clodiff daemon serving this repo. Verifies the server on the recorded
// port actually belongs to this repo before killing its PID, so we never signal a
// recycled PID or another repo's server. session.json is left in place so the
// review can be resumed later.
async function stopServer(repoDir: string): Promise<void> {
  const s = await loadSession(repoDir)
  if (!s?.port) {
    console.log("clodiff: no running session recorded for this repo")
    return
  }
  const live = await fetch(`http://localhost:${s.port}/session`, { signal: AbortSignal.timeout(600) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (!live) {
    console.log(`clodiff: no live server on port ${s.port} (already stopped)`)
    return
  }
  if (live.repo !== repoDir) {
    console.log(`clodiff: port ${s.port} is serving a different repo now — not touching it`)
    return
  }
  const pid = live.pid ?? s.pid
  if (!pid) {
    console.log("clodiff: running but no PID recorded — stop it manually")
    return
  }
  try {
    process.kill(pid, "SIGTERM")
    console.log(`clodiff: stopped (pid ${pid}, was on port ${s.port})`)
  } catch (err) {
    console.log(`clodiff: could not signal pid ${pid}: ${err instanceof Error ? err.message : err}`)
  }
}

// Report whether a live clodiff is serving THIS repo, with its port/pid. Verifies
// the port actually answers for this repo so it never reports a recycled port
// (now owned by a different repo) as ours.
async function statusServer(repoDir: string): Promise<void> {
  const s = await loadSession(repoDir)
  if (!s?.port) {
    console.log(`clodiff: not running for ${repoDir}`)
    return
  }
  const live = await fetch(`http://localhost:${s.port}/session`, { signal: AbortSignal.timeout(600) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (live && live.repo === repoDir) {
    console.log(`clodiff: running — http://localhost:${s.port} (pid ${live.pid ?? s.pid}) serving ${repoDir}`)
  } else if (live) {
    console.log(`clodiff: not running for ${repoDir} — port ${s.port} is now serving a different repo (${live.repo})`)
  } else {
    console.log(`clodiff: not running for ${repoDir} (stale session recorded on port ${s.port})`)
  }
}

// CLI entry: handle the one-shot flags, then either run the server (when we're
// the daemon child, or when daemonizing is disabled) or spawn the daemon.
export async function runCli(): Promise<void> {
  const rawArgs = process.argv.slice(2)
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) { console.log(HELP); return }
  if (rawArgs.includes("--version") || rawArgs.includes("-v")) { console.log(await readVersion()); return }
  if (rawArgs.includes("--stop")) { await stopServer(process.cwd()); return }
  if (rawArgs.includes("--status")) { await statusServer(process.cwd()); return }

  // CLODIFF_DAEMON: we ARE the detached child — run the server in the foreground
  // of our own session. CLODIFF_NO_DAEMON: opt out of daemonizing (tests run the
  // server in-process so they can kill it directly).
  if (process.env.CLODIFF_DAEMON === "1" || process.env.CLODIFF_NO_DAEMON === "1") {
    await main()
    return
  }
  await daemonize(rawArgs, process.cwd())
}

// Run when this file is the entry point. Compare *realpaths*: when clodiff is
// launched through its npm bin symlink, process.argv[1] is the symlink path
// while import.meta.url already resolves to the realpath — a raw string compare
// would never match and the CLI would silently never run.
function isMainEntry(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  const here = fileURLToPath(import.meta.url)
  if (entry === here) return true
  try {
    return realpathSync(entry) === here
  } catch {
    return false
  }
}

if (isMainEntry()) {
  runCli().catch(console.error)
}

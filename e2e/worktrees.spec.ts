import { test, expect } from "@playwright/test"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"

// Multi-worktree isolation: clodiff keys its session + port off
// `git rev-parse --absolute-git-dir`, which is per-worktree. So N worktrees of
// one repo must yield N fully independent daemons — distinct ports, each serving
// its own diff — and stopping one must not touch the others. This is the
// "I run 5-10 at once" scenario. We launch the REAL detached daemon (built
// dist/cli.js, which runs on any Node) in each worktree.

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = join(__dirname, "..")
const DIST = join(ROOT, "dist", "cli.js")

const N = 4 // one main checkout + 3 linked worktrees
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

type WT = { path: string; gitDir: string; sessionPath: string; port: number; pid: number }

function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout.trim()
}

function clodiff(cwd: string, args: string[]) {
  return spawnSync("node", [DIST, ...args], { cwd, encoding: "utf-8", env: { ...process.env, BROWSER: "none" } })
}

let base = ""
const worktrees: WT[] = []

test.beforeAll(async () => {
  // Ensure the published bundle exists (CI builds it earlier; build if running standalone).
  if (!existsSync(DIST)) {
    const b = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf-8" })
    if (b.status !== 0) throw new Error(`build failed: ${b.stderr}`)
  }

  base = mkdtempSync(join(tmpdir(), "clodiff-wt-"))
  git(base, ["init", "-q"])
  git(base, ["config", "user.email", "t@clodiff.dev"])
  git(base, ["config", "user.name", "clodiff-test"])
  writeFileSync(join(base, "marker.txt"), "base\n")
  git(base, ["add", "-A"])
  git(base, ["commit", "-qm", "init"])

  // Worktree 0 is the main checkout; 1..N-1 are linked worktrees.
  const paths = [base]
  for (let i = 1; i < N; i++) {
    const p = join(base, `..`, `${base.split("/").pop()}-wt${i}`)
    git(base, ["worktree", "add", "-q", p, "-b", `wt${i}`])
    paths.push(p)
  }

  // Give each worktree a DISTINCT uncommitted change, then launch a daemon in it.
  // All start from the same --port so we also exercise cross-worktree port
  // auto-increment (they must end up on different ports).
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]
    writeFileSync(join(p, "marker.txt"), `base\nchange-${i}\n`)
    const gitDir = git(p, ["rev-parse", "--absolute-git-dir"])
    const sessionPath = join(gitDir, "clodiff", "session.json")

    const r = clodiff(p, ["--working", "--port", "7900"])
    if (r.status !== 0) throw new Error(`launch in wt${i} failed: ${r.stderr || r.stdout}`)

    let port = 0, pid = 0
    for (let t = 0; t < 60; t++) {
      await wait(250)
      if (existsSync(sessionPath)) {
        try {
          const s = JSON.parse(readFileSync(sessionPath, "utf-8"))
          if (s.port) { port = s.port; pid = s.pid; break }
        } catch { /* mid-write */ }
      }
    }
    if (!port) throw new Error(`wt${i} daemon never came up`)
    // The daemon records session.repo as its resolved cwd (realpath), so store the
    // realpath here too for an apples-to-apples comparison (macOS /tmp symlinks).
    worktrees.push({ path: realpathSync(p), gitDir, sessionPath, port, pid })
  }
})

test.afterAll(() => {
  for (const wt of worktrees) {
    clodiff(wt.path, ["--stop"])
    try { if (wt.pid) process.kill(wt.pid, "SIGKILL") } catch { /* already gone */ }
  }
  if (base) {
    try { git(base, ["worktree", "prune"]) } catch { /* best effort */ }
    rmSync(base, { recursive: true, force: true })
    for (let i = 1; i < N; i++) rmSync(`${base}-wt${i}`, { recursive: true, force: true })
  }
})

test("each worktree gets an independent daemon serving its own diff", async () => {
  expect(worktrees).toHaveLength(N)

  // Distinct git dirs, ports, and pids — no two worktrees share anything.
  expect(new Set(worktrees.map((w) => w.gitDir)).size).toBe(N)
  expect(new Set(worktrees.map((w) => w.port)).size).toBe(N)
  expect(new Set(worktrees.map((w) => w.pid)).size).toBe(N)

  // Each server reports its OWN repo path and serves its OWN change.
  for (let i = 0; i < N; i++) {
    const wt = worktrees[i]
    const session = await fetch(`http://localhost:${wt.port}/session`).then((r) => r.json())
    expect(session.repo).toBe(wt.path)

    const init = await fetch(`http://localhost:${wt.port}/init`).then((r) => r.json())
    const added = init.diff
      .flatMap((f: any) => f.hunks.flatMap((h: any) => h.lines))
      .filter((l: any) => l.type === "added")
      .map((l: any) => l.content)
    // It serves this worktree's marker and no other worktree's.
    expect(added).toContain(`change-${i}`)
    for (let j = 0; j < N; j++) if (j !== i) expect(added).not.toContain(`change-${j}`)
  }
})

test("the viewer renders the correct worktree's diff in a browser", async ({ page }) => {
  const wt = worktrees[1] // a linked worktree
  await page.goto(`http://localhost:${wt.port}`)
  await page.waitForSelector("[data-file-path='marker.txt']", { timeout: 15000 })
  // Default-expanded, so the line is already on screen.
  await expect(page.locator('[data-path="marker.txt"]').first()).toBeVisible({ timeout: 5000 })
  const body = await page.locator("body").innerText()
  expect(body).toContain("change-1")
  expect(body).not.toContain("change-0")
  expect(body).not.toContain("change-2")
})

test("--stop on one worktree leaves the others running", async () => {
  const victim = worktrees[0]
  const survivors = worktrees.slice(1)

  const r = clodiff(victim.path, ["--stop"])
  expect(r.stdout).toMatch(/stopped/)

  // Victim is down...
  let victimAlive = true
  for (let t = 0; t < 20; t++) {
    await wait(250)
    victimAlive = await fetch(`http://localhost:${victim.port}/session`, { signal: AbortSignal.timeout(400) })
      .then((r) => r.ok).catch(() => false)
    if (!victimAlive) break
  }
  expect(victimAlive).toBe(false)

  // ...and every other worktree is untouched, still serving its own repo.
  for (const wt of survivors) {
    const session = await fetch(`http://localhost:${wt.port}/session`).then((r) => r.json())
    expect(session.repo).toBe(wt.path)
  }
})

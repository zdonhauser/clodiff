import { test, expect } from "@playwright/test"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"

// A detached daemon must not live forever. It self-terminates when (a) it's been
// idle past the timeout with no viewer connected, or (b) the repo/worktree it
// serves is removed. Activity (even with no viewer — e.g. Claude posting
// annotations) must keep it alive. session.json is kept so a relaunch resumes.

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const DIST = join(__dirname, "..", "dist", "cli.js")
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const alive = (port: number) =>
  fetch(`http://localhost:${port}/session`, { signal: AbortSignal.timeout(500) }).then((r) => r.ok).catch(() => false)

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "clodiff-idle-"))
  const git = (a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf-8" })
  git(["init", "-q"]); git(["config", "user.email", "t@t.dev"]); git(["config", "user.name", "t"])
  writeFileSync(join(dir, "f.txt"), "a\n"); git(["add", "-A"]); git(["commit", "-qm", "i"])
  writeFileSync(join(dir, "f.txt"), "a\nb\n") // an uncommitted change to diff
  return dir
}

function launch(dir: string, port: number, env: Record<string, string>) {
  const r = spawnSync("node", [DIST, "--working", "--port", String(port)], {
    cwd: dir, encoding: "utf-8", env: { ...process.env, BROWSER: "none", ...env },
  })
  if (r.status !== 0) throw new Error(`launch failed: ${r.stderr || r.stdout}`)
}

async function waitForSession(dir: string): Promise<{ port: number; pid: number }> {
  const sp = join(dir, ".git", "clodiff", "session.json")
  for (let i = 0; i < 60; i++) {
    await wait(200)
    if (existsSync(sp)) { try { const s = JSON.parse(readFileSync(sp, "utf-8")); if (s.port) return { port: s.port, pid: s.pid } } catch { /* mid-write */ } }
  }
  throw new Error("daemon never wrote a session")
}

// Liveness via PID — crucially does NOT hit the server, so checking it can't
// itself count as activity and keep an idle daemon alive.
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

test("a viewerless daemon self-terminates after the idle timeout", async () => {
  const dir = makeRepo()
  try {
    launch(dir, 7911, { CLODIFF_IDLE_HOURS: "0.0008" }) // ~2.9s idle, ~1s checks
    const { pid } = await waitForSession(dir)
    expect(pidAlive(pid)).toBe(true)

    // Poll by PID, not the HTTP port — probing /session would count as activity
    // and reset the idle timer.
    let down = false
    for (let i = 0; i < 30; i++) { await wait(400); if (!pidAlive(pid)) { down = true; break } }
    expect(down).toBe(true)
    // State is kept so a relaunch resumes the review.
    expect(existsSync(join(dir, ".git", "clodiff", "session.json"))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("API activity keeps a viewerless daemon alive", async () => {
  const dir = makeRepo()
  let port = 0
  try {
    launch(dir, 7912, { CLODIFF_IDLE_HOURS: "0.0008" })
    ;({ port } = await waitForSession(dir))
    // Hammer the API for longer than the idle window; each hit bumps lastActivity.
    for (let i = 0; i < 6; i++) { await fetch(`http://localhost:${port}/session`).catch(() => {}); await wait(700) }
    expect(await alive(port)).toBe(true)
  } finally {
    spawnSync("node", [DIST, "--stop"], { cwd: dir, encoding: "utf-8", env: { ...process.env, BROWSER: "none" } })
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a daemon shuts down when its repo/worktree is removed", async () => {
  const dir = makeRepo()
  // Disable the idle timeout so the *orphan* path is unambiguously what fires;
  // check once a second so the test doesn't wait on the 60s default.
  launch(dir, 7913, { CLODIFF_IDLE_HOURS: "0", CLODIFF_CHECK_SECONDS: "1" })
  const { port } = await waitForSession(dir)
  expect(await alive(port)).toBe(true)

  rmSync(dir, { recursive: true, force: true }) // remove the repo out from under it

  let down = false
  for (let i = 0; i < 20; i++) { await wait(500); if (!(await alive(port))) { down = true; break } }
  expect(down).toBe(true)
})

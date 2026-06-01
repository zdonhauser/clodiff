import { test as base, expect } from "@playwright/test"
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { spawnSync, spawn } from "child_process"
import { fileURLToPath } from "url"
import type { ChildProcess } from "child_process"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const CLI_PATH = join(__dirname, "..", "..", "src", "cli.ts")
// Launch the CLI through tsx so it runs on any Node version (Node 22.18+ runs
// the .ts natively, but tsx keeps the test green on older local Node too).
const TSX_BIN = join(__dirname, "..", "..", "node_modules", ".bin", "tsx")

const E2E_PORT = 17900

export type ServerContext = {
  baseURL: string
  port: number
  repoDir: string
  sessionPath: string
  repliesPath: string
}

async function waitFor(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, 150))
  }
}

function createTestRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), "clodiff-e2e-"))

  const git = (args: string[]) =>
    spawnSync("git", args, { cwd: repoDir, encoding: "utf-8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })

  git(["init"])
  git(["config", "user.email", "test@clodiff.dev"])
  git(["config", "user.name", "clodiff-test"])

  // Commit 1 — base
  writeFileSync(join(repoDir, "app.ts"), 'export function greet(name: string) { return `Hello, ${name}!` }\n')
  writeFileSync(join(repoDir, "utils.ts"), "export const VERSION = '1.0.0'\n")
  git(["add", "."])
  git(["commit", "-m", "init: add greeting functions"])

  // Commit 2 — changes to diff
  writeFileSync(
    join(repoDir, "app.ts"),
    'export function greet(name: string) { return `Hello, ${name}!` }\nexport function farewell(name: string) { return `Goodbye, ${name}!` }\n',
  )
  writeFileSync(join(repoDir, "utils.ts"), "export const VERSION = '1.1.0'\nexport const AUTHOR = 'clodiff'\n")
  git(["add", "."])
  git(["commit", "-m", "feat: add farewell function and bump version"])

  return repoDir
}

export const test = base.extend<{ server: ServerContext }>({
  server: [
    async ({}, use) => {
      const repoDir = createTestRepo()
      // clodiff stores state under the git dir now (see session.ts reviewDir).
      const reviewDir = join(repoDir, ".git", "clodiff")
      const sessionPath = join(reviewDir, "session.json")
      const repliesPath = join(reviewDir, "replies.json")

      let proc: ChildProcess | null = null

      try {
        proc = spawn(TSX_BIN, [CLI_PATH, "--from", "HEAD~1", "--to", "HEAD", "--port", String(E2E_PORT)], {
          cwd: repoDir,
          env: { ...process.env, CI: "1" },
          stdio: "pipe",
        })

        // Wait for session.json to be written with a port
        await waitFor(() => {
          if (!existsSync(sessionPath)) return false
          try {
            const s = JSON.parse(readFileSync(sessionPath, "utf-8"))
            return typeof s.port === "number"
          } catch {
            return false
          }
        })

        const session = JSON.parse(readFileSync(sessionPath, "utf-8"))
        const port: number = session.port

        await use({ baseURL: `http://localhost:${port}`, port, repoDir, sessionPath, repliesPath })
      } finally {
        proc?.kill()
        await new Promise((r) => setTimeout(r, 200))
        rmSync(repoDir, { recursive: true, force: true })
      }
    },
    { scope: "test" },
  ],
})

export { expect }

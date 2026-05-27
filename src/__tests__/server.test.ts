import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { startServer } from "../server"

let serverResult: Awaited<ReturnType<typeof startServer>>
let tmpDir: string
let viewerDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "clodiff-server-test-"))
  viewerDir = join(tmpDir, "viewer")
  await mkdir(viewerDir, { recursive: true })

  // Create minimal viewer files
  await writeFile(join(viewerDir, "index.html"), "<!DOCTYPE html><html><body>clodiff</body></html>")
  await writeFile(join(viewerDir, "app.js"), "// app placeholder")

  serverResult = await startServer({
    port: 17777,
    repoDir: tmpDir,
    viewerDir,
  })
})

afterAll(async () => {
  serverResult.server.stop(true)
  await rm(tmpDir, { recursive: true, force: true })
})

describe("server", () => {
  describe("HTTP", () => {
    it("GET / returns 200", async () => {
      const res = await fetch(`http://localhost:${serverResult.port}/`)
      expect(res.status).toBe(200)
    })

    it("GET / returns HTML content", async () => {
      const res = await fetch(`http://localhost:${serverResult.port}/`)
      const text = await res.text()
      expect(text).toContain("clodiff")
    })

    it("GET /viewer/app.js returns 200", async () => {
      const res = await fetch(`http://localhost:${serverResult.port}/viewer/app.js`)
      expect(res.status).toBe(200)
    })

    it("GET /nonexistent returns 404", async () => {
      const res = await fetch(`http://localhost:${serverResult.port}/nonexistent`)
      expect(res.status).toBe(404)
    })

    it("POST /_ws_broadcast with valid JSON returns 200", async () => {
      const res = await fetch(`http://localhost:${serverResult.port}/_ws_broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test" }),
      })
      expect(res.status).toBe(200)
    })

    it("POST /_ws_broadcast with invalid JSON returns 400", async () => {
      const res = await fetch(`http://localhost:${serverResult.port}/_ws_broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {{{",
      })
      expect(res.status).toBe(400)
    })

    it("POST /review/event with valid event updates session", async () => {
      // Create a session.json so the endpoint can operate
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      const session = {
        version: 1,
        repo: tmpDir,
        base_branch: "main",
        head_commit: "abc123",
        current_commit: "abc123",
        reviews: [{ id: "r1", commit_id: "abc123", event: "COMMENT", comments: [], created_at: "2025-01-01T00:00:00Z", source: "claude-code" }],
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      }
      await writeFile(join(reviewDir, "session.json"), JSON.stringify(session))

      const res = await fetch(`http://localhost:${serverResult.port}/review/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "APPROVE" }),
      })
      expect(res.status).toBe(200)
    })

    it("POST /review/event with invalid event returns 400", async () => {
      const res = await fetch(`http://localhost:${serverResult.port}/review/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "NOT_A_VALID_EVENT" }),
      })
      expect(res.status).toBe(400)
      expect(await res.text()).toMatch(/Invalid event/)
    })
  })

  describe("port handling", () => {
    it("starts on the specified port", async () => {
      expect(serverResult.port).toBe(17777)
    })

    it("auto-increments port when specified port is taken", async () => {
      // Start a second server on the same port — it should get the next port
      const tmpDir2 = await mkdtemp(join(tmpdir(), "clodiff-server-test2-"))
      const viewerDir2 = join(tmpDir2, "viewer")
      await mkdir(viewerDir2, { recursive: true })
      await writeFile(join(viewerDir2, "index.html"), "<!DOCTYPE html><html><body>test2</body></html>")

      const result2 = await startServer({
        port: 17777, // same port as the first server
        repoDir: tmpDir2,
        viewerDir: viewerDir2,
      })

      try {
        expect(result2.port).toBeGreaterThan(17777)
      } finally {
        result2.server.stop(true)
        await rm(tmpDir2, { recursive: true, force: true })
      }
    })
  })
})

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
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      const session = {
        version: 1, repo: tmpDir, base_branch: "main",
        head_commit: "abc123", current_commit: "abc123",
        reviews: [{ id: "r1", commit_id: "abc123", event: "COMMENT", comments: [], created_at: "2025-01-01T00:00:00Z" }],
        created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
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

  // ── POST /reply (enhanced: persists to session.json) ─────────────────────

  describe("POST /reply", () => {
    async function writeSessionWithComment(commentId = "cmt-1") {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      const session = {
        version: 1, repo: tmpDir, base_branch: "main",
        head_commit: "abc", current_commit: "abc",
        reviews: [{
          id: "r1", commit_id: "abc", event: "COMMENT",
          comments: [{
            id: commentId, created_at: "2026-01-01T00:00:00Z",
            source: "claude-code", body: "original", severity: "note",
            path: "src/foo.ts", commit_id: "abc", line: 5, side: "RIGHT",
          }],
          created_at: "2026-01-01T00:00:00Z",
        }],
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      }
      await writeFile(join(reviewDir, "session.json"), JSON.stringify(session))
      return join(reviewDir, "session.json")
    }

    it("user reply persists in session.json comment.replies", async () => {
      const sessionPath = await writeSessionWithComment("cmt-reply-1")
      const res = await fetch(`http://localhost:${serverResult.port}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "cmt-reply-1", body: "great point" }),
      })
      expect(res.status).toBe(200)
      const updated = JSON.parse(await (await import("fs/promises")).readFile(sessionPath, "utf-8"))
      const comment = updated.reviews[0].comments[0]
      expect(comment.replies).toHaveLength(1)
      expect(comment.replies[0].body).toBe("great point")
      expect(comment.replies[0].source).toBe("user")
    })

    it("user reply also writes to replies.json", async () => {
      await writeSessionWithComment("cmt-reply-2")
      const repliesPath = join(tmpDir, ".review", "replies.json")
      await (await import("fs/promises")).writeFile(repliesPath, "[]")
      await fetch(`http://localhost:${serverResult.port}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "cmt-reply-2", body: "user text" }),
      })
      const replies = JSON.parse(await (await import("fs/promises")).readFile(repliesPath, "utf-8"))
      expect(replies).toHaveLength(1)
      expect(replies[0].comment_id).toBe("cmt-reply-2")
    })

    it("claude-code reply persists in session.json but NOT replies.json", async () => {
      await writeSessionWithComment("cmt-reply-3")
      const repliesPath = join(tmpDir, ".review", "replies.json")
      await (await import("fs/promises")).writeFile(repliesPath, "[]")
      const sessionPath = join(tmpDir, ".review", "session.json")
      await fetch(`http://localhost:${serverResult.port}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "cmt-reply-3", body: "AI response", source: "claude-code" }),
      })
      const session = JSON.parse(await (await import("fs/promises")).readFile(sessionPath, "utf-8"))
      expect(session.reviews[0].comments[0].replies[0].source).toBe("claude-code")
      const replies = JSON.parse(await (await import("fs/promises")).readFile(repliesPath, "utf-8"))
      expect(replies).toHaveLength(0)
    })
  })

  // ── POST /resolve (staged GitHub thread resolves) ────────────────────────

  describe("POST /resolve with github_thread_id stages the resolve", () => {
    it("adds github_thread_id to pending_resolves", async () => {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      const session = {
        version: 1, repo: tmpDir, base_branch: "main",
        head_commit: "abc", current_commit: "abc",
        reviews: [{
          id: "r1", commit_id: "abc", event: "COMMENT",
          comments: [{
            id: "c-gh-1", created_at: "2026-01-01T00:00:00Z",
            source: "user", body: "original", path: "f.ts", commit_id: "abc",
            line: 5, side: "RIGHT",
            github_id: 123, github_thread_id: "PRRT_abc",
          }],
          created_at: "2026-01-01T00:00:00Z",
        }],
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      }
      const sessionPath = join(reviewDir, "session.json")
      await writeFile(sessionPath, JSON.stringify(session))

      const res = await fetch(`http://localhost:${serverResult.port}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "c-gh-1" }),
      })
      expect(res.status).toBe(200)

      const updated = JSON.parse(await (await import("fs/promises")).readFile(sessionPath, "utf-8"))
      expect(updated.pending_resolves).toContain("PRRT_abc")
    })

    it("does not add to pending_resolves for comments without github_thread_id", async () => {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      const session = {
        version: 1, repo: tmpDir, base_branch: "main",
        head_commit: "abc", current_commit: "abc",
        reviews: [{
          id: "r1", commit_id: "abc", event: "COMMENT",
          comments: [{
            id: "c-local", created_at: "2026-01-01T00:00:00Z",
            source: "claude-code", body: "local only", path: "f.ts",
            commit_id: "abc", line: 5, side: "RIGHT",
          }],
          created_at: "2026-01-01T00:00:00Z",
        }],
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      }
      const sessionPath = join(reviewDir, "session.json")
      await writeFile(sessionPath, JSON.stringify(session))

      await fetch(`http://localhost:${serverResult.port}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "c-local" }),
      })

      const updated = JSON.parse(await (await import("fs/promises")).readFile(sessionPath, "utf-8"))
      expect(updated.pending_resolves ?? []).toHaveLength(0)
    })
  })

  // ── POST /review/body ─────────────────────────────────────────────────────

  // ── POST /action ─────────────────────────────────────────────────────────

  describe("POST /action", () => {
    async function writeSessionForAction(commentId = "act-c1", threadId?: string) {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      const comment: Record<string, unknown> = {
        id: commentId, created_at: "2026-01-01T00:00:00Z",
        source: "claude-code", body: "fix this", path: "f.ts",
        commit_id: "abc", line: 5, side: "RIGHT",
      }
      if (threadId) { comment.github_id = 1; comment.github_thread_id = threadId }
      const session = {
        version: 1, repo: tmpDir, base_branch: "main",
        head_commit: "abc", current_commit: "abc",
        reviews: [{ id: "r1", commit_id: "abc", event: "COMMENT", comments: [comment], created_at: "2026-01-01T00:00:00Z" }],
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      }
      const sessionPath = join(reviewDir, "session.json")
      await writeFile(sessionPath, JSON.stringify(session))
      return sessionPath
    }

    it("resolves comment without creating a visible reply in session", async () => {
      const sessionPath = await writeSessionForAction("act-c2")
      await fetch(`http://localhost:${serverResult.port}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "act-c2", action: "fix" }),
      })
      const updated = JSON.parse(await (await import("fs/promises")).readFile(sessionPath, "utf-8"))
      const comment = updated.reviews[0].comments[0]
      expect(comment.resolved).toBe(true)
      expect(comment.replies).toBeUndefined()
    })

    it("writes action to replies.json for monitor", async () => {
      await writeSessionForAction("act-c3")
      const repliesPath = join(tmpDir, ".review", "replies.json")
      await (await import("fs/promises")).writeFile(repliesPath, "[]")
      await fetch(`http://localhost:${serverResult.port}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "act-c3", action: "reject" }),
      })
      const replies = JSON.parse(await (await import("fs/promises")).readFile(repliesPath, "utf-8"))
      expect(replies[0].body).toBe("Rejected")
      expect(replies[0].comment_id).toBe("act-c3")
    })

    it("stages github_thread_id in pending_resolves", async () => {
      const sessionPath = await writeSessionForAction("act-c4", "PRRT_action_test")
      await fetch(`http://localhost:${serverResult.port}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "act-c4", action: "fix" }),
      })
      const updated = JSON.parse(await (await import("fs/promises")).readFile(sessionPath, "utf-8"))
      expect(updated.pending_resolves).toContain("PRRT_action_test")
    })

    it("returns 404 for unknown comment", async () => {
      await writeSessionForAction()
      const res = await fetch(`http://localhost:${serverResult.port}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "nonexistent", action: "fix" }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe("POST /review/body", () => {
    async function writeSessionForBody() {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      const session = {
        version: 1, repo: tmpDir, base_branch: "main",
        head_commit: "abc", current_commit: "abc",
        reviews: [{ id: "r1", commit_id: "abc", event: "COMMENT", comments: [], created_at: "2026-01-01T00:00:00Z" }],
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      }
      const sessionPath = join(reviewDir, "session.json")
      await writeFile(sessionPath, JSON.stringify(session))
      return sessionPath
    }

    it("sets review body and returns 200", async () => {
      const sessionPath = await writeSessionForBody()
      const res = await fetch(`http://localhost:${serverResult.port}/review/body`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "LGTM overall, minor nits below." }),
      })
      expect(res.status).toBe(200)
      const updated = JSON.parse(await (await import("fs/promises")).readFile(sessionPath, "utf-8"))
      expect(updated.reviews[updated.reviews.length - 1].body).toBe("LGTM overall, minor nits below.")
    })

    it("returns 404 when no session.json exists", async () => {
      await (await import("fs/promises")).rm(join(tmpDir, ".review", "session.json"), { force: true })
      const res = await fetch(`http://localhost:${serverResult.port}/review/body`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "test" }),
      })
      expect(res.status).toBe(404)
    })

    it("clears review body when empty string is sent", async () => {
      const sessionPath = await writeSessionForBody()
      await fetch(`http://localhost:${serverResult.port}/review/body`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "" }),
      })
      const updated = JSON.parse(await (await import("fs/promises")).readFile(sessionPath, "utf-8"))
      expect(updated.reviews[updated.reviews.length - 1].body).toBeUndefined()
    })
  })

  // ── POST /edit-comment ────────────────────────────────────────────────────

  describe("POST /edit-comment", () => {
    async function writeSessionForEdit(commentId = "cmt-edit-1") {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      const session = {
        version: 1, repo: tmpDir, base_branch: "main",
        head_commit: "abc", current_commit: "abc",
        reviews: [{
          id: "r1", commit_id: "abc", event: "COMMENT",
          comments: [{
            id: commentId, created_at: "2026-01-01T00:00:00Z",
            source: "claude-code", body: "old body", severity: "note",
            path: "src/foo.ts", commit_id: "abc", line: 5, side: "RIGHT",
          }],
          created_at: "2026-01-01T00:00:00Z",
        }],
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      }
      const sessionPath = join(reviewDir, "session.json")
      await writeFile(sessionPath, JSON.stringify(session))
      return sessionPath
    }

    it("updates comment body and returns 200", async () => {
      const sessionPath = await writeSessionForEdit("cmt-edit-2")
      const res = await fetch(`http://localhost:${serverResult.port}/edit-comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "cmt-edit-2", body: "revised body" }),
      })
      expect(res.status).toBe(200)
      const updated = JSON.parse(await (await import("fs/promises")).readFile(sessionPath, "utf-8"))
      expect(updated.reviews[0].comments[0].body).toBe("revised body")
    })

    it("returns 404 when comment not found", async () => {
      await writeSessionForEdit("cmt-edit-3")
      const res = await fetch(`http://localhost:${serverResult.port}/edit-comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: "nonexistent-id", body: "new text" }),
      })
      expect(res.status).toBe(404)
    })

    it("returns 400 when comment_id is missing", async () => {
      await writeSessionForEdit()
      const res = await fetch(`http://localhost:${serverResult.port}/edit-comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "no id" }),
      })
      expect(res.status).toBe(400)
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

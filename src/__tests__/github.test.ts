import { describe, it, expect } from "bun:test"
import { checkAuth, findOpenPR, buildReviewPayload, pushReview } from "../github"
import type { Review, ReviewComment } from "../session"

// ── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal mock spawn that resolves exitCode immediately */
function mockSpawn(exitCode: number, stdout = "", stderr = "") {
  return (_args: string[], _opts?: unknown) => ({
    exitCode,
    stdout: {
      // Bun ReadableStream interface — tests that need text call .text()
      async text() {
        return stdout
      },
    },
    stderr: {
      async text() {
        return stderr
      },
    },
    exited: Promise.resolve(exitCode),
  })
}


function makeComment(overrides?: Partial<ReviewComment>): ReviewComment {
  return {
    id: "cmt-1",
    created_at: "2026-01-01T00:00:00.000Z",
    source: "claude-code",
    severity: "suggestion",
    resolved: false,
    replies: [],
    line_content: "const x = 1",
    original_line: 10,
    is_outdated: false,
    body: "Consider renaming this",
    path: "src/foo.ts",
    commit_id: "abc123",
    line: 5,
    side: "RIGHT",
    start_line: 3,
    start_side: "RIGHT",
    in_reply_to_id: undefined as number | undefined,
    ...overrides,
  }
}

function makeReview(overrides?: Partial<Review>): Review {
  return {
    id: "rev-1",
    commit_id: "abc123",
    body: "Overall LGTM",
    event: "COMMENT",
    comments: [makeComment()],
    created_at: "2026-01-01T00:00:00.000Z",
    source: "claude-code",
    ...overrides,
  }
}

// ── checkAuth ──────────────────────────────────────────────────────────────

describe("github", () => {
  describe("checkAuth", () => {
    it("returns true when gh auth status exits 0", async () => {
      const result = await checkAuth(mockSpawn(0) as unknown as typeof Bun.spawn)
      expect(result).toBe(true)
    })

    it("returns false when gh auth status exits non-zero", async () => {
      const result = await checkAuth(mockSpawn(1) as unknown as typeof Bun.spawn)
      expect(result).toBe(false)
    })
  })

  // ── findOpenPR ─────────────────────────────────────────────────────────

  describe("findOpenPR", () => {
    it("returns PR number when gh pr view returns a number", async () => {
      const spawn = mockSpawn(0, JSON.stringify({ number: 42 }))
      const result = await findOpenPR("/repo", spawn as unknown as typeof Bun.spawn)
      expect(result).toBe(42)
    })

    it("returns null when no PR exists (non-zero exit)", async () => {
      const spawn = mockSpawn(1, "")
      const result = await findOpenPR("/repo", spawn as unknown as typeof Bun.spawn)
      expect(result).toBeNull()
    })
  })

  // ── buildReviewPayload ─────────────────────────────────────────────────

  describe("buildReviewPayload", () => {
    it("strips local-only fields from comments", () => {
      const review = makeReview()
      const payload = buildReviewPayload(review)
      const comment = payload.comments[0]

      // None of the local-only fields should appear
      expect("id" in comment).toBe(false)
      expect("created_at" in comment).toBe(false)
      expect("source" in comment).toBe(false)
      expect("severity" in comment).toBe(false)
      expect("resolved" in comment).toBe(false)
      expect("replies" in comment).toBe(false)
    })

    it("strips line_content, original_line, is_outdated from output", () => {
      const review = makeReview()
      const payload = buildReviewPayload(review)
      const comment = payload.comments[0]

      expect("line_content" in comment).toBe(false)
      expect("original_line" in comment).toBe(false)
      expect("is_outdated" in comment).toBe(false)
    })

    it("strips id, created_at, source, severity, resolved, replies", () => {
      const review = makeReview()
      const payload = buildReviewPayload(review)
      const comment = payload.comments[0]

      expect("id" in comment).toBe(false)
      expect("created_at" in comment).toBe(false)
      expect("source" in comment).toBe(false)
      expect("severity" in comment).toBe(false)
      expect("resolved" in comment).toBe(false)
      expect("replies" in comment).toBe(false)
    })

    it("excludes outdated comments by default", () => {
      const review = makeReview({
        comments: [
          makeComment({ is_outdated: false }),
          makeComment({ id: "cmt-2", is_outdated: true }),
        ],
      })
      const payload = buildReviewPayload(review)
      expect(payload.comments).toHaveLength(1)
    })

    it("includes outdated comments when includeOutdated is true", () => {
      const review = makeReview({
        comments: [
          makeComment({ is_outdated: false }),
          makeComment({ id: "cmt-2", is_outdated: true }),
        ],
      })
      const payload = buildReviewPayload(review, { includeOutdated: true })
      expect(payload.comments).toHaveLength(2)
    })

    it("excludes resolved comments", () => {
      const review = makeReview({
        comments: [
          makeComment({ resolved: false }),
          makeComment({ id: "cmt-2", resolved: true }),
        ],
      })
      const payload = buildReviewPayload(review)
      expect(payload.comments).toHaveLength(1)
    })

    it("sets event correctly for APPROVE", () => {
      const review = makeReview({ event: "APPROVE" })
      const payload = buildReviewPayload(review)
      expect(payload.event).toBe("APPROVE")
    })

    it("sets event correctly for REQUEST_CHANGES", () => {
      const review = makeReview({ event: "REQUEST_CHANGES" })
      const payload = buildReviewPayload(review)
      expect(payload.event).toBe("REQUEST_CHANGES")
    })

    it("preserves GitHub API fields on comments", () => {
      const review = makeReview()
      const payload = buildReviewPayload(review)
      const comment = payload.comments[0]

      expect(comment.body).toBe("Consider renaming this")
      expect(comment.path).toBe("src/foo.ts")
      expect(comment.line).toBe(5)
      expect(comment.side).toBe("RIGHT")
      expect(comment.start_line).toBe(3)
      expect(comment.start_side).toBe("RIGHT")
    })

    it("sets commit_id from review on the payload", () => {
      const review = makeReview({ commit_id: "deadbeef" })
      const payload = buildReviewPayload(review)
      expect(payload.commit_id).toBe("deadbeef")
    })

    it("sets body from review on the payload", () => {
      const review = makeReview({ body: "Needs work overall" })
      const payload = buildReviewPayload(review)
      expect(payload.body).toBe("Needs work overall")
    })

    it("omits undefined optional fields (start_line, start_side, in_reply_to_id)", () => {
      const review = makeReview({
        comments: [
          makeComment({ start_line: undefined, start_side: undefined, in_reply_to_id: undefined }),
        ],
      })
      const payload = buildReviewPayload(review)
      const comment = payload.comments[0]
      expect("start_line" in comment).toBe(false)
      expect("start_side" in comment).toBe(false)
      expect("in_reply_to_id" in comment).toBe(false)
    })
  })

  // ── pushReview ─────────────────────────────────────────────────────────

  describe("pushReview", () => {
    const samplePayload = {
      commit_id: "abc123",
      body: "LGTM",
      event: "COMMENT" as const,
      comments: [],
    }

    it("calls gh api with the correct endpoint", async () => {
      // First spawn call = gh repo view, second = gh api post
      let callIndex = 0
      const capturedArgs: string[][] = []

      const spawn = (args: string[], _opts?: unknown) => {
        capturedArgs.push(args)
        const outputs: Record<number, string> = {
          0: JSON.stringify({ owner: { login: "acme" }, name: "widget" }),
          1: "{}",
        }
        const stdout = outputs[callIndex] ?? "{}"
        callIndex++
        return {
          exitCode: 0,
          stdout: { async text() { return stdout } },
          stderr: { async text() { return "" } },
          exited: Promise.resolve(0),
        }
      }

      await pushReview("/repo", 7, samplePayload, spawn as unknown as typeof Bun.spawn)

      // The second call should hit the reviews endpoint
      const apiCall = capturedArgs[1]
      expect(apiCall).toBeDefined()
      expect(apiCall.join(" ")).toContain("/repos/acme/widget/pulls/7/reviews")
    })

    it("passes the correct JSON payload", async () => {
      let callIndex = 0
      let capturedOpts: Record<string, unknown> | undefined

      const spawn = (args: string[], opts?: Record<string, unknown>) => {
        if (callIndex === 1) {
          capturedOpts = opts
        }
        const outputs: Record<number, string> = {
          0: JSON.stringify({ owner: { login: "org" }, name: "repo" }),
          1: "{}",
        }
        const stdout = outputs[callIndex] ?? "{}"
        callIndex++
        return {
          exitCode: 0,
          stdout: { async text() { return stdout } },
          stderr: { async text() { return "" } },
          exited: Promise.resolve(0),
        }
      }

      const payload = { commit_id: "abc", event: "APPROVE" as const, comments: [] }
      await pushReview("/repo", 99, payload, spawn as unknown as typeof Bun.spawn)

      expect(capturedOpts).toBeDefined()
      const body = JSON.parse(Buffer.from(capturedOpts!.stdin as Buffer).toString())
      expect(body.event).toBe("APPROVE")
      expect(body.commit_id).toBe("abc")
    })

    it("throws when gh repo view fails", async () => {
      const spawn = (_args: string[], _opts?: unknown) => ({
        exitCode: 1,
        stdout: { async text() { return "" } },
        stderr: { async text() { return "not a git repo" } },
        exited: Promise.resolve(1),
      })

      await expect(
        pushReview("/repo", 1, samplePayload, spawn as unknown as typeof Bun.spawn)
      ).rejects.toThrow()
    })

    it("throws on non-zero gh exit code", async () => {
      let callIndex = 0

      const spawn = (args: string[], _opts?: unknown) => {
        const outputs: Record<number, string> = {
          0: JSON.stringify({ owner: { login: "org" }, name: "repo" }),
          1: "",
        }
        const exitCodes: Record<number, number> = { 0: 0, 1: 1 }
        const stdout = outputs[callIndex] ?? ""
        const exitCode = exitCodes[callIndex] ?? 1
        callIndex++
        return {
          exitCode,
          stdout: { async text() { return stdout } },
          stderr: { async text() { return "gh error" } },
          exited: Promise.resolve(exitCode),
        }
      }

      await expect(
        pushReview("/repo", 1, samplePayload, spawn as unknown as typeof Bun.spawn)
      ).rejects.toThrow()
    })
  })
})

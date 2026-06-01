import { describe, it, expect } from "bun:test"
import { checkAuth, findOpenPR, buildReviewPayload, pushReview, fetchPRInfo, fetchPRThreads, resolveThreads, postThreadReplies } from "../github"
import type { Review, ReviewComment } from "../session"

type SpawnResult = {
  exited: Promise<number>
  exitCode: number
  stdout: { text(): Promise<string> }
  stderr: { text(): Promise<string> }
  stdin?: unknown
}

function makeSpawn(responses: Array<{ exitCode: number; stdout?: string; stderr?: string }>) {
  const calls: Array<{ argv: string[]; opts: unknown }> = []
  let idx = 0
  const spawn = (argv: string[], opts?: unknown): SpawnResult => {
    calls.push({ argv, opts })
    const res = responses[idx++] ?? { exitCode: 0, stdout: "", stderr: "" }
    return {
      exited: Promise.resolve(res.exitCode),
      exitCode: res.exitCode,
      stdout: { text: async () => res.stdout ?? "" },
      stderr: { text: async () => res.stderr ?? "" },
    }
  }
  return { spawn: spawn as unknown as typeof Bun.spawn, calls }
}

function makeReview(overrides?: Partial<Review>): Review {
  return {
    id: "rev-1",
    commit_id: "abc123",
    event: "COMMENT",
    comments: [],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function makeComment(overrides?: Partial<ReviewComment>): ReviewComment {
  return {
    id: "c1",
    created_at: "2026-01-01T00:00:00Z",
    source: "claude-code",
    body: "looks good",
    path: "src/index.ts",
    commit_id: "abc123",
    line: 10,
    side: "RIGHT",
    line_content: "const x = 1",
    severity: "note",
    ...overrides,
  }
}

describe("checkAuth", () => {
  it("returns true when gh auth status exits 0", async () => {
    const { spawn } = makeSpawn([{ exitCode: 0 }])
    expect(await checkAuth(spawn)).toBe(true)
  })

  it("returns false when gh auth status exits non-zero", async () => {
    const { spawn } = makeSpawn([{ exitCode: 1, stderr: "not logged in" }])
    expect(await checkAuth(spawn)).toBe(false)
  })

  it("calls gh auth status", async () => {
    const { spawn, calls } = makeSpawn([{ exitCode: 0 }])
    await checkAuth(spawn)
    expect(calls[0].argv).toEqual(["gh", "auth", "status"])
  })
})

describe("findOpenPR", () => {
  it("returns PR number from gh pr view output", async () => {
    const { spawn } = makeSpawn([{ exitCode: 0, stdout: JSON.stringify({ number: 42 }) }])
    const result = await findOpenPR("/repo", spawn)
    expect(result).toBe(42)
  })

  it("returns null when gh pr view exits non-zero (no PR)", async () => {
    const { spawn } = makeSpawn([{ exitCode: 1, stderr: "no pull requests found" }])
    const result = await findOpenPR("/repo", spawn)
    expect(result).toBeNull()
  })

  it("returns null when stdout is malformed JSON", async () => {
    const { spawn } = makeSpawn([{ exitCode: 0, stdout: "not json {{{" }])
    const result = await findOpenPR("/repo", spawn)
    expect(result).toBeNull()
  })

  it("passes repoDir as cwd", async () => {
    const { spawn, calls } = makeSpawn([{ exitCode: 0, stdout: JSON.stringify({ number: 1 }) }])
    await findOpenPR("/my/repo", spawn)
    expect((calls[0].opts as { cwd: string }).cwd).toBe("/my/repo")
  })
})

describe("buildReviewPayload", () => {
  it("maps review fields to payload shape", () => {
    const review = makeReview({ event: "APPROVE" })
    const payload = buildReviewPayload(review)
    expect(payload.commit_id).toBe("abc123")
    expect(payload.event).toBe("APPROVE")
    expect(payload.comments).toEqual([])
  })

  it("maps ReviewComment to GitHubComment shape", () => {
    const comment = makeComment({ start_line: 8, start_side: "RIGHT" })
    const payload = buildReviewPayload(makeReview({ comments: [comment] }))
    const c = payload.comments[0]
    expect(c.path).toBe("src/index.ts")
    expect(c.line).toBe(10)
    expect(c.side).toBe("RIGHT")
    expect(c.body).toBe("looks good")
    expect(c.start_line).toBe(8)
    expect(c.start_side).toBe("RIGHT")
  })

  it("excludes resolved comments by default", () => {
    const resolved = makeComment({ id: "c-resolved", resolved: true })
    const active = makeComment({ id: "c-active" })
    const payload = buildReviewPayload(makeReview({ comments: [resolved, active] }))
    expect(payload.comments).toHaveLength(1)
    expect(payload.comments[0].body).toBe("looks good")
  })

  it("excludes outdated comments by default", () => {
    const outdated = makeComment({ id: "c-outdated", is_outdated: true })
    const payload = buildReviewPayload(makeReview({ comments: [outdated] }))
    expect(payload.comments).toHaveLength(0)
  })

  it("includes outdated comments when includeOutdated is true", () => {
    const outdated = makeComment({ is_outdated: true })
    const payload = buildReviewPayload(makeReview({ comments: [outdated] }), { includeOutdated: true })
    expect(payload.comments).toHaveLength(1)
  })

  it("includes body when review has a body", () => {
    const review = makeReview({ body: "LGTM overall" })
    const payload = buildReviewPayload(review)
    expect(payload.body).toBe("LGTM overall")
  })

  it("omits body when review has no body", () => {
    const payload = buildReviewPayload(makeReview())
    expect(payload.body).toBeUndefined()
  })

  it("defaults event to COMMENT when review event is undefined", () => {
    const review = makeReview({ event: undefined })
    const payload = buildReviewPayload(review)
    expect(payload.event).toBe("COMMENT")
  })
})

describe("fetchPRInfo", () => {
  const prViewOutput = JSON.stringify({
    number: 42,
    title: "Fix auth flow",
    author: { login: "alice" },
    body: "Fixes the login bug",
    state: "OPEN",
    baseRefName: "main",
    headRefName: "feat/auth",
    headRefOid: "deadbeef",
    statusCheckRollup: [
      { state: "SUCCESS" },
      { state: "SUCCESS" },
    ],
  })

  it("returns PR info fields", async () => {
    const { spawn } = makeSpawn([{ exitCode: 0, stdout: prViewOutput }])
    const info = await fetchPRInfo("/repo", undefined, spawn)
    expect(info?.number).toBe(42)
    expect(info?.title).toBe("Fix auth flow")
    expect(info?.author).toBe("alice")
    expect(info?.baseRefName).toBe("main")
    expect(info?.headRefName).toBe("feat/auth")
    expect(info?.headSha).toBe("deadbeef")
  })

  it("returns checks_status success when all checks pass", async () => {
    const { spawn } = makeSpawn([{ exitCode: 0, stdout: prViewOutput }])
    const info = await fetchPRInfo("/repo", undefined, spawn)
    expect(info?.checks_status).toBe("success")
  })

  it("returns checks_status failure when any check fails", async () => {
    const out = JSON.stringify({
      number: 1, title: "t", author: { login: "u" }, body: "", state: "OPEN",
      baseRefName: "main", headRefName: "b", headRefOid: "abc",
      statusCheckRollup: [{ state: "FAILURE" }, { state: "SUCCESS" }],
    })
    const { spawn } = makeSpawn([{ exitCode: 0, stdout: out }])
    const info = await fetchPRInfo("/repo", undefined, spawn)
    expect(info?.checks_status).toBe("failure")
  })

  it("returns checks_status pending when any check is pending", async () => {
    const out = JSON.stringify({
      number: 1, title: "t", author: { login: "u" }, body: "", state: "OPEN",
      baseRefName: "main", headRefName: "b", headRefOid: "abc",
      statusCheckRollup: [{ state: "EXPECTED" }, { state: "SUCCESS" }],
    })
    const { spawn } = makeSpawn([{ exitCode: 0, stdout: out }])
    const info = await fetchPRInfo("/repo", undefined, spawn)
    expect(info?.checks_status).toBe("pending")
  })

  it("returns neutral when statusCheckRollup is empty", async () => {
    const out = JSON.stringify({
      number: 1, title: "t", author: { login: "u" }, body: "", state: "OPEN",
      baseRefName: "main", headRefName: "b", headRefOid: "abc",
      statusCheckRollup: [],
    })
    const { spawn } = makeSpawn([{ exitCode: 0, stdout: out }])
    const info = await fetchPRInfo("/repo", undefined, spawn)
    expect(info?.checks_status).toBe("neutral")
  })

  it("returns null when gh pr view fails (no open PR)", async () => {
    const { spawn } = makeSpawn([{ exitCode: 1, stderr: "no pull requests found" }])
    const info = await fetchPRInfo("/repo", undefined, spawn)
    expect(info).toBeNull()
  })

  it("passes PR number when provided", async () => {
    const { spawn, calls } = makeSpawn([{ exitCode: 0, stdout: prViewOutput }])
    await fetchPRInfo("/repo", 42, spawn)
    expect(calls[0].argv).toContain("42")
  })

  it("omits PR number from argv when undefined (current branch detection)", async () => {
    const { spawn, calls } = makeSpawn([{ exitCode: 0, stdout: prViewOutput }])
    await fetchPRInfo("/repo", undefined, spawn)
    expect(calls[0].argv).not.toContain("42")
    expect(calls[0].argv[1]).toBe("pr")
  })
})

describe("fetchPRThreads", () => {
  // Spawn order: getRepoOwnerName → REST comments → GraphQL threads.
  const repoView = { exitCode: 0, stdout: JSON.stringify({ owner: { login: "z" }, name: "repo" }) }
  function graphql(threads: unknown[]) {
    return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } } })
  }
  function restComment(o: Record<string, unknown>) {
    return {
      id: 0, user: { login: "alice" }, body: "", path: "a.ts",
      line: 1, original_line: 1, start_line: null, start_side: null, side: "RIGHT",
      subject_type: "line", created_at: "2026-01-01T00:00:00Z", ...o,
    }
  }

  it("maps review comments to ReviewComment[] with author and side", async () => {
    const rest = [restComment({ id: 999, user: { login: "alice" }, body: "Use async/await", path: "src/foo.ts", line: 10 })]
    const gql = graphql([{ id: "PRRT_abc", isResolved: false, comments: { nodes: [{ fullDatabaseId: "999", outdated: false }] } }])
    const { spawn } = makeSpawn([repoView, { exitCode: 0, stdout: JSON.stringify(rest) }, { exitCode: 0, stdout: gql }])
    const threads = await fetchPRThreads("/repo", 1, "deadbeef", spawn)
    expect(threads).toHaveLength(1)
    const c = threads[0]
    expect(c.body).toBe("Use async/await")
    expect(c.path).toBe("src/foo.ts")
    expect(c.line).toBe(10)
    expect(c.author).toBe("alice")
    expect(c.side).toBe("RIGHT")
    expect(c.source).toBe("user")
    expect(c.github_id).toBe(999)
    expect(c.github_thread_id).toBe("PRRT_abc")
    expect(c.resolved).toBe(false)
    expect(c.commit_id).toBe("deadbeef")
  })

  it("marks already-resolved threads as resolved", async () => {
    const rest = [restComment({ id: 1, user: { login: "bob" }, body: "fixed" })]
    const gql = graphql([{ id: "PRRT_xyz", isResolved: true, comments: { nodes: [{ fullDatabaseId: "1", outdated: false }] } }])
    const { spawn } = makeSpawn([repoView, { exitCode: 0, stdout: JSON.stringify(rest) }, { exitCode: 0, stdout: gql }])
    const threads = await fetchPRThreads("/repo", 1, "abc", spawn)
    expect(threads[0].resolved).toBe(true)
  })

  it("groups replies under their root comment with authors", async () => {
    const rest = [
      restComment({ id: 10, user: { login: "alice" }, body: "please rename", line: 5 }),
      restComment({ id: 11, user: { login: "bob" }, body: "done", line: 5, in_reply_to_id: 10, created_at: "2026-01-01T01:00:00Z" }),
    ]
    const gql = graphql([{ id: "PRRT_1", isResolved: false, comments: { nodes: [{ fullDatabaseId: "10", outdated: false }, { fullDatabaseId: "11", outdated: false }] } }])
    const { spawn } = makeSpawn([repoView, { exitCode: 0, stdout: JSON.stringify(rest) }, { exitCode: 0, stdout: gql }])
    const threads = await fetchPRThreads("/repo", 1, "abc", spawn)
    expect(threads).toHaveLength(1)
    expect(threads[0].author).toBe("alice")
    expect(threads[0].replies).toHaveLength(1)
    expect(threads[0].replies![0].author).toBe("bob")
    expect(threads[0].replies![0].body).toBe("done")
  })

  it("captures LEFT side and multi-line range", async () => {
    const rest = [restComment({ id: 7, body: "deleted line issue", line: 20, start_line: 18, start_side: "LEFT", side: "LEFT" })]
    const gql = graphql([{ id: "PRRT_2", isResolved: false, comments: { nodes: [{ fullDatabaseId: "7", outdated: false }] } }])
    const { spawn } = makeSpawn([repoView, { exitCode: 0, stdout: JSON.stringify(rest) }, { exitCode: 0, stdout: gql }])
    const threads = await fetchPRThreads("/repo", 1, "abc", spawn)
    expect(threads[0].side).toBe("LEFT")
    expect(threads[0].start_line).toBe(18)
    expect(threads[0].start_side).toBe("LEFT")
  })

  it("returns empty array when there are no review comments", async () => {
    const { spawn } = makeSpawn([repoView, { exitCode: 0, stdout: "[]" }])
    const threads = await fetchPRThreads("/repo", 1, "abc", spawn)
    expect(threads).toEqual([])
  })
})

describe("resolveThreads", () => {
  const repoViewOutput = JSON.stringify({ owner: { login: "z" }, name: "repo" })

  it("calls graphql mutation for each thread id", async () => {
    const { spawn, calls } = makeSpawn([
      { exitCode: 0, stdout: repoViewOutput },
      { exitCode: 0, stdout: '{"data":{}}' },
      { exitCode: 0, stdout: '{"data":{}}' },
    ])
    await resolveThreads("/repo", ["PRRT_aaa", "PRRT_bbb"], spawn)
    // One repo view call + two graphql calls
    expect(calls).toHaveLength(3)
    const body1 = JSON.parse((calls[1].opts as { stdin: Buffer }).stdin.toString())
    expect(body1.variables.threadId).toBe("PRRT_aaa")
    const body2 = JSON.parse((calls[2].opts as { stdin: Buffer }).stdin.toString())
    expect(body2.variables.threadId).toBe("PRRT_bbb")
  })

  it("resolves nothing when threadIds is empty", async () => {
    const { spawn, calls } = makeSpawn([])
    await resolveThreads("/repo", [], spawn)
    expect(calls).toHaveLength(0)
  })

  it("does not throw when a resolve call fails (best-effort)", async () => {
    const { spawn } = makeSpawn([
      { exitCode: 0, stdout: repoViewOutput },
      { exitCode: 1, stderr: "thread not found" },
    ])
    await expect(resolveThreads("/repo", ["PRRT_bad"], spawn)).resolves.toBeUndefined()
  })
})

describe("pushReview", () => {
  const repoViewOutput = JSON.stringify({ owner: { login: "zdonhauser" }, name: "clodiff" })

  it("calls gh repo view then gh api with correct endpoint", async () => {
    const { spawn, calls } = makeSpawn([
      { exitCode: 0, stdout: repoViewOutput },
      { exitCode: 0, stdout: "{}" },
    ])
    const payload = buildReviewPayload(makeReview())
    await pushReview("/repo", 42, payload, spawn)
    expect(calls[0].argv).toEqual(["gh", "repo", "view", "--json", "owner,name"])
    expect(calls[1].argv).toContain("/repos/zdonhauser/clodiff/pulls/42/reviews")
    expect(calls[1].argv).toContain("POST")
  })

  it("throws when gh repo view fails", async () => {
    const { spawn } = makeSpawn([{ exitCode: 1, stderr: "not a git repo" }])
    await expect(pushReview("/repo", 1, buildReviewPayload(makeReview()), spawn)).rejects.toThrow("gh repo view failed")
  })

  it("throws when gh api fails", async () => {
    const { spawn } = makeSpawn([
      { exitCode: 0, stdout: repoViewOutput },
      { exitCode: 1, stderr: "Unprocessable Entity" },
    ])
    await expect(pushReview("/repo", 1, buildReviewPayload(makeReview()), spawn)).rejects.toThrow("gh api failed")
  })

  it("sends the review payload as JSON to gh api stdin", async () => {
    const { spawn, calls } = makeSpawn([
      { exitCode: 0, stdout: repoViewOutput },
      { exitCode: 0, stdout: "{}" },
    ])
    const payload = buildReviewPayload(makeReview({ event: "APPROVE" }))
    await pushReview("/repo", 7, payload, spawn)
    const stdinBuf = (calls[1].opts as { stdin: Buffer }).stdin
    const body = JSON.parse(stdinBuf.toString())
    expect(body.event).toBe("APPROVE")
    expect(body.commit_id).toBe("abc123")
  })
})

describe("postThreadReplies", () => {
  it("posts each reply with in_reply_to and returns the count", async () => {
    const { spawn, calls } = makeSpawn([
      { exitCode: 0, stdout: JSON.stringify({ owner: { login: "z" }, name: "repo" }) },
      { exitCode: 0, stdout: "{}" },
      { exitCode: 0, stdout: "{}" },
    ])
    const posted = await postThreadReplies("/repo", 7, [
      { in_reply_to: 100, body: "done" },
      { in_reply_to: 101, body: "good point" },
    ], spawn)
    expect(posted).toBe(2)
    const postCalls = calls.filter((c) => c.argv.includes("--method"))
    expect(postCalls).toHaveLength(2)
    expect(postCalls[0].argv.join(" ")).toContain("/pulls/7/comments")
    const stdin = (postCalls[0].opts as { stdin: Buffer }).stdin
    const payload = JSON.parse(Buffer.from(stdin).toString())
    expect(payload.in_reply_to).toBe(100)
    expect(payload.body).toBe("done")
  })

  it("returns 0 when there are no replies", async () => {
    const { spawn } = makeSpawn([])
    expect(await postThreadReplies("/repo", 7, [], spawn)).toBe(0)
  })
})

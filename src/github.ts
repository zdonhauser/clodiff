import type { Review, ReviewComment } from "./session"

// ── Types ──────────────────────────────────────────────────────────────────

export interface GitHubComment {
  path: string
  line: number
  side: "LEFT" | "RIGHT"
  body: string
  start_line?: number
  start_side?: "LEFT" | "RIGHT"
  in_reply_to_id?: string
}

export interface GitHubReviewPayload {
  commit_id: string
  body?: string
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
  comments: GitHubComment[]
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Convert a ReviewComment to a GitHubComment, stripping all local-only fields. */
function toGitHubComment(rc: ReviewComment): GitHubComment {
  const comment: GitHubComment = {
    path: rc.path,
    line: rc.line,
    side: rc.side,
    body: rc.body,
  }

  if (rc.start_line !== undefined) comment.start_line = rc.start_line
  if (rc.start_side !== undefined) comment.start_side = rc.start_side
  if (rc.in_reply_to_id !== undefined) comment.in_reply_to_id = rc.in_reply_to_id

  return comment
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns true if `gh auth status` exits 0, false otherwise.
 *
 * Accepts an optional spawn function so tests can inject a mock.
 */
export async function checkAuth(_spawn: typeof Bun.spawn = Bun.spawn): Promise<boolean> {
  const proc = _spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" })
  await proc.exited
  return proc.exitCode === 0
}

/**
 * Returns the open PR number for the current branch, or null if none exists.
 *
 * Uses: gh pr view --json number
 */
export async function findOpenPR(
  repoDir: string,
  _spawn: typeof Bun.spawn = Bun.spawn,
): Promise<number | null> {
  const proc = _spawn(["gh", "pr", "view", "--json", "number"], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: repoDir,
  })
  await proc.exited

  if (proc.exitCode !== 0) return null

  try {
    const text = await (proc.stdout as { text(): Promise<string> }).text()
    const data = JSON.parse(text) as { number: number }
    return data.number
  } catch {
    return null
  }
}

/**
 * Pure function — builds the GitHub API payload from a Review object.
 *
 * - Strips all local-only fields (id, created_at, source, severity, resolved,
 *   replies, line_content, original_line, is_outdated) from each comment.
 * - Excludes comments where is_outdated === true (unless includeOutdated is true).
 * - Excludes comments where resolved === true.
 */
export function buildReviewPayload(
  review: Review,
  options?: { includeOutdated?: boolean },
): GitHubReviewPayload {
  const includeOutdated = options?.includeOutdated ?? false

  const filteredComments = review.comments.filter((c) => {
    if (c.resolved === true) return false
    if (!includeOutdated && c.is_outdated === true) return false
    return true
  })

  const payload: GitHubReviewPayload = {
    commit_id: review.commit_id,
    event: review.event,
    comments: filteredComments.map(toGitHubComment),
  }

  if (review.body !== undefined) payload.body = review.body

  return payload
}

/**
 * Posts a review to GitHub using the gh CLI.
 *
 * owner/repo are derived from `gh repo view --json owner,name`
 * Throws on non-zero gh exit code.
 */
export async function pushReview(
  repoDir: string,
  prNumber: number,
  payload: GitHubReviewPayload,
  _spawn: typeof Bun.spawn = Bun.spawn,
): Promise<void> {
  // 1. Resolve owner/repo
  const repoProc = _spawn(["gh", "repo", "view", "--json", "owner,name"], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: repoDir,
  })
  await repoProc.exited

  if (repoProc.exitCode !== 0) {
    const err = await (repoProc.stderr as { text(): Promise<string> }).text()
    throw new Error(`gh repo view failed: ${err}`)
  }

  const repoText = await (repoProc.stdout as { text(): Promise<string> }).text()
  const repoData = JSON.parse(repoText) as { owner: { login: string }; name: string }
  const owner = repoData.owner.login
  const repo = repoData.name

  const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`
  const body = JSON.stringify(payload)

  // 2. POST the review
  const apiProc = _spawn(
    ["gh", "api", "--method", "POST", endpoint, "--input", "-"],
    {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      input: body,
    },
  )
  await apiProc.exited

  if (apiProc.exitCode !== 0) {
    const err = await (apiProc.stderr as { text(): Promise<string> }).text()
    throw new Error(`gh api failed (exit ${apiProc.exitCode}): ${err}`)
  }
}

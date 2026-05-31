import type { Review, ReviewComment, PRMeta } from "./session"

export interface GitHubComment {
  path: string
  line: number
  side: "LEFT" | "RIGHT"
  body: string
  start_line?: number
  start_side?: "LEFT" | "RIGHT"
  in_reply_to_id?: number
}

export interface GitHubReviewPayload {
  commit_id: string
  body?: string
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
  comments: GitHubComment[]
}

export interface PRInfo {
  number: number
  title: string
  author: string
  body: string
  state: string
  baseRefName: string
  headRefName: string
  headSha: string
  checks_status: PRMeta["checks_status"]
}

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

async function getRepoOwnerName(
  repoDir: string,
  _spawn: typeof Bun.spawn,
): Promise<{ owner: string; name: string }> {
  const proc = _spawn(["gh", "repo", "view", "--json", "owner,name"], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: repoDir,
  })
  await proc.exited
  if (proc.exitCode !== 0) {
    const err = await (proc.stderr as { text(): Promise<string> }).text()
    throw new Error(`gh repo view failed: ${err}`)
  }
  const text = await (proc.stdout as { text(): Promise<string> }).text()
  const data = JSON.parse(text) as { owner: { login: string }; name: string }
  return { owner: data.owner.login, name: data.name }
}

function deriveChecksStatus(rollup: Array<Record<string, unknown>>): PRMeta["checks_status"] {
  if (!rollup || rollup.length === 0) return "neutral"
  // CheckRun uses `conclusion`/`status`; StatusContext uses `state`
  const states = rollup.map((r) => {
    const v = (r.conclusion ?? r.state ?? r.status ?? "PENDING") as string
    return v.toUpperCase()
  })
  if (states.some((s) => s === "FAILURE" || s === "ERROR" || s === "TIMED_OUT" || s === "CANCELLED")) return "failure"
  if (states.some((s) => !["SUCCESS", "NEUTRAL", "SKIPPED", ""].includes(s))) return "pending"
  return "success"
}

export async function fetchPRInfo(
  repoDir: string,
  prNumber?: number,
  _spawn: typeof Bun.spawn = Bun.spawn,
): Promise<PRInfo | null> {
  const fields = "number,title,author,body,state,baseRefName,headRefName,headRefOid,statusCheckRollup"
  const argv = prNumber !== undefined
    ? ["gh", "pr", "view", String(prNumber), "--json", fields]
    : ["gh", "pr", "view", "--json", fields]

  const proc = _spawn(argv, { stdout: "pipe", stderr: "pipe", cwd: repoDir })
  await proc.exited
  if (proc.exitCode !== 0) return null
  try {
    const text = await (proc.stdout as { text(): Promise<string> }).text()
    const d = JSON.parse(text) as {
      number: number
      title: string
      author: { login: string }
      body: string
      state: string
      baseRefName: string
      headRefName: string
      headRefOid: string
      statusCheckRollup: Array<{ state: string }>
    }
    return {
      number: d.number,
      title: d.title,
      author: d.author?.login ?? "unknown",
      body: d.body ?? "",
      state: d.state,
      baseRefName: d.baseRefName,
      headRefName: d.headRefName,
      headSha: d.headRefOid,
      checks_status: deriveChecksStatus(d.statusCheckRollup ?? []),
    }
  } catch {
    return null
  }
}

const PR_THREADS_QUERY = `
query GetPRThreads($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 50) {
            nodes {
              databaseId
              body
              path
              line
              originalLine
              author { login }
              createdAt
              outdated
            }
          }
        }
      }
    }
  }
}`.trim()

export async function fetchPRThreads(
  repoDir: string,
  prNumber: number,
  headSha: string,
  _spawn: typeof Bun.spawn = Bun.spawn,
): Promise<ReviewComment[]> {
  let owner: string, name: string
  try {
    const r = await getRepoOwnerName(repoDir, _spawn)
    owner = r.owner
    name = r.name
  } catch {
    return []
  }

  const gqlBody = JSON.stringify({
    query: PR_THREADS_QUERY,
    variables: { owner, repo: name, number: prNumber },
  })
  const proc = _spawn(
    ["gh", "api", "graphql", "--input", "-"],
    { stdout: "pipe", stderr: "pipe", stdin: Buffer.from(gqlBody) },
  )
  await proc.exited
  if (proc.exitCode !== 0) return []

  try {
    const text = await (proc.stdout as { text(): Promise<string> }).text()
    const resp = JSON.parse(text) as {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: Array<{
                id: string
                isResolved: boolean
                comments: {
                  nodes: Array<{
                    databaseId: number
                    body: string
                    path: string
                    line: number | null
                    originalLine: number | null
                    author: { login: string }
                    createdAt: string
                    outdated: boolean
                  }>
                }
              }>
            }
          }
        }
      }
    }

    const threads = resp?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
    const comments: ReviewComment[] = []

    for (const thread of threads) {
      const firstComment = thread.comments.nodes[0]
      if (!firstComment) continue
      const line = firstComment.line ?? firstComment.originalLine ?? 1
      comments.push({
        id: crypto.randomUUID(),
        created_at: firstComment.createdAt,
        source: "user",
        body: firstComment.body,
        path: firstComment.path,
        commit_id: headSha,
        line,
        side: "RIGHT",
        resolved: thread.isResolved,
        is_outdated: firstComment.outdated,
        github_id: firstComment.databaseId,
        github_thread_id: thread.id,
      })
    }

    return comments
  } catch {
    return []
  }
}

const RESOLVE_MUTATION = `
mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`.trim()

export async function resolveThreads(
  repoDir: string,
  threadIds: string[],
  _spawn: typeof Bun.spawn = Bun.spawn,
): Promise<void> {
  if (threadIds.length === 0) return

  let owner: string, name: string
  try {
    const r = await getRepoOwnerName(repoDir, _spawn)
    owner = r.owner
    name = r.name
    void owner; void name // used only to ensure repo is valid
  } catch {
    return
  }

  for (const threadId of threadIds) {
    const gqlBody = JSON.stringify({
      query: RESOLVE_MUTATION,
      variables: { threadId },
    })
    const proc = _spawn(
      ["gh", "api", "graphql", "--input", "-"],
      { stdout: "pipe", stderr: "pipe", stdin: Buffer.from(gqlBody) },
    )
    await proc.exited
    // Best-effort: don't throw if one resolve fails
  }
}

export async function checkAuth(_spawn: typeof Bun.spawn = Bun.spawn): Promise<boolean> {
  const proc = _spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" })
  await proc.exited
  return proc.exitCode === 0
}

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

export function buildReviewPayload(
  review: Review,
  options?: { includeOutdated?: boolean },
): GitHubReviewPayload {
  const includeOutdated = options?.includeOutdated ?? false
  const filteredComments = review.comments.filter((c) => {
    if (c.resolved === true) return false
    if (c.github_id !== undefined) return false // imported GitHub comments go as resolves, not new comments
    if (!includeOutdated && c.is_outdated === true) return false
    return true
  })
  const payload: GitHubReviewPayload = {
    commit_id: review.commit_id,
    event: review.event ?? "COMMENT",
    comments: filteredComments.map(toGitHubComment),
  }
  if (review.body !== undefined) payload.body = review.body
  return payload
}

export async function pushReview(
  repoDir: string,
  prNumber: number,
  payload: GitHubReviewPayload,
  _spawn: typeof Bun.spawn = Bun.spawn,
): Promise<void> {
  const { owner, name: repo } = await getRepoOwnerName(repoDir, _spawn)
  const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`
  const body = JSON.stringify(payload)
  const apiProc = _spawn(
    ["gh", "api", "--method", "POST", endpoint, "--input", "-"],
    { stdout: "pipe", stderr: "pipe", stdin: Buffer.from(body) },
  )
  await apiProc.exited
  if (apiProc.exitCode !== 0) {
    const err = await (apiProc.stderr as { text(): Promise<string> }).text()
    throw new Error(`gh api failed (exit ${apiProc.exitCode}): ${err}`)
  }
}

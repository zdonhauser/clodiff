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
  is_draft: boolean
  baseRefName: string
  headRefName: string
  headSha: string
  viewer_login: string
  checks_status: PRMeta["checks_status"]
}

// The authenticated gh user's login — used to tell "your own PR" from others'.
export async function getViewerLogin(
  repoDir: string,
  _spawn: typeof Bun.spawn = Bun.spawn,
): Promise<string> {
  try {
    const proc = _spawn(["gh", "api", "user", "--jq", ".login"], {
      stdout: "pipe", stderr: "pipe", cwd: repoDir,
    })
    await proc.exited
    if (proc.exitCode !== 0) return ""
    const text = await (proc.stdout as { text(): Promise<string> }).text()
    return text.trim()
  } catch {
    return ""
  }
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
  const fields = "number,title,author,body,state,isDraft,baseRefName,headRefName,headRefOid,statusCheckRollup"
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
      isDraft: boolean
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
      is_draft: d.isDraft ?? false,
      baseRefName: d.baseRefName,
      headRefName: d.headRefName,
      headSha: d.headRefOid,
      viewer_login: await getViewerLogin(repoDir, _spawn),
      checks_status: deriveChecksStatus(d.statusCheckRollup ?? []),
    }
  } catch {
    return null
  }
}

// Thread structure + resolve state come from GraphQL (REST doesn't expose them);
// per-comment side/range/author/reply-links come from REST (GraphQL has no `side`).
const PR_THREADS_QUERY = `
query GetPRThreads($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 100) {
            nodes { fullDatabaseId outdated }
          }
        }
      }
    }
  }
}`.trim()

// One review comment as returned by the REST pulls/{n}/comments endpoint.
interface RestReviewComment {
  id: number
  user: { login: string } | null
  body: string
  path: string
  line: number | null
  original_line: number | null
  start_line: number | null
  start_side: "LEFT" | "RIGHT" | null
  side: "LEFT" | "RIGHT" | null
  subject_type?: "line" | "file"
  in_reply_to_id?: number
  created_at: string
}

async function ghJson<T>(
  repoDir: string,
  endpoint: string,
  _spawn: typeof Bun.spawn,
): Promise<T | null> {
  const proc = _spawn(["gh", "api", endpoint], {
    stdout: "pipe", stderr: "pipe", cwd: repoDir,
  })
  await proc.exited
  if (proc.exitCode !== 0) return null
  try {
    return JSON.parse(await (proc.stdout as { text(): Promise<string> }).text()) as T
  } catch {
    return null
  }
}

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

  // 1. REST comments — full per-comment detail (side, ranges, author, reply links)
  const rest = await ghJson<RestReviewComment[]>(
    repoDir, `/repos/${owner}/${name}/pulls/${prNumber}/comments?per_page=100`, _spawn,
  )
  if (!Array.isArray(rest) || rest.length === 0) return []

  // 2. GraphQL threads — map each comment's databaseId to its thread + resolve state
  const gqlBody = JSON.stringify({
    query: PR_THREADS_QUERY,
    variables: { owner, repo: name, number: prNumber },
  })
  const gproc = _spawn(
    ["gh", "api", "graphql", "--input", "-"],
    { stdout: "pipe", stderr: "pipe", stdin: Buffer.from(gqlBody) },
  )
  await gproc.exited
  const threadOf = new Map<number, { threadId: string; resolved: boolean; outdated: boolean }>()
  if (gproc.exitCode === 0) {
    try {
      const resp = JSON.parse(await (gproc.stdout as { text(): Promise<string> }).text()) as {
        data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: Array<{
          id: string; isResolved: boolean
          comments: { nodes: Array<{ fullDatabaseId: string | null; outdated: boolean }> }
        }> } } } }
      }
      for (const t of resp?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []) {
        for (const c of t.comments.nodes) {
          if (c.fullDatabaseId == null) continue
          threadOf.set(Number(c.fullDatabaseId), { threadId: t.id, resolved: t.isResolved, outdated: c.outdated })
        }
      }
    } catch { /* fall back to no thread/resolve info */ }
  }

  // 3. Group REST comments into threads by in_reply_to chains; map to ReviewComment.
  const byId = new Map<number, RestReviewComment>(rest.map((c) => [c.id, c]))
  const rootOf = (c: RestReviewComment): RestReviewComment => {
    let cur = c
    const seen = new Set<number>()
    while (cur.in_reply_to_id != null && byId.has(cur.in_reply_to_id) && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = byId.get(cur.in_reply_to_id)!
    }
    return cur
  }

  const toComment = (c: RestReviewComment): ReviewComment => {
    const meta = threadOf.get(c.id)
    const rc: ReviewComment = {
      id: crypto.randomUUID(),
      created_at: c.created_at,
      source: "user",
      author: c.user?.login ?? "unknown",
      body: c.body,
      path: c.path,
      commit_id: headSha,
      line: c.line ?? c.original_line ?? 1,
      side: c.side ?? "RIGHT",
      resolved: meta?.resolved ?? false,
      is_outdated: meta?.outdated ?? (c.line == null && c.original_line != null),
      github_id: c.id,
    }
    if (c.start_line != null) rc.start_line = c.start_line
    if (c.start_side != null) rc.start_side = c.start_side
    if (meta?.threadId) rc.github_thread_id = meta.threadId
    return rc
  }

  const roots: ReviewComment[] = []
  const repliesByRoot = new Map<number, ReviewComment[]>()
  for (const c of rest) {
    const root = rootOf(c)
    if (root.id === c.id) {
      roots.push(toComment(c))
    } else {
      const list = repliesByRoot.get(root.id) ?? []
      list.push(toComment(c))
      repliesByRoot.set(root.id, list)
    }
  }
  for (const root of roots) {
    const replies = repliesByRoot.get(root.github_id!)
    if (replies && replies.length) root.replies = replies
  }
  return roots
}

// Top-level PR comments (issue comments) and review summary bodies — the
// conversation that isn't pinned to a diff line.
export async function fetchPRConversation(
  repoDir: string,
  prNumber: number,
  _spawn: typeof Bun.spawn = Bun.spawn,
): Promise<import("./session").ConversationComment[]> {
  let owner: string, name: string
  try {
    const r = await getRepoOwnerName(repoDir, _spawn)
    owner = r.owner
    name = r.name
  } catch {
    return []
  }

  const out: import("./session").ConversationComment[] = []

  // Issue comments = the top-level PR conversation
  const issueComments = await ghJson<Array<{
    id: number; user: { login: string } | null; body: string; created_at: string
  }>>(repoDir, `/repos/${owner}/${name}/issues/${prNumber}/comments?per_page=100`, _spawn)
  for (const c of issueComments ?? []) {
    if (!c.body?.trim()) continue
    out.push({
      id: crypto.randomUUID(),
      author: c.user?.login ?? "unknown",
      body: c.body,
      created_at: c.created_at,
      kind: "comment",
      github_id: c.id,
    })
  }

  // Reviews with a summary body (the "LGTM, but…" + decision)
  const reviews = await ghJson<Array<{
    id: number; user: { login: string } | null; body: string; state: string; submitted_at: string
  }>>(repoDir, `/repos/${owner}/${name}/pulls/${prNumber}/reviews?per_page=100`, _spawn)
  for (const r of reviews ?? []) {
    if (!r.body?.trim()) continue
    const stateMap: Record<string, import("./session").ConversationComment["state"]> = {
      APPROVED: "APPROVED", CHANGES_REQUESTED: "CHANGES_REQUESTED",
      COMMENTED: "COMMENTED", DISMISSED: "DISMISSED",
    }
    out.push({
      id: crypto.randomUUID(),
      author: r.user?.login ?? "unknown",
      body: r.body,
      created_at: r.submitted_at,
      kind: "review_summary",
      state: stateMap[r.state] ?? "COMMENTED",
      github_id: r.id,
    })
  }

  out.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return out
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

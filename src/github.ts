import type { Review, ReviewComment, PRMeta } from "./session.ts"
import { spawn as cpSpawn } from "child_process"

// Minimal spawn interface the GitHub helpers rely on (a subset of what Bun.spawn
// exposed). Injectable for tests; defaults to a Node child_process adapter.
export interface SpawnedProc {
  exited: Promise<number>
  exitCode: number
  stdout: { text(): Promise<string> }
  stderr: { text(): Promise<string> }
}
export type SpawnFn = (
  argv: string[],
  opts?: { stdout?: string; stderr?: string; cwd?: string; stdin?: Buffer },
) => SpawnedProc

export const nodeSpawn: SpawnFn = (argv, opts = {}) => {
  const child = cpSpawn(argv[0], argv.slice(1), { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] })
  if (opts.stdin) child.stdin?.end(opts.stdin)
  else child.stdin?.end()
  const collect = (stream: NodeJS.ReadableStream | null): Promise<string> =>
    new Promise((resolve) => {
      if (!stream) return resolve("")
      let data = ""
      stream.on("data", (c) => { data += c })
      stream.on("end", () => resolve(data))
      stream.on("error", () => resolve(data))
    })
  const outP = collect(child.stdout)
  const errP = collect(child.stderr)
  let exitCode = 0
  const exited = new Promise<number>((resolve) => {
    child.on("close", (code) => { exitCode = code ?? 0; resolve(exitCode) })
    child.on("error", () => { exitCode = 1; resolve(1) })
  })
  return {
    exited,
    get exitCode() { return exitCode },
    stdout: { text: () => outP },
    stderr: { text: () => errP },
  }
}

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
  _spawn: SpawnFn = nodeSpawn,
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
  _spawn: SpawnFn,
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
  _spawn: SpawnFn = nodeSpawn,
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
query GetPRThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
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
  diff_hunk?: string
  created_at: string
}

// Fetch ALL pages of a list endpoint via `gh --paginate --slurp` (no 100-item
// cap). --slurp returns an array of pages; flat() merges them. flat() also
// tolerates a plain single-page array, which keeps the mocks simple.
async function ghPaginated<T>(
  repoDir: string,
  endpoint: string,
  _spawn: SpawnFn,
): Promise<T[]> {
  const proc = _spawn(["gh", "api", "--paginate", "--slurp", endpoint], {
    stdout: "pipe", stderr: "pipe", cwd: repoDir,
  })
  await proc.exited
  if (proc.exitCode !== 0) return []
  try {
    const pages = JSON.parse(await (proc.stdout as { text(): Promise<string> }).text())
    return (Array.isArray(pages) ? pages.flat() : []) as T[]
  } catch {
    return []
  }
}

export async function fetchPRThreads(
  repoDir: string,
  prNumber: number,
  headSha: string,
  _spawn: SpawnFn = nodeSpawn,
): Promise<ReviewComment[]> {
  let owner: string, name: string
  try {
    const r = await getRepoOwnerName(repoDir, _spawn)
    owner = r.owner
    name = r.name
  } catch {
    return []
  }

  // 1. REST comments — full per-comment detail (side, ranges, author, reply links).
  // Paginated so PRs with >100 review comments import completely.
  const rest = await ghPaginated<RestReviewComment>(
    repoDir, `/repos/${owner}/${name}/pulls/${prNumber}/comments?per_page=100`, _spawn,
  )
  if (rest.length === 0) return []

  // 2. GraphQL threads — map each comment's databaseId to its thread + resolve
  // state, paginating through every thread (>100 supported).
  type ReviewThreadsPage = {
    pageInfo?: { hasNextPage: boolean; endCursor: string | null }
    nodes?: Array<{
      id: string; isResolved: boolean
      comments: { nodes: Array<{ fullDatabaseId: string | null; outdated: boolean }> }
    }>
  }
  const threadOf = new Map<number, { threadId: string; resolved: boolean; outdated: boolean }>()
  let cursor: string | null = null
  for (let page = 0; page < 100; page++) {
    const gqlBody = JSON.stringify({
      query: PR_THREADS_QUERY,
      variables: { owner, repo: name, number: prNumber, cursor },
    })
    const gproc = _spawn(
      ["gh", "api", "graphql", "--input", "-"],
      { stdout: "pipe", stderr: "pipe", stdin: Buffer.from(gqlBody) },
    )
    await gproc.exited
    if (gproc.exitCode !== 0) break
    let rt: ReviewThreadsPage | undefined
    try {
      const resp = JSON.parse(await (gproc.stdout as { text(): Promise<string> }).text()) as {
        data?: { repository?: { pullRequest?: { reviewThreads?: ReviewThreadsPage } } }
      }
      rt = resp?.data?.repository?.pullRequest?.reviewThreads
    } catch { break }
    for (const t of rt?.nodes ?? []) {
      for (const c of t.comments.nodes) {
        if (c.fullDatabaseId == null) continue
        threadOf.set(Number(c.fullDatabaseId), { threadId: t.id, resolved: t.isResolved, outdated: c.outdated })
      }
    }
    if (!rt?.pageInfo?.hasNextPage) break
    cursor = rt.pageInfo.endCursor
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
    if (c.original_line != null) rc.original_line = c.original_line
    if (c.diff_hunk) rc.diff_hunk = c.diff_hunk
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
  _spawn: SpawnFn = nodeSpawn,
): Promise<import("./session.ts").ConversationComment[]> {
  let owner: string, name: string
  try {
    const r = await getRepoOwnerName(repoDir, _spawn)
    owner = r.owner
    name = r.name
  } catch {
    return []
  }

  const out: import("./session.ts").ConversationComment[] = []

  // Issue comments = the top-level PR conversation (all pages)
  const issueComments = await ghPaginated<{
    id: number; user: { login: string } | null; body: string; created_at: string
  }>(repoDir, `/repos/${owner}/${name}/issues/${prNumber}/comments?per_page=100`, _spawn)
  for (const c of issueComments) {
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

  // Reviews with a summary body (the "LGTM, but…" + decision) — all pages
  const reviews = await ghPaginated<{
    id: number; user: { login: string } | null; body: string; state: string; submitted_at: string
  }>(repoDir, `/repos/${owner}/${name}/pulls/${prNumber}/reviews?per_page=100`, _spawn)
  for (const r of reviews) {
    if (!r.body?.trim()) continue
    const stateMap: Record<string, import("./session.ts").ConversationComment["state"]> = {
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

  // Newest first.
  out.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
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
  _spawn: SpawnFn = nodeSpawn,
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

export async function checkAuth(_spawn: SpawnFn = nodeSpawn): Promise<boolean> {
  const proc = _spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" })
  await proc.exited
  return proc.exitCode === 0
}

export async function findOpenPR(
  repoDir: string,
  _spawn: SpawnFn = nodeSpawn,
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
  _spawn: SpawnFn = nodeSpawn,
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

// Post threaded replies to existing review comments. The reviews endpoint can't
// thread, so each reply goes to /pulls/{n}/comments with in_reply_to. Best-effort
// per reply; returns the count posted.
export async function postThreadReplies(
  repoDir: string,
  prNumber: number,
  replies: Array<{ in_reply_to: number; body: string }>,
  _spawn: SpawnFn = nodeSpawn,
): Promise<number> {
  if (!replies || replies.length === 0) return 0
  let owner: string, repo: string
  try {
    const r = await getRepoOwnerName(repoDir, _spawn)
    owner = r.owner
    repo = r.name
  } catch {
    return 0
  }
  const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}/comments`
  let posted = 0
  for (const reply of replies) {
    const body = JSON.stringify({ body: reply.body, in_reply_to: reply.in_reply_to })
    const proc = _spawn(
      ["gh", "api", "--method", "POST", endpoint, "--input", "-"],
      { stdout: "pipe", stderr: "pipe", stdin: Buffer.from(body) },
    )
    await proc.exited
    if (proc.exitCode === 0) posted++
  }
  return posted
}

// Re-request review from the given logins (the reviewers who left comments).
// Used when triaging your own PR — "I've addressed everything, please look again".
// Returns the number of reviewers re-requested (0 on failure).
export async function requestReReview(
  repoDir: string,
  prNumber: number,
  reviewers: string[],
  _spawn: SpawnFn = nodeSpawn,
): Promise<number> {
  if (!reviewers || reviewers.length === 0) return 0
  let owner: string, repo: string
  try {
    const r = await getRepoOwnerName(repoDir, _spawn)
    owner = r.owner
    repo = r.name
  } catch {
    return 0
  }
  const payload = JSON.stringify({ reviewers })
  const proc = _spawn(
    ["gh", "api", "--method", "POST", `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`, "--input", "-"],
    { stdout: "pipe", stderr: "pipe", stdin: Buffer.from(payload) },
  )
  await proc.exited
  return proc.exitCode === 0 ? reviewers.length : 0
}

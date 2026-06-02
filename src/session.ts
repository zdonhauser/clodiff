import { readFile, writeFile, mkdir, access, unlink } from "fs/promises"
import { join } from "path"
import { spawnSync } from "child_process"
import { tmpdir } from "os"
import { createHash } from "crypto"

export interface ReviewComment {
  // Local only
  id: string
  created_at: string
  source: "claude-code" | "user"
  severity?: "error" | "warning" | "suggestion" | "note"
  resolved?: boolean
  replies?: ReviewComment[]
  line_content?: string
  original_line?: number
  is_outdated?: boolean

  // GitHub import fields (set when comment was fetched from GitHub)
  author?: string          // GitHub login of the commenter (imported comments only)
  diff_hunk?: string       // the unified-diff context the comment was made on (for outdated comments)
  github_id?: number       // REST API databaseId — used to deduplicate imports
  github_thread_id?: string // GraphQL PRRT_xxx node ID — used for staged resolves

  // GitHub API fields
  body: string
  path: string
  commit_id: string
  line: number
  side: "LEFT" | "RIGHT"
  start_line?: number
  start_side?: "LEFT" | "RIGHT"
  in_reply_to_id?: number
}

export interface Review {
  id: string
  commit_id: string
  body?: string
  event?: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
  comments: ReviewComment[]
  created_at: string
}

// A PR-level (not line-anchored) comment: either a top-level conversation
// comment or a review summary body with its decision.
export interface ConversationComment {
  id: string
  author: string
  body: string
  created_at: string
  kind: "comment" | "review_summary"
  state?: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED"
  github_id?: number
}

export interface PRMeta {
  number: number
  title: string
  author: string
  body?: string
  state?: "OPEN" | "CLOSED" | "MERGED"
  is_draft?: boolean
  viewer_login?: string      // the authenticated gh user
  viewer_is_author?: boolean // true when you're triaging your own PR
  checks_status?: "success" | "failure" | "pending" | "neutral"
}

export interface SessionFile {
  version: 1
  repo: string
  base_branch: string
  head_commit: string
  current_commit: string
  pr_number?: number
  pr_meta?: PRMeta
  pending_resolves?: string[] // github_thread_ids to resolve on next submit
  pending_replies?: Array<{ in_reply_to: number; body: string }> // threaded replies to post on submit
  reviews: Review[]
  created_at: string
  updated_at: string
  port?: number
  pid?: number // PID of the running clodiff daemon (for --stop)
}

export interface ReplyEntry {
  id: string
  comment_id: string
  body: string
  created_at: string
}

// clodiff stores its session under the repo's git dir (`<git-dir>/clodiff/`)
// rather than a tracked `.review/` folder: git never tracks anything inside the
// git dir, so it's invisible to status/diff and needs no .gitignore entry. Using
// `--absolute-git-dir` (not `--git-common-dir`) gives the PER-WORKTREE dir, so
// each worktree gets its own isolated session. Falls back to a temp dir keyed by
// the repo path when not in a git repo (e.g. --stdin/--patch on a plain folder).
const reviewDirCache = new Map<string, string>()
export function reviewDir(repoDir: string): string {
  const cached = reviewDirCache.get(repoDir)
  if (cached) return cached
  let dir: string
  const res = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repoDir, encoding: "utf-8" })
  const gitDir = res.status === 0 ? (res.stdout || "").trim() : ""
  if (gitDir) {
    dir = join(gitDir, "clodiff")
  } else {
    const hash = createHash("sha1").update(repoDir).digest("hex").slice(0, 12)
    dir = join(tmpdir(), "clodiff", hash)
  }
  reviewDirCache.set(repoDir, dir)
  return dir
}

function sessionPath(repoDir: string): string {
  return join(reviewDir(repoDir), "session.json")
}

function repliesPath(repoDir: string): string {
  return join(reviewDir(repoDir), "replies.json")
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

// Load session from a given directory's .review/session.json
// Returns null if file doesn't exist
export async function loadSession(repoDir: string): Promise<SessionFile | null> {
  const path = sessionPath(repoDir)
  if (!(await fileExists(path))) {
    return null
  }
  const raw = await readFile(path, "utf-8")
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`session.json is corrupted (invalid JSON). Delete ${path} and rerun clodiff.`)
  }
  if (data.version !== 1) {
    throw new Error("Unsupported session version: " + data.version)
  }
  return data as SessionFile
}

// Save session to the repo's clodiff dir (see reviewDir). No .gitignore needed —
// the git dir is never tracked.
export async function saveSession(repoDir: string, session: SessionFile): Promise<void> {
  const dir = reviewDir(repoDir)
  await mkdir(dir, { recursive: true })
  session.updated_at = new Date().toISOString()
  await writeFile(sessionPath(repoDir), JSON.stringify(session, null, 2))
}

// Load replies from repoDir/.review/replies.json
// Returns empty array if file doesn't exist
export async function loadReplies(repoDir: string): Promise<ReplyEntry[]> {
  const path = repliesPath(repoDir)
  if (!(await fileExists(path))) {
    return []
  }
  const raw = await readFile(path, "utf-8")
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) {
    throw new Error("Invalid replies.json: expected array")
  }
  return data as ReplyEntry[]
}

// Delete repoDir/.review/replies.json
// Does not throw if file doesn't exist
export async function clearReplies(repoDir: string): Promise<void> {
  const path = repliesPath(repoDir)
  try {
    await unlink(path)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
  }
}

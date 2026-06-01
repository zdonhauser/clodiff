import { join } from "path"
import path from "path"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { watch, mkdirSync } from "fs"
import { readFile } from "fs/promises"
import { createServer } from "http"
import type { IncomingMessage, ServerResponse, Server } from "http"
import { WebSocketServer, type WebSocket } from "ws"
import type { SessionFile, ReplyEntry } from "./session.ts"
import { reviewDir } from "./session.ts"

// ── Node bridge: translate between Node's http req/res and the web-standard
// Request/Response the route handlers are written against. ───────────────────
async function toWebRequest(nodeReq: IncomingMessage): Promise<Request> {
  const method = nodeReq.method || "GET"
  const headers = new Headers()
  for (const [k, v] of Object.entries(nodeReq.headers)) {
    if (Array.isArray(v)) v.forEach((val) => headers.append(k, val))
    else if (v != null) headers.set(k, v)
  }
  let body: Buffer | undefined
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = []
    for await (const c of nodeReq) chunks.push(c as Buffer)
    body = Buffer.concat(chunks)
  }
  return new Request(`http://localhost${nodeReq.url || "/"}`, {
    method, headers, body: body && body.length ? body : undefined,
  })
}

async function writeWebResponse(res: Response, nodeRes: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => { headers[k] = v })
  nodeRes.writeHead(res.status, headers)
  nodeRes.end(Buffer.from(await res.arrayBuffer()))
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  svg: "image/svg+xml", map: "application/json",
}
async function fileResponse(filePath: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const buf = await readFile(filePath)
  const ext = filePath.split(".").pop() || ""
  return new Response(buf, {
    headers: { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream", ...extraHeaders },
  })
}

function listenWithRetry(server: Server, startPort: number, maxAttempts: number): Promise<number> {
  // Single persistent handlers (don't re-register per attempt, or stale
  // "listening" callbacks from failed binds resolve with the wrong port), and
  // resolve with the actual bound port from server.address().
  return new Promise((resolve, reject) => {
    let attempt = 0
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && attempt < maxAttempts - 1) { attempt++; server.listen(startPort + attempt) }
      else reject(err)
    }
    server.on("error", onError)
    server.once("listening", () => {
      server.removeListener("error", onError)
      const addr = server.address()
      resolve(addr && typeof addr === "object" ? addr.port : startPort + attempt)
    })
    server.listen(startPort)
  })
}

export interface RefEntry {
  name: string
  sha: string
  subject: string
  date: string
}

export interface ServerOptions {
  port: number
  repoDir: string
  viewerDir: string
  getInitPayload?: () => unknown | Promise<unknown>
  getRefs?: () => Promise<RefEntry[]>
  onRediff?: (from: string, to: string) => Promise<unknown>
}

export interface StartServerResult {
  // (server is a Node http.Server; call .close() to stop)
  port: number
  server: Server
}

export async function startServer(options: ServerOptions): Promise<StartServerResult> {
  const { repoDir, viewerDir, getInitPayload, getRefs, onRediff } = options
  const wsClients = new Set<WebSocket>()

  // Route handler — written against web-standard Request/Response. The Node http
  // server below bridges to it. WebSocket upgrades are handled separately (the
  // http "upgrade" event), so there's no /ws branch here.
  async function handleRequest(req: Request): Promise<Response> {
    try {
          const url = new URL(req.url)

          // Broadcast endpoint
          if (url.pathname === "/_ws_broadcast" && req.method === "POST") {
            return req.text().then((body) => {
              try {
                const parsed = JSON.parse(body)
                for (const client of wsClients) {
                  client.send(JSON.stringify(parsed))
                }
                return new Response("OK", { status: 200 })
              } catch {
                return new Response("Invalid JSON", { status: 400 })
              }
            })
          }

          // GET /init — return current init payload (full diff + session state)
          if (url.pathname === "/init" && req.method === "GET") {
            if (!getInitPayload) {
              return new Response("No init payload available", { status: 404 })
            }
            try {
              const payload = await Promise.resolve(getInitPayload())
              return new Response(JSON.stringify(payload), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            } catch {
              return new Response("Internal Server Error", { status: 500 })
            }
          }

          // GET /session — return current session.json
          if (url.pathname === "/session" && req.method === "GET") {
            const sessionPath = join(reviewDir(repoDir), "session.json")
            if (!existsSync(sessionPath)) {
              return new Response("Not Found", { status: 404 })
            }
            try {
              const raw = readFileSync(sessionPath, "utf-8")
              return new Response(raw, {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            } catch {
              return new Response("Internal Server Error", { status: 500 })
            }
          }

          // POST /reply — append a reply to session.json + replies.json (user only)
          // Accepts optional source: "user" | "claude-code" (default "user")
          if (url.pathname === "/reply" && req.method === "POST") {
            return req.json().then((body: { comment_id: string; body: string; source?: string; severity?: string }) => {
              try {
                const source = body.source === "claude-code" ? "claude-code" : "user"
                const replyId = crypto.randomUUID()
                const replyCreatedAt = new Date().toISOString()

                // Persist reply into session.json so the viewer renders it
                const sessionFilePath = join(reviewDir(repoDir), "session.json")
                if (existsSync(sessionFilePath)) {
                  const sessionRaw = readFileSync(sessionFilePath, "utf-8")
                  const session = JSON.parse(sessionRaw) as SessionFile
                  for (const review of session.reviews || []) {
                    const parent = (review.comments || []).find((c) => c.id === body.comment_id)
                    if (parent) {
                      if (!parent.replies) parent.replies = []
                      parent.replies.push({
                        id: replyId,
                        created_at: replyCreatedAt,
                        source: source as "claude-code" | "user",
                        body: body.body,
                        severity: (body.severity as "error" | "warning" | "suggestion" | "note") || undefined,
                        path: parent.path,
                        commit_id: parent.commit_id,
                        line: parent.line,
                        side: parent.side,
                      })
                      // Replying to an imported GitHub thread → stage a threaded
                      // reply to post on submit (the parent's github_id is the
                      // REST comment id that in_reply_to expects).
                      if (parent.github_id !== undefined) {
                        if (!session.pending_replies) session.pending_replies = []
                        session.pending_replies.push({ in_reply_to: parent.github_id, body: body.body })
                      }
                      session.updated_at = replyCreatedAt
                      writeFileSync(sessionFilePath, JSON.stringify(session, null, 2))
                      for (const client of wsClients) {
                        try { client.send(JSON.stringify({ type: "session_update" })) } catch { /* disconnected */ }
                      }
                      break
                    }
                  }
                }

                // Write to replies.json for monitor (user replies only — Claude doesn't need its own replies)
                if (source === "user") {
                  const repliesFilePath = join(reviewDir(repoDir), "replies.json")
                  let replies: ReplyEntry[] = []
                  if (existsSync(repliesFilePath)) {
                    const raw = readFileSync(repliesFilePath, "utf-8")
                    replies = JSON.parse(raw) as ReplyEntry[]
                  }
                  replies.push({ id: replyId, comment_id: body.comment_id, body: body.body, created_at: replyCreatedAt })
                  writeFileSync(repliesFilePath, JSON.stringify(replies, null, 2))
                }

                return new Response(JSON.stringify({ id: replyId, comment_id: body.comment_id }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                })
              } catch {
                return new Response("Internal Server Error", { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }

          // POST /review/body — set the review body text (summary comment)
          if (url.pathname === "/review/body" && req.method === "POST") {
            return req.json().then((body: { body: string }) => {
              try {
                const sessionFilePath = join(reviewDir(repoDir), "session.json")
                if (!existsSync(sessionFilePath)) return new Response("Not Found", { status: 404 })
                const raw = readFileSync(sessionFilePath, "utf-8")
                const session = JSON.parse(raw) as SessionFile
                if (!session.reviews || session.reviews.length === 0) {
                  return new Response("No reviews in session", { status: 400 })
                }
                const review = session.reviews[session.reviews.length - 1]
                if (body.body && body.body.trim()) {
                  review.body = body.body
                } else {
                  delete review.body
                }
                session.updated_at = new Date().toISOString()
                writeFileSync(sessionFilePath, JSON.stringify(session, null, 2))
                for (const client of wsClients) {
                  try { client.send(JSON.stringify({ type: "session_update" })) } catch { /* disconnected */ }
                }
                return new Response("OK", { status: 200 })
              } catch {
                return new Response("Internal Server Error", { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }

          // POST /edit-comment — update a comment's body in session.json
          if (url.pathname === "/edit-comment" && req.method === "POST") {
            return req.json().then((body: { comment_id: string; body: string }) => {
              try {
                if (!body.comment_id) return new Response("comment_id required", { status: 400 })
                const sessionFilePath = join(reviewDir(repoDir), "session.json")
                if (!existsSync(sessionFilePath)) return new Response("Not Found", { status: 404 })
                const raw = readFileSync(sessionFilePath, "utf-8")
                const session = JSON.parse(raw) as SessionFile
                let found = false
                for (const review of session.reviews || []) {
                  for (const comment of review.comments || []) {
                    if (comment.id === body.comment_id) {
                      comment.body = body.body
                      found = true
                    }
                  }
                }
                if (!found) return new Response("Comment not found", { status: 404 })
                session.updated_at = new Date().toISOString()
                writeFileSync(sessionFilePath, JSON.stringify(session, null, 2))
                for (const client of wsClients) {
                  try { client.send(JSON.stringify({ type: "session_update" })) } catch { /* disconnected */ }
                }
                return new Response("OK", { status: 200 })
              } catch {
                return new Response("Internal Server Error", { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }

          // POST /resolve — mark a comment as resolved; stage thread resolve for GitHub
          if (url.pathname === "/resolve" && req.method === "POST") {
            return req.json().then((body: { comment_id: string }) => {
              try {
                if (!body.comment_id) return new Response("comment_id required", { status: 400 })
                const sessionPath = join(reviewDir(repoDir), "session.json")
                if (!existsSync(sessionPath)) return new Response("Not Found", { status: 404 })
                const raw = readFileSync(sessionPath, "utf-8")
                const session = JSON.parse(raw) as SessionFile
                let found = false
                let resolvedComment: import("./session.ts").ReviewComment | undefined
                for (const review of session.reviews || []) {
                  for (const comment of review.comments || []) {
                    if (comment.id === body.comment_id) {
                      comment.resolved = true
                      resolvedComment = comment
                      found = true
                    }
                  }
                }
                if (!found) return new Response("Comment not found", { status: 404 })
                // Stage GitHub thread resolve for submission
                if (resolvedComment?.github_thread_id) {
                  if (!session.pending_resolves) session.pending_resolves = []
                  if (!session.pending_resolves.includes(resolvedComment.github_thread_id)) {
                    session.pending_resolves.push(resolvedComment.github_thread_id)
                  }
                }
                session.updated_at = new Date().toISOString()
                writeFileSync(sessionPath, JSON.stringify(session, null, 2))
                for (const client of wsClients) {
                  try { client.send(JSON.stringify({ type: "session_update" })) } catch { /* disconnected */ }
                }
                return new Response("OK", { status: 200 })
              } catch {
                return new Response("Internal Server Error", { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }

          // POST /action — record Fix It / Reject decision for the monitor without creating a visible reply
          // Resolves the comment and writes to replies.json so the monitor can act, but does NOT
          // append anything to session.json's visible comment thread.
          if (url.pathname === "/action" && req.method === "POST") {
            return req.json().then((body: { comment_id: string; action: "fix" | "reject" }) => {
              try {
                if (!body.comment_id) return new Response("comment_id required", { status: 400 })
                const sessionFilePath = join(reviewDir(repoDir), "session.json")
                if (!existsSync(sessionFilePath)) return new Response("Not Found", { status: 404 })
                const raw = readFileSync(sessionFilePath, "utf-8")
                const session = JSON.parse(raw) as SessionFile
                let found = false
                let resolvedComment: import("./session.ts").ReviewComment | undefined
                for (const review of session.reviews || []) {
                  for (const comment of review.comments || []) {
                    if (comment.id === body.comment_id) {
                      comment.resolved = true
                      resolvedComment = comment
                      found = true
                    }
                  }
                }
                if (!found) return new Response("Comment not found", { status: 404 })
                if (resolvedComment?.github_thread_id) {
                  if (!session.pending_resolves) session.pending_resolves = []
                  if (!session.pending_resolves.includes(resolvedComment.github_thread_id)) {
                    session.pending_resolves.push(resolvedComment.github_thread_id)
                  }
                }
                session.updated_at = new Date().toISOString()
                writeFileSync(sessionFilePath, JSON.stringify(session, null, 2))
                for (const client of wsClients) {
                  try { client.send(JSON.stringify({ type: "session_update" })) } catch { /* disconnected */ }
                }
                // Notify monitor via replies.json without touching session comments
                const repliesFilePath = join(reviewDir(repoDir), "replies.json")
                let replies: ReplyEntry[] = []
                if (existsSync(repliesFilePath)) {
                  const r = readFileSync(repliesFilePath, "utf-8")
                  replies = JSON.parse(r) as ReplyEntry[]
                }
                replies.push({
                  id: crypto.randomUUID(),
                  comment_id: body.comment_id,
                  body: body.action === "fix" ? "Fix It" : "Rejected",
                  created_at: new Date().toISOString(),
                })
                writeFileSync(repliesFilePath, JSON.stringify(replies, null, 2))
                return new Response("OK", { status: 200 })
              } catch {
                return new Response("Internal Server Error", { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }

          // POST /review/event — set the event (APPROVE / REQUEST_CHANGES / COMMENT) on the current review
          if (url.pathname === "/review/event" && req.method === "POST") {
            return req.json().then((body: { event: string }) => {
              try {
                const sessionPath = join(reviewDir(repoDir), "session.json")
                if (!existsSync(sessionPath)) return new Response("Not Found", { status: 404 })
                const raw = readFileSync(sessionPath, "utf-8")
                const session = JSON.parse(raw) as SessionFile
                if (!session.reviews || session.reviews.length === 0) {
                  return new Response("No reviews in session", { status: 400 })
                }
                const validEvents = ["COMMENT", "APPROVE", "REQUEST_CHANGES"]
                if (!validEvents.includes(body.event)) {
                  return new Response(`Invalid event. Must be one of: ${validEvents.join(", ")}`, { status: 400 })
                }
                session.reviews[session.reviews.length - 1].event = body.event as "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
                session.updated_at = new Date().toISOString()
                writeFileSync(sessionPath, JSON.stringify(session, null, 2))
                return new Response("OK", { status: 200 })
              } catch {
                return new Response("Internal Server Error", { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }

          // POST /push — push annotations to GitHub as a PR review
          if (url.pathname === "/push" && req.method === "POST") {
            return (async () => {
              try {
                const sessionPath = join(reviewDir(repoDir), "session.json")
                if (!existsSync(sessionPath)) return new Response("No session found", { status: 404 })
                const raw = readFileSync(sessionPath, "utf-8")
                const session = JSON.parse(raw) as SessionFile
                const { checkAuth, findOpenPR, buildReviewPayload, pushReview } = await import("./github.ts")
                if (!await checkAuth()) return new Response("Not authenticated with GitHub", { status: 401 })
                const prNumber = session.pr_number ?? await findOpenPR(repoDir)
                if (!prNumber) return new Response("No open PR found", { status: 404 })
                if (!session.reviews || session.reviews.length === 0) {
                  return new Response("No annotations to push", { status: 400 })
                }
                const review = session.reviews[session.reviews.length - 1]
                await pushReview(repoDir, prNumber, buildReviewPayload(review))
                // Flush staged GitHub side-effects (best-effort, don't fail the push)
                const { resolveThreads, postThreadReplies } = await import("./github.ts")
                let mutated = false
                const pendingResolves = session.pending_resolves ?? []
                if (pendingResolves.length > 0) {
                  await resolveThreads(repoDir, pendingResolves).catch(() => {})
                  session.pending_resolves = []
                  mutated = true
                }
                const pendingReplies = session.pending_replies ?? []
                if (pendingReplies.length > 0) {
                  await postThreadReplies(repoDir, prNumber, pendingReplies).catch(() => {})
                  session.pending_replies = []
                  mutated = true
                }
                if (mutated) {
                  session.updated_at = new Date().toISOString()
                  writeFileSync(sessionPath, JSON.stringify(session, null, 2))
                }
                return new Response("OK", { status: 200 })
              } catch (err: unknown) {
                return new Response(err instanceof Error ? err.message : "Unknown error", { status: 500 })
              }
            })()
          }

          // POST /triage-submit — own-PR triage: flush staged replies + resolves
          // and optionally re-request review, WITHOUT submitting a review of your
          // own PR. (You can't review your own PR; this is the author-side flush.)
          if (url.pathname === "/triage-submit" && req.method === "POST") {
            return req.json().then(async (reqBody: { request_rereview?: boolean }) => {
              try {
                const sessionPath = join(reviewDir(repoDir), "session.json")
                if (!existsSync(sessionPath)) return new Response("No session found", { status: 404 })
                const session = JSON.parse(readFileSync(sessionPath, "utf-8")) as SessionFile
                const { checkAuth, postThreadReplies, resolveThreads, requestReReview } = await import("./github.ts")
                if (!await checkAuth()) return new Response("Not authenticated with GitHub", { status: 401 })
                const prNumber = session.pr_number
                if (!prNumber) return new Response("No open PR found", { status: 404 })

                const replies = session.pending_replies ?? []
                const resolves = session.pending_resolves ?? []
                const repliesPosted = await postThreadReplies(repoDir, prNumber, replies)
                if (resolves.length > 0) await resolveThreads(repoDir, resolves).catch(() => {})

                let reReviewed = 0
                if (reqBody.request_rereview) {
                  const viewer = session.pr_meta?.viewer_login
                  const logins = new Set<string>()
                  for (const r of session.reviews || []) for (const c of r.comments || []) {
                    if (c.author && c.author !== viewer) logins.add(c.author)
                  }
                  for (const c of session.pr_conversation || []) {
                    if (c.author && c.author !== viewer) logins.add(c.author)
                  }
                  reReviewed = await requestReReview(repoDir, prNumber, [...logins]).catch(() => 0)
                }

                session.pending_replies = []
                session.pending_resolves = []
                session.updated_at = new Date().toISOString()
                writeFileSync(sessionPath, JSON.stringify(session, null, 2))
                return new Response(
                  JSON.stringify({ repliesPosted, resolved: resolves.length, reReviewed }),
                  { status: 200, headers: { "Content-Type": "application/json" } },
                )
              } catch (err: unknown) {
                return new Response(err instanceof Error ? err.message : "Unknown error", { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }

          // GET /file — serve a file from repoDir (read-only)
          if (url.pathname === "/file" && req.method === "GET") {
            const filePath = url.searchParams.get("path")
            if (!filePath) return new Response("path required", { status: 400 })
            const abs = path.resolve(repoDir, filePath)
            if (!abs.startsWith(repoDir + path.sep) && abs !== repoDir) {
              return new Response("Forbidden", { status: 403 })
            }
            if (!existsSync(abs)) return new Response("Not Found", { status: 404 })
            try {
              return new Response(await readFile(abs), {
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              })
            } catch {
              return new Response("Internal Server Error", { status: 500 })
            }
          }

          // GET /tree — list all tracked files in repoDir
          if (url.pathname === "/tree" && req.method === "GET") {
            const { spawnSync } = await import("child_process")
            const result = spawnSync("git", ["ls-files"], { cwd: repoDir, encoding: "utf-8" })
            if (result.error) return new Response("git error", { status: 500 })
            const files = (result.stdout || "").trim().split("\n").filter(Boolean)
            return new Response(JSON.stringify(files), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          }

          // GET /refs — list local branches with commit info
          if (url.pathname === "/refs" && req.method === "GET") {
            if (!getRefs) {
              return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
            }
            try {
              const refs = await getRefs()
              return new Response(JSON.stringify(refs), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            } catch {
              return new Response("Internal Server Error", { status: 500 })
            }
          }

          // POST /rediff — re-run diff with new from/to refs
          if (url.pathname === "/rediff" && req.method === "POST") {
            return req.json().then(async (body: { from: string; to: string }) => {
              if (!onRediff) {
                return new Response("Rediff not supported", { status: 501 })
              }
              if (!body.from || !body.to) {
                return new Response("from and to are required", { status: 400 })
              }
              try {
                const payload = await onRediff(body.from, body.to)
                // Broadcast new init to all WS clients
                const msg = JSON.stringify(payload)
                for (const client of wsClients) {
                  try { client.send(msg) } catch { /* disconnected */ }
                }
                return new Response(JSON.stringify(payload), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                })
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : "Unknown error"
                return new Response(msg, { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }

          // Static file serving
          let filePath: string
          if (url.pathname === "/" || url.pathname === "") {
            filePath = join(viewerDir, "index.html")
          } else {
            // Strip leading slash and try to serve from viewerDir
            // Also handle /viewer/* paths by stripping the /viewer prefix
            let relativePath = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname

            // If path starts with "viewer/", strip that prefix since viewerDir already points to viewer/
            if (relativePath.startsWith("viewer/")) {
              relativePath = relativePath.slice("viewer/".length)
            }

            filePath = join(viewerDir, relativePath)
          }

          if (!filePath.startsWith(viewerDir + "/") && filePath !== path.join(viewerDir, "index.html")) {
            return new Response("Forbidden", { status: 403 })
          }

          if (existsSync(filePath)) {
            return fileResponse(filePath)
          }

          return new Response("Not Found", { status: 404 })
    } catch (err: unknown) {
      return new Response("Server error: " + (err instanceof Error ? err.message : "unknown"), { status: 500 })
    }
  }

  // WebSocket server (upgrade handled below). On connect, push the init payload.
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", (ws: WebSocket) => {
    wsClients.add(ws)
    if (getInitPayload) {
      Promise.resolve(getInitPayload())
        .then((payload) => ws.send(JSON.stringify(payload)))
        .catch(() => { /* don't crash on init payload errors */ })
    }
    ws.on("close", () => wsClients.delete(ws))
    ws.on("error", () => wsClients.delete(ws))
  })

  // Node http server bridging to the web-standard handleRequest.
  const server = createServer((nodeReq, nodeRes) => {
    toWebRequest(nodeReq)
      .then(handleRequest)
      .then((res) => writeWebResponse(res, nodeRes))
      .catch(() => { nodeRes.writeHead(500); nodeRes.end("Internal Server Error") })
  })
  server.on("upgrade", (nodeReq, socket, head) => {
    const url = new URL(nodeReq.url || "/", "http://localhost")
    if (url.pathname === "/ws") {
      wss.handleUpgrade(nodeReq, socket, head, (ws) => wss.emit("connection", ws, nodeReq))
    } else {
      socket.destroy()
    }
  })

  // Listen, auto-incrementing the port if taken.
  const port = await listenWithRetry(server, options.port, 10)

  const broadcast = (msg: unknown) => {
    const text = JSON.stringify(msg)
    for (const client of wsClients) {
      try { client.send(text) } catch { /* client may have disconnected */ }
    }
  }

  // Watch the clodiff session dir for session.json changes (annotations) and
  // broadcast to WS clients.
  const watchDir = reviewDir(repoDir)
  mkdirSync(watchDir, { recursive: true })
  watch(watchDir, { persistent: false }, (_event, filename) => {
    if (filename === "session.json") broadcast({ type: "session_update", timestamp: Date.now() })
  })

  // Hot reload: when the working tree (or HEAD/index) changes, recompute the diff
  // (getInitPayload re-runs it) and push a fresh init to the open viewer — so you
  // never need to relaunch clodiff to see new changes. Debounced; .git internals
  // and node_modules are ignored.
  let refreshTimer: NodeJS.Timeout | null = null
  const scheduleRefresh = () => {
    if (!getInitPayload) return
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(async () => {
      try { broadcast(await Promise.resolve(getInitPayload())) } catch { /* ignore transient diff errors */ }
    }, 400)
  }
  try {
    watch(repoDir, { persistent: false, recursive: true }, (_event, filename) => {
      if (!filename) return
      const f = filename.toString()
      if (f === ".git" || f.startsWith(".git/") || f.startsWith(".git" + path.sep) || f.includes("node_modules")) return
      scheduleRefresh()
    })
  } catch { /* recursive watch unsupported on this platform — skip working-tree hot reload */ }
  // Catch commits / staging / checkouts (HEAD & index live in the git dir).
  try {
    const gitDir = path.dirname(watchDir)
    watch(gitDir, { persistent: false }, (_event, filename) => {
      const f = (filename || "").toString()
      if (f === "HEAD" || f === "index" || f === "ORIG_HEAD") scheduleRefresh()
    })
  } catch { /* ignore */ }

  return { port, server }
}

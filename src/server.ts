import { join } from "path"
import path from "path"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { watch, mkdirSync } from "fs"
import type { SessionFile, ReplyEntry } from "./session"

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
  port: number
  server: ReturnType<typeof Bun.serve>
}

export async function startServer(options: ServerOptions): Promise<StartServerResult> {
  const { repoDir, viewerDir, getInitPayload, getRefs, onRediff } = options
  const wsClients = new Set<WebSocket>()

  // Try to start on the specified port, auto-increment if taken
  let port = options.port
  let server: ReturnType<typeof Bun.serve> | null = null
  const maxAttempts = 10

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const currentPort = port + attempt

      server = Bun.serve({
        port: currentPort,
        async fetch(req, server) {
          const url = new URL(req.url)

          // WebSocket upgrade
          if (url.pathname === "/ws") {
            const success = server.upgrade(req)
            if (success) return undefined
            return new Response("WebSocket upgrade failed", { status: 400 })
          }

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
            const sessionPath = join(repoDir, ".review", "session.json")
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

          // POST /reply — append a reply to replies.json
          if (url.pathname === "/reply" && req.method === "POST") {
            return req.json().then((body: { comment_id: string; body: string }) => {
              try {
                const repliesPath = join(repoDir, ".review", "replies.json")
                let replies: ReplyEntry[] = []
                if (existsSync(repliesPath)) {
                  const raw = readFileSync(repliesPath, "utf-8")
                  replies = JSON.parse(raw) as ReplyEntry[]
                }
                const entry: ReplyEntry = {
                  id: crypto.randomUUID(),
                  comment_id: body.comment_id,
                  body: body.body,
                  created_at: new Date().toISOString(),
                }
                replies.push(entry)
                writeFileSync(repliesPath, JSON.stringify(replies, null, 2))
                return new Response(JSON.stringify(entry), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                })
              } catch {
                return new Response("Internal Server Error", { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }

          // POST /resolve — mark a comment as resolved in session.json
          if (url.pathname === "/resolve" && req.method === "POST") {
            return req.json().then((body: { comment_id: string }) => {
              try {
                const sessionPath = join(repoDir, ".review", "session.json")
                if (!existsSync(sessionPath)) return new Response("Not Found", { status: 404 })
                const raw = readFileSync(sessionPath, "utf-8")
                const session = JSON.parse(raw) as SessionFile
                let found = false
                for (const review of session.reviews || []) {
                  for (const comment of review.comments || []) {
                    if (comment.id === body.comment_id) {
                      comment.resolved = true
                      found = true
                    }
                  }
                }
                if (!found) return new Response("Comment not found", { status: 404 })
                session.updated_at = new Date().toISOString()
                writeFileSync(sessionPath, JSON.stringify(session, null, 2))
                for (const client of wsClients) {
                  client.send(JSON.stringify({ type: "session_update" }))
                }
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
                const sessionPath = join(repoDir, ".review", "session.json")
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
                const sessionPath = join(repoDir, ".review", "session.json")
                if (!existsSync(sessionPath)) return new Response("No session found", { status: 404 })
                const raw = readFileSync(sessionPath, "utf-8")
                const session = JSON.parse(raw) as SessionFile
                const { checkAuth, findOpenPR, buildReviewPayload, pushReview } = await import("./github")
                if (!await checkAuth()) return new Response("Not authenticated with GitHub", { status: 401 })
                const prNumber = session.pr_number ?? await findOpenPR(repoDir)
                if (!prNumber) return new Response("No open PR found", { status: 404 })
                if (!session.reviews || session.reviews.length === 0) {
                  return new Response("No annotations to push", { status: 400 })
                }
                const review = session.reviews[session.reviews.length - 1]
                await pushReview(repoDir, prNumber, buildReviewPayload(review))
                return new Response("OK", { status: 200 })
              } catch (err: unknown) {
                return new Response(err instanceof Error ? err.message : "Unknown error", { status: 500 })
              }
            })()
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
              return new Response(Bun.file(abs), {
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
            return new Response(Bun.file(filePath))
          }

          return new Response("Not Found", { status: 404 })
        },

        websocket: {
          open(ws) {
            wsClients.add(ws as unknown as WebSocket)
            if (getInitPayload) {
              Promise.resolve(getInitPayload()).then((payload) => {
                ws.send(JSON.stringify(payload))
              }).catch(() => {
                // Don't crash on init payload errors
              })
            }
          },
          close(ws) {
            wsClients.delete(ws as unknown as WebSocket)
          },
          message(_ws, _message) {
            // No-op for now
          },
        },

        error(err) {
          return new Response("Server error: " + err.message, { status: 500 })
        },
      })

      port = currentPort
      break
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException
      // EADDRINUSE means port is taken, try next one
      if (error.code === "EADDRINUSE" || (error.message && error.message.includes("in use"))) {
        if (attempt === maxAttempts - 1) {
          throw new Error(`Could not find available port after ${maxAttempts} attempts`)
        }
        continue
      }
      throw err
    }
  }

  if (!server) {
    throw new Error("Failed to start server")
  }

  // Watch .review/ directory for session.json changes and broadcast to WS clients
  const reviewDir = join(repoDir, ".review")
  mkdirSync(reviewDir, { recursive: true })
  watch(reviewDir, { persistent: false }, (event, filename) => {
    if (filename === "session.json") {
      const msg = JSON.stringify({ type: "session_update", timestamp: Date.now() })
      for (const client of wsClients) {
        try {
          client.send(msg)
        } catch {
          // Client may have disconnected
        }
      }
    }
  })

  return { port, server }
}

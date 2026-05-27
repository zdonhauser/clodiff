import { join } from "path"
import path from "path"
import { existsSync } from "fs"
import { watch, mkdirSync } from "fs"

export interface ServerOptions {
  port: number
  repoDir: string
  viewerDir: string
}

export interface StartServerResult {
  port: number
  server: ReturnType<typeof Bun.serve>
}

export async function startServer(options: ServerOptions): Promise<StartServerResult> {
  const { repoDir, viewerDir } = options
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
        fetch(req, server) {
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

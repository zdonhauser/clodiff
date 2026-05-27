import { h, render } from "https://esm.sh/preact"
import { useState, useEffect, useCallback, useRef } from "https://esm.sh/preact/hooks"
import { html } from "https://esm.sh/htm/preact"

import { createWebSocket } from "./utils/websocket.js"
import { scrollToLine } from "./utils/anchoring.js"

import { Header } from "./components/Header.js"
import { FileList } from "./components/FileList.js"

// ── Storage helpers ────────────────────────────────────────────────────────

function loadViewMode() {
  try {
    return localStorage.getItem("clodiff_viewMode") || "unified"
  } catch {
    return "unified"
  }
}

function saveViewMode(mode) {
  try {
    localStorage.setItem("clodiff_viewMode", mode)
  } catch {}
}

// ── App component ──────────────────────────────────────────────────────────

function App() {
  const [diff, setDiff] = useState([])
  const [comments, setComments] = useState([])
  const [session, setSession] = useState(null)
  const [viewMode, setViewMode] = useState(loadViewMode)
  const [expandedFiles, setExpandedFiles] = useState({})
  const [wsStatus, setWsStatus] = useState("disconnected")

  // Map from file path → DOM element (for scrollToLine)
  const fileRefs = useRef({})

  // Register a file's DOM element
  const handleFileRef = useCallback((path, el) => {
    if (el) {
      fileRefs.current[path] = el
    } else {
      delete fileRefs.current[path]
    }
  }, [])

  // Expand a file (for scrollToLine)
  const expandFile = useCallback((path) => {
    setExpandedFiles((prev) => {
      if (prev[path] === false) {
        return { ...prev, [path]: true }
      }
      return prev
    })
  }, [])

  // Toggle expand/collapse for a file
  const handleToggle = useCallback((path) => {
    setExpandedFiles((prev) => ({
      ...prev,
      [path]: prev[path] === false ? true : false,
    }))
  }, [])

  // Fetch session from server
  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch("/session")
      if (!res.ok) return
      const data = await res.json()
      setSession(data)
    } catch {
      // Session may not exist yet
    }
  }, [])

  // Handle WebSocket messages
  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case "init": {
        setDiff(msg.diff || [])
        setComments(msg.comments || [])
        if (msg.session) setSession(msg.session)

        // Auto-expand files that have comments
        if (msg.comments && msg.comments.length > 0) {
          const pathsWithComments = new Set(msg.comments.map((c) => c.path))
          setExpandedFiles((prev) => {
            const next = { ...prev }
            for (const path of pathsWithComments) {
              if (next[path] === undefined) {
                next[path] = true
              }
            }
            return next
          })
        }
        break
      }

      case "session_update": {
        fetchSession()
        break
      }

      case "scroll_to": {
        const { path, line } = msg
        if (path && line != null) {
          scrollToLine(path, line, {
            expandFile,
            getFileRef: (p) => fileRefs.current[p],
          })
        }
        break
      }

      case "comment_add":
      case "comment_update": {
        // Server may push comment updates
        if (msg.comment) {
          setComments((prev) => {
            const idx = prev.findIndex((c) => c.id === msg.comment.id)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = msg.comment
              return next
            }
            return [...prev, msg.comment]
          })
        }
        break
      }

      default:
        break
    }
  }, [fetchSession, expandFile])

  // Set up WebSocket
  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/ws`
    const ws = createWebSocket(wsUrl, {
      onMessage: handleMessage,
      onStatusChange: setWsStatus,
    })

    return () => ws.close()
  }, [handleMessage])

  // Handle view mode change
  const handleViewMode = useCallback((mode) => {
    setViewMode(mode)
    saveViewMode(mode)
  }, [])

  // Resolve a comment (optimistic UI update + POST)
  const handleResolve = useCallback(async (commentId) => {
    // Optimistic update
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, resolved: true } : c))
    )
    // No server endpoint for resolve yet — optimistic only
    // Future: POST /resolve { comment_id: commentId }
  }, [])

  // Reply callback (no-op here; ReplyInput handles the POST)
  const handleReply = useCallback((commentId) => {
    // Could track open reply boxes globally if needed
  }, [])

  const fileCount = diff.length

  return html`
    <div style=${{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <${Header}
        session=${session}
        fileCount=${fileCount}
        wsStatus=${wsStatus}
        viewMode=${viewMode}
        onViewMode=${handleViewMode}
      />
      <main style=${{ maxWidth: "100%", margin: "0 auto" }}>
        <${FileList}
          diff=${diff}
          comments=${comments}
          expandedFiles=${expandedFiles}
          onToggle=${handleToggle}
          viewMode=${viewMode}
          onReply=${handleReply}
          onResolve=${handleResolve}
          onFileRef=${handleFileRef}
        />
      </main>
    </div>
  `
}

// ── Mount ─────────────────────────────────────────────────────────────────

const root = document.getElementById("app")
if (root) {
  render(h(App, null), root)
}

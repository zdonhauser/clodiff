import { h, render } from "https://esm.sh/preact"
import { useState, useEffect, useCallback, useRef } from "https://esm.sh/preact/hooks"
import { html } from "https://esm.sh/htm/preact"

import { createWebSocket } from "./utils/websocket.js"
import { scrollToLine } from "./utils/anchoring.js"

import { Header } from "./components/Header.js"
import { FileList } from "./components/FileList.js"
import { FileSidebar } from "./components/FileSidebar.js"
import { FileViewer } from "./components/FileViewer.js"

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

function loadSidebarOpen() {
  try {
    const v = localStorage.getItem("clodiff_sidebarOpen")
    return v === null ? true : v === "true"
  } catch {
    return true
  }
}

function saveSidebarOpen(open) {
  try {
    localStorage.setItem("clodiff_sidebarOpen", String(open))
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
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen)
  const [allFilesMode, setAllFilesMode] = useState(() => {
    try { return localStorage.getItem("clodiff_allFiles") === "true" } catch { return false }
  })
  const [textSize, setTextSize] = useState(() => {
    try { return localStorage.getItem("clodiff_textSize") || "md" } catch { return "md" }
  })
  const [openFile, setOpenFile] = useState(null) // { path, isDiff } for non-diff file panel
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : false)

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
      if (!prev[path]) {
        return { ...prev, [path]: true }
      }
      return prev
    })
  }, [])

  // Toggle expand/collapse for a file
  const handleToggle = useCallback((path) => {
    setExpandedFiles((prev) => ({
      ...prev,
      [path]: !prev[path],
    }))
  }, [])

  // Fetch session from server
  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch("/session")
      if (!res.ok) return
      const data = await res.json()
      setSession(data)
      // Flatten comments from all reviews and update state
      const flatComments = (data.reviews || []).flatMap((r) => r.comments || [])
      setComments(flatComments)
      // Auto-expand files that now have comments
      setExpandedFiles((prev) => {
        const updated = { ...prev }
        for (const c of flatComments) {
          if (!updated[c.path]) updated[c.path] = true
        }
        return updated
      })
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

        // Files with comments are expanded by default; all others are collapsed
        const initDiff = msg.diff || []
        const initComments = msg.comments || []
        const filesWithComments = new Set(initComments.map((c) => c.path))
        const expandedMap = {}
        for (const file of initDiff) {
          expandedMap[file.path] = filesWithComments.has(file.path)
        }
        setExpandedFiles(expandedMap)
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

      case "highlight": {
        const { path, line, duration = 4000, scroll = true } = msg
        if (!path || line == null) break
        if (scroll) {
          scrollToLine(path, line, {
            expandFile,
            getFileRef: (p) => fileRefs.current[p],
          })
        }
        // Use DOM class manipulation — avoids prop drilling through the entire tree
        const applyHighlight = () => {
          const el = document.querySelector(`[data-path="${CSS.escape(path)}"][data-line="${line}"]`)
          if (!el) return
          el.classList.remove("clodiff-highlight", "clodiff-fading")
          // Force reflow so the transition re-triggers if already highlighted
          void el.offsetHeight
          el.classList.add("clodiff-highlight")
          setTimeout(() => el.classList.add("clodiff-fading"), Math.max(duration - 700, 300))
          setTimeout(() => el.classList.remove("clodiff-highlight", "clodiff-fading"), duration)
        }
        // Small delay to allow scroll + expand to render the target line first
        setTimeout(applyHighlight, scroll ? 150 : 0)
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

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev
      saveSidebarOpen(next)
      return next
    })
  }, [])

  const handleAllFilesChange = useCallback((v) => {
    setAllFilesMode(v)
    try { localStorage.setItem("clodiff_allFiles", String(v)) } catch {}
    if (!v) setOpenFile(null)
  }, [])

  const handleTextSizeChange = useCallback((size) => {
    setTextSize(size)
    try { localStorage.setItem("clodiff_textSize", size) } catch {}
    document.documentElement.setAttribute("data-text-size", size)
  }, [])

  // Apply stored text size on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-text-size", textSize)
  }, [])

  // Track mobile breakpoint
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", handler)
    return () => window.removeEventListener("resize", handler)
  }, [])

  const closeSidebarOnMobile = useCallback(() => {
    if (isMobile) {
      setSidebarOpen(false)
      saveSidebarOpen(false)
    }
  }, [isMobile])

  const handleSidebarNavigate = useCallback((filePath, isDiff) => {
    closeSidebarOnMobile()
    if (!isDiff) {
      setOpenFile({ path: filePath, isDiff: false })
      return
    }
    setOpenFile(null)
    expandFile(filePath)
    setTimeout(() => {
      scrollToLine(filePath, null, {
        expandFile,
        getFileRef: (p) => fileRefs.current[p],
      })
    }, 50)
  }, [expandFile, closeSidebarOnMobile])

  // Resolve a comment (optimistic UI update + POST)
  const handleResolve = useCallback(async (commentId) => {
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, resolved: true } : c))
    )
    fetch("/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId }),
    }).catch(() => {})
  }, [])

  const handleAction = useCallback(async (commentId, action) => {
    const replyRes = await fetch("/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId, body: action === "fix" ? "Fix It" : "Rejected" }),
    })
    if (!replyRes.ok) return

    const resolveRes = await fetch("/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId }),
    })
    if (!resolveRes.ok) return

    setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, resolved: true } : c))

    // Find next unresolved comment in file/line order and scroll to it
    const sorted = [...comments].sort((a, b) => {
      const aFile = diff.findIndex((f) => f.path === a.path)
      const bFile = diff.findIndex((f) => f.path === b.path)
      if (aFile !== bFile) return aFile - bFile
      return a.line - b.line
    })
    const idx = sorted.findIndex((c) => c.id === commentId)
    if (idx === -1) return
    const next = sorted.slice(idx + 1).find((c) => !c.resolved && c.id !== commentId)
    if (next) {
      fetch("/_ws_broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "scroll_to", path: next.path, line: next.line }),
      }).catch(() => {})
    }
  }, [comments, diff])

  // Reply callback (no-op here; ReplyInput handles the POST)
  const handleReply = useCallback((commentId) => {
    // Could track open reply boxes globally if needed
  }, [])

  const fileCount = diff.length
  // On mobile always use unified — side-by-side is unusable on narrow screens
  const effectiveViewMode = isMobile ? "unified" : viewMode

  return html`
    <div style=${{ height: "100%", background: "var(--color-bg)", display: "flex", flexDirection: "column" }}>
      <${Header}
        session=${session}
        fileCount=${fileCount}
        wsStatus=${wsStatus}
        viewMode=${effectiveViewMode}
        onViewMode=${handleViewMode}
        sidebarOpen=${sidebarOpen}
        onToggleSidebar=${handleToggleSidebar}
        isMobile=${isMobile}
      />
      <div style=${{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
        ${sidebarOpen && isMobile && html`
          <div
            onClick=${handleToggleSidebar}
            style=${{
              position: "fixed",
              inset: 0,
              zIndex: 299,
              background: "rgba(0,0,0,0.4)",
            }}
          />
        `}
        <${FileSidebar}
          open=${sidebarOpen}
          diff=${diff}
          comments=${comments}
          onNavigate=${handleSidebarNavigate}
          onClose=${handleToggleSidebar}
          allFilesMode=${allFilesMode}
          onAllFilesChange=${handleAllFilesChange}
          textSize=${textSize}
          onTextSizeChange=${handleTextSizeChange}
        />
        <main style=${{ flex: 1, overflow: "auto", minWidth: 0 }}>
          ${openFile
            ? html`<${FileViewer} path=${openFile.path} onClose=${() => setOpenFile(null)} />`
            : html`<${FileList}
                diff=${diff}
                comments=${comments}
                expandedFiles=${expandedFiles}
                onToggle=${handleToggle}
                viewMode=${effectiveViewMode}
                onReply=${handleReply}
                onResolve=${handleResolve}
                onAction=${handleAction}
                onFileRef=${handleFileRef}
              />`
          }
        </main>
      </div>
    </div>
  `
}

// ── Mount ─────────────────────────────────────────────────────────────────

const root = document.getElementById("app")
if (root) {
  render(h(App, null), root)
}

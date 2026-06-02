import { h, render } from "https://esm.sh/preact"
import { useState, useEffect, useCallback, useRef, useMemo } from "https://esm.sh/preact/hooks"
import { html } from "https://esm.sh/htm/preact"

import { createWebSocket } from "./utils/websocket.js"
import { scrollToLine } from "./utils/anchoring.js"

import { Header } from "./components/Header.js"
import { FileList } from "./components/FileList.js"
import { Conversation } from "./components/Conversation.js"
import { OutdatedComments } from "./components/OutdatedComments.js"
import { FileSidebar } from "./components/FileSidebar.js"
import { FileViewer } from "./components/FileViewer.js"
import { CommentNavigator } from "./components/CommentNavigator.js"

const SEVERITY_ORDER = { error: 0, warning: 1, suggestion: 2, note: 3 }

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
  const [wrap, setWrap] = useState(() => {
    try { return localStorage.getItem("clodiff_wrap") !== "off" } catch { return true }
  })
  const [openFile, setOpenFile] = useState(null) // { path, isDiff } for non-diff file panel
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : false)
  const [navIdx, setNavIdx] = useState(-1)

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

  // Severity-sorted unresolved comments for navigation
  const sortedUnresolved = useMemo(() => {
    return comments
      .filter((c) => !c.resolved)
      .sort((a, b) => {
        const sa = SEVERITY_ORDER[a.severity] ?? 4
        const sb = SEVERITY_ORDER[b.severity] ?? 4
        if (sa !== sb) return sa - sb
        const fa = diff.findIndex((f) => f.path === a.path)
        const fb = diff.findIndex((f) => f.path === b.path)
        if (fa !== fb) return fa - fb
        return (a.line ?? 0) - (b.line ?? 0)
      })
  }, [comments, diff])

  const getNavInfo = useCallback((commentId) => {
    const idx = sortedUnresolved.findIndex((c) => c.id === commentId)
    if (idx === -1) return null
    return {
      index: idx,
      total: sortedUnresolved.length,
      prevId: idx > 0 ? sortedUnresolved[idx - 1].id : null,
      nextId: idx < sortedUnresolved.length - 1 ? sortedUnresolved[idx + 1].id : null,
      severity: sortedUnresolved[idx].severity,
    }
  }, [sortedUnresolved])

  const handleNavigate = useCallback((commentId) => {
    const comment = comments.find((c) => c.id === commentId)
    if (!comment) return
    const idx = sortedUnresolved.findIndex((c) => c.id === commentId)
    if (idx !== -1) setNavIdx(idx)
    expandFile(comment.path)
    setTimeout(() => {
      scrollToLine(comment.path, comment.line, {
        expandFile,
        getFileRef: (p) => fileRefs.current[p],
      })
    }, 50)
  }, [comments, sortedUnresolved, expandFile])

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
      // _from/_to/_default_branch are live diff-view state injected by the server's
      // init payload — they're never persisted to session.json. A session_update
      // refresh reloads the on-disk session (annotations etc.), so preserve the
      // current view range rather than letting it fall back to defaults.
      setSession((prev) => ({
        ...data,
        _from: data._from ?? prev?._from,
        _to: data._to ?? prev?._to,
        _default_branch: data._default_branch ?? prev?._default_branch,
      }))
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

  const handleWrapChange = useCallback((on) => {
    setWrap(on)
    try { localStorage.setItem("clodiff_wrap", on ? "on" : "off") } catch {}
    document.documentElement.setAttribute("data-wrap", on ? "on" : "off")
  }, [])

  // Apply stored text size + wrap on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-text-size", textSize)
    document.documentElement.setAttribute("data-wrap", wrap ? "on" : "off")
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
    // /action resolves the comment + notifies the monitor via replies.json
    // without creating a visible reply bubble in the thread
    const res = await fetch("/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId, action }),
    })
    if (!res.ok) return

    setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, resolved: true } : c))

    // Navigate to next in severity order
    const idx = sortedUnresolved.findIndex((c) => c.id === commentId)
    if (idx !== -1 && idx < sortedUnresolved.length - 1) {
      handleNavigate(sortedUnresolved[idx + 1].id)
    }
  }, [sortedUnresolved, handleNavigate])

  // Reply callback (no-op here; ReplyInput handles the POST)
  const handleReply = useCallback((commentId) => {
    // Could track open reply boxes globally if needed
  }, [])

  // Edit a comment body: optimistic update + POST
  const handleEdit = useCallback(async (commentId, newBody) => {
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, body: newBody } : c))
    )
    fetch("/edit-comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId, body: newBody }),
    }).catch(() => {})
  }, [])

  const fileCount = diff.length
  // On mobile always use unified — side-by-side is unusable on narrow screens
  const effectiveViewMode = isMobile ? "unified" : viewMode

  return html`
    <div style=${{ height: "100%", background: "var(--color-bg)", display: "flex", flexDirection: "column" }}>
      <${Header}
        session=${session}
        comments=${comments}
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
          session=${session}
          diff=${diff}
          comments=${comments}
          onNavigate=${handleSidebarNavigate}
          onClose=${handleToggleSidebar}
          allFilesMode=${allFilesMode}
          onAllFilesChange=${handleAllFilesChange}
          textSize=${textSize}
          onTextSizeChange=${handleTextSizeChange}
          wrap=${wrap}
          onWrapChange=${handleWrapChange}
        />
        <main style=${{ flex: 1, overflow: "auto", minWidth: 0 }}>
          ${openFile
            ? html`<${FileViewer} path=${openFile.path} onClose=${() => setOpenFile(null)} />`
            : html`
              <${Conversation} prMeta=${session?.pr_meta} conversation=${session?.pr_conversation} />
              <${OutdatedComments} comments=${comments} />
              <${FileList}
                diff=${diff}
                comments=${comments}
                expandedFiles=${expandedFiles}
                onToggle=${handleToggle}
                viewMode=${effectiveViewMode}
                onReply=${handleReply}
                onResolve=${handleResolve}
                onAction=${handleAction}
                onEdit=${handleEdit}
                onFileRef=${handleFileRef}
                getNavInfo=${getNavInfo}
                onNavigate=${handleNavigate}
              />`
          }
        </main>
      </div>
      <${CommentNavigator}
        sortedUnresolved=${sortedUnresolved}
        navIdx=${navIdx}
        onNavigate=${handleNavigate}
      />
    </div>
  `
}

// ── Mount ─────────────────────────────────────────────────────────────────

const root = document.getElementById("app")
if (root) {
  render(h(App, null), root)
}

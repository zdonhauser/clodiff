import { html } from "https://esm.sh/htm/preact"
import { useState, useMemo, useEffect, useCallback } from "https://esm.sh/preact/hooks"
import { SettingsPanel } from "./SettingsPanel.js"

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : false)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", handler)
    return () => window.removeEventListener("resize", handler)
  }, [])
  return isMobile
}

const STATUS_COLORS = {
  added: "var(--color-added-gutter)",
  removed: "var(--color-removed-gutter)",
  modified: "var(--color-accent-fg)",
  renamed: "var(--color-attention-fg)",
}

const STATUS_LABELS = { added: "A", removed: "D", modified: "M", renamed: "R" }

function buildTree(files) {
  const root = { children: {}, files: [] }
  for (const file of files) {
    const parts = file.path.split("/")
    if (parts.length === 1) {
      root.files.push(file)
    } else {
      const dir = parts.slice(0, -1).join("/")
      if (!root.children[dir]) root.children[dir] = { dir, files: [] }
      root.children[dir].files.push(file)
    }
  }
  return root
}

function FileEntry({ file, commentCount, onNavigate }) {
  const name = file.path.split("/").pop()
  const isDiff = file.status !== "unchanged"
  const color = isDiff ? (STATUS_COLORS[file.status] || "var(--color-fg-muted)") : "transparent"

  return html`
    <button
      onClick=${() => onNavigate?.(file.path)}
      title=${file.path}
      style=${{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        width: "100%",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "4px 8px 4px 12px",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-fg-default)",
        fontSize: "12px",
        fontFamily: "var(--font-mono)",
        textAlign: "left",
        minWidth: 0,
      }}
      onMouseEnter=${(e) => { e.currentTarget.style.background = "var(--color-canvas-subtle)" }}
      onMouseLeave=${(e) => { e.currentTarget.style.background = "none" }}
    >
      <span style=${{
        fontSize: "10px",
        fontWeight: "700",
        color,
        flexShrink: 0,
        width: "10px",
      }}>${isDiff ? (STATUS_LABELS[file.status] || "M") : ""}</span>
      <span style=${{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
      }}>${name}</span>
      ${commentCount > 0 && html`
        <span style=${{
          background: "var(--color-accent-emphasis)",
          color: "#ffffff",
          borderRadius: "10px",
          padding: "0 5px",
          fontSize: "10px",
          fontWeight: "600",
          flexShrink: 0,
          lineHeight: "16px",
          minWidth: "16px",
          textAlign: "center",
        }}>${commentCount}</span>
      `}
    </button>
  `
}

function DirGroup({ dir, files, commentsByPath, openDirs, onToggleDir, onNavigate }) {
  const label = dir.split("/").pop()
  const isOpen = openDirs[dir] !== false
  const totalComments = files.reduce((s, f) => s + (commentsByPath[f.path] || 0), 0)

  return html`
    <div>
      <button
        onClick=${() => onToggleDir(dir)}
        style=${{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px 8px",
          borderRadius: "var(--radius-sm)",
          color: "var(--color-fg-muted)",
          fontSize: "11px",
          fontFamily: "var(--font-mono)",
          textAlign: "left",
          marginTop: "4px",
        }}
        onMouseEnter=${(e) => { e.currentTarget.style.background = "var(--color-canvas-subtle)" }}
        onMouseLeave=${(e) => { e.currentTarget.style.background = "none" }}
      >
        <span style=${{ fontSize: "9px", flexShrink: 0, opacity: 0.7 }}>${isOpen ? "▼" : "▶"}</span>
        <span style=${{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}>${dir}/</span>
        ${totalComments > 0 && !isOpen && html`
          <span style=${{
            background: "var(--color-accent-emphasis)",
            color: "#ffffff",
            borderRadius: "10px",
            padding: "0 5px",
            fontSize: "10px",
            fontWeight: "600",
            flexShrink: 0,
            lineHeight: "16px",
            minWidth: "16px",
            textAlign: "center",
          }}>${totalComments}</span>
        `}
      </button>
      ${isOpen && html`
        <div style=${{ paddingLeft: "8px" }}>
          ${files.map((f) => html`
            <${FileEntry}
              key=${f.path}
              file=${f}
              commentCount=${commentsByPath[f.path] || 0}
              onNavigate=${onNavigate}
            />
          `)}
        </div>
      `}
    </div>
  `
}

function loadAllFiles() {
  try { return localStorage.getItem("clodiff_allFiles") === "true" } catch { return false }
}
function saveAllFiles(v) {
  try { localStorage.setItem("clodiff_allFiles", String(v)) } catch {}
}

/**
 * FileSidebar — collapsible left panel with file tree.
 *
 * Props:
 *   open         — boolean
 *   diff         — DiffFile[]
 *   comments     — ReviewComment[]
 *   onNavigate   — (path: string, isDiff: boolean) => void
 *   allFilesMode     — boolean
 *   onAllFilesChange — (v: boolean) => void
 *   textSize         — "sm"|"md"|"lg"
 *   onTextSizeChange — (s: string) => void
 */
export function FileSidebar({ open, session, diff = [], comments = [], allExpanded = true, onToggleAll, onNavigate, onClose, allFilesMode, onAllFilesChange, textSize, onTextSizeChange, wrap, onWrapChange }) {
  const [openDirs, setOpenDirs] = useState({})
  const [treeFiles, setTreeFiles] = useState([])
  const isMobile = useIsMobile()

  const fetchTree = useCallback(async () => {
    try {
      const res = await fetch("/tree")
      if (res.ok) setTreeFiles(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    if (allFilesMode) fetchTree()
  }, [allFilesMode, fetchTree])

  const commentsByPath = useMemo(() => {
    const map = {}
    for (const c of comments) {
      if (!c.resolved) map[c.path] = (map[c.path] || 0) + 1
    }
    return map
  }, [comments])

  const diffPathSet = useMemo(() => new Set(diff.map((f) => f.path)), [diff])

  // In all-files mode, build tree from full file list; non-diff files get a synthetic entry
  const displayFiles = useMemo(() => {
    if (!allFilesMode) return diff
    return treeFiles.map((p) => {
      const diffFile = diff.find((f) => f.path === p)
      return diffFile ?? { path: p, status: "unchanged", hunks: [] }
    })
  }, [allFilesMode, treeFiles, diff])

  const tree = useMemo(() => buildTree(displayFiles), [displayFiles])

  const handleToggleDir = (dir) => {
    setOpenDirs((prev) => ({ ...prev, [dir]: prev[dir] === false ? true : false }))
  }

  const handleNavigate = useCallback((filePath) => {
    onNavigate?.(filePath, diffPathSet.has(filePath))
    if (isMobile) onClose?.()
  }, [onNavigate, diffPathSet, isMobile, onClose])

  const sidebarStyle = isMobile ? {
    position: "fixed",
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 300,
    width: open ? "260px" : "0",
    minWidth: open ? "260px" : "0",
    overflow: "hidden",
    transition: "width 0.2s ease, min-width 0.2s ease",
    borderRight: open ? "1px solid var(--color-border-default)" : "none",
    background: "var(--color-canvas-subtle)",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    boxShadow: open ? "4px 0 20px rgba(0,0,0,0.35)" : "none",
  } : {
    width: open ? "220px" : "0",
    minWidth: open ? "220px" : "0",
    overflow: "hidden",
    transition: "width 0.2s ease, min-width 0.2s ease",
    borderRight: open ? "1px solid var(--color-border-default)" : "none",
    background: "var(--color-canvas-subtle)",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
  }

  return html`
    <aside style=${sidebarStyle}>
      <div style=${{
        opacity: open ? 1 : 0,
        transition: "opacity 0.15s ease",
        overflowY: "auto",
        overflowX: "hidden",
        flex: 1,
        padding: "8px 4px",
        minWidth: isMobile ? "260px" : "220px",
      }}>
        <div style=${{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 8px 6px",
        }}>
          <span style=${{
            fontSize: "11px",
            fontWeight: "600",
            color: "var(--color-fg-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            ${allFilesMode ? "All files" : "Files changed"}
          </span>
          ${diff.length > 0 && onToggleAll && html`
            <button
              onClick=${onToggleAll}
              title=${allExpanded ? "Collapse all files" : "Expand all files"}
              aria-label=${allExpanded ? "Collapse all files" : "Expand all files"}
              style=${{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-fg-muted)",
                padding: "2px",
                borderRadius: "var(--radius-sm)",
              }}
              onMouseEnter=${(e) => { e.currentTarget.style.color = "var(--color-fg-default)" }}
              onMouseLeave=${(e) => { e.currentTarget.style.color = "var(--color-fg-muted)" }}
            >
              ${allExpanded
                ? html`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 18.59L8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59zm9.18-13.18L15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59z"/></svg>`
                : html`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5.83L15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z"/></svg>`}
            </button>
          `}
        </div>

        <!-- Root-level files (no directory) -->
        ${tree.files.map((f) => html`
          <${FileEntry}
            key=${f.path}
            file=${f}
            commentCount=${commentsByPath[f.path] || 0}
            onNavigate=${handleNavigate}
          />
        `)}

        <!-- Grouped files by directory -->
        ${Object.values(tree.children).map((group) => html`
          <${DirGroup}
            key=${group.dir}
            dir=${group.dir}
            files=${group.files}
            commentsByPath=${commentsByPath}
            openDirs=${openDirs}
            onToggleDir=${handleToggleDir}
            onNavigate=${handleNavigate}
          />
        `)}
      </div>

      <!-- Settings button at bottom -->
      <div style=${{
        minWidth: isMobile ? "260px" : "220px",
        opacity: open ? 1 : 0,
        transition: "opacity 0.15s ease",
      }}>
        <${SettingsPanel}
          session=${session}
          allFilesMode=${allFilesMode}
          onAllFilesChange=${onAllFilesChange}
          textSize=${textSize}
          onTextSizeChange=${onTextSizeChange}
          wrap=${wrap}
          onWrapChange=${onWrapChange}
        />
      </div>
    </aside>
  `
}

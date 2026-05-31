import { html } from "https://esm.sh/htm/preact"
import { useState, useCallback } from "https://esm.sh/preact/hooks"
import { RefPicker } from "./RefPicker.js"
import { SubmitReviewModal } from "./SubmitReviewModal.js"

/**
 * Header component.
 *
 * Props:
 *   session    — SessionFile | null
 *   fileCount  — number
 *   wsStatus   — "connected" | "reconnecting" | "disconnected"
 *   viewMode   — "unified" | "side-by-side"
 *   onViewMode — (mode) => void
 */
export function Header({ session, comments = [], fileCount, wsStatus, viewMode, onViewMode, sidebarOpen, onToggleSidebar, isMobile }) {
  const [rediffStatus, setRediffStatus] = useState(null)
  const [fromRef, setFromRef] = useState(null)
  const [toRef, setToRef] = useState(null)
  const [reviewStatus, setReviewStatus] = useState(null) // null | "approving" | "approved" | "requesting" | "changes_requested" | "error"
  const [pushStatus, setPushStatus] = useState(null)     // null | "pushing" | "done" | "error"
  const [showSubmitModal, setShowSubmitModal] = useState(false)

  const baseBranch = session?.base_branch || "main"
  const currentBranch = session?.repo
    ? session.repo.split("/").pop()
    : "HEAD"

  // _from/_to are injected by the server to track live rediff state
  const displayFrom = fromRef ?? session?._from ?? baseBranch
  const displayTo = toRef ?? session?._to ?? "HEAD"

  const handleRediff = useCallback(async (newFrom, newTo) => {
    const f = newFrom ?? displayFrom
    const t = newTo ?? displayTo
    setRediffStatus("loading")
    try {
      const res = await fetch("/rediff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: f, to: t }),
      })
      if (!res.ok) throw new Error(await res.text())
      setFromRef(f)
      setToRef(t)
      setRediffStatus(null)
    } catch {
      setRediffStatus("error")
      setTimeout(() => setRediffStatus(null), 3000)
    }
  }, [displayFrom, displayTo])

  const handleReviewEvent = useCallback(async (event) => {
    const key = event === "APPROVE" ? "approving" : "requesting"
    const done = event === "APPROVE" ? "approved" : "changes_requested"
    setReviewStatus(key)
    try {
      await fetch("/review/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
      })
      setReviewStatus(done)
      setTimeout(() => setReviewStatus(null), 2000)
    } catch {
      setReviewStatus("error")
      setTimeout(() => setReviewStatus(null), 3000)
    }
  }, [])

  const handlePush = useCallback(async () => {
    setPushStatus("pushing")
    try {
      const res = await fetch("/push", { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      setPushStatus("done")
      setTimeout(() => setPushStatus(null), 3000)
    } catch (err) {
      setPushStatus("error")
      console.error("Push failed:", err)
      setTimeout(() => setPushStatus(null), 5000)
    }
  }, [])

  const WsIndicator = () => {
    const color =
      wsStatus === "connected"
        ? "var(--color-success-fg)"
        : wsStatus === "reconnecting"
        ? "var(--color-attention-fg)"
        : "var(--color-fg-subtle)"
    const label =
      wsStatus === "connected"
        ? "Connected"
        : wsStatus === "reconnecting"
        ? "Reconnecting…"
        : "Disconnected"

    return html`
      <span
        title=${label}
        style=${{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          fontSize: "12px",
          color: "var(--color-fg-muted)",
          padding: "3px 6px",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-canvas-subtle)",
          border: "1px solid var(--color-border-default)",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}>
        <span style=${{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }} />
        <span class="ws-label">${label}</span>
      </span>
    `
  }

  const btnBase = {
    padding: "5px 12px",
    fontSize: "13px",
    fontWeight: "500",
    lineHeight: "1.4",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    border: "1px solid var(--color-border-default)",
    fontFamily: "var(--font-ui)",
    background: "var(--color-bg)",
    color: "var(--color-fg-default)",
    flexShrink: 0,
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
  }

  return html`
    <header style=${{
      position: "sticky",
      top: 0,
      zIndex: 100,
      background: "var(--color-canvas-subtle)",
      borderBottom: "1px solid var(--color-border-default)",
      boxShadow: "var(--shadow-sm)",
    }}>
      <!-- PR meta bar — shown when reviewing a PR -->
      ${session?.pr_meta && html`
        <div style=${{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "4px 16px",
          background: "var(--color-accent-subtle)",
          borderBottom: "1px solid var(--color-accent-emphasis)22",
          fontSize: "12px",
          flexWrap: "nowrap",
          overflow: "hidden",
        }}>
          <!-- PR number badge -->
          <span style=${{
            color: "var(--color-accent-emphasis)",
            flexShrink: 0,
            fontWeight: "700",
            background: "var(--color-accent-emphasis)16",
            border: "1px solid var(--color-accent-emphasis)30",
            borderRadius: "var(--radius-sm)",
            padding: "0px 6px",
            letterSpacing: "0.01em",
          }}>
            #${session.pr_meta.number}
          </span>
          <!-- Title -->
          <span style=${{
            color: "var(--color-fg-default)",
            fontWeight: "600",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}>${session.pr_meta.title}</span>
          <!-- Author -->
          <span style=${{ color: "var(--color-fg-muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
            @${session.pr_meta.author}
          </span>
          <!-- CI status -->
          ${session.pr_meta.checks_status && session.pr_meta.checks_status !== "neutral" && html`
            <span style=${{
              flexShrink: 0,
              display: "inline-flex", alignItems: "center", gap: "5px",
              whiteSpace: "nowrap",
              padding: "1px 6px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: "600",
              background: session.pr_meta.checks_status === "success" ? "var(--color-success-fg)18"
                : session.pr_meta.checks_status === "failure" ? "var(--color-danger-fg)18"
                : "var(--color-attention-fg)18",
              color: session.pr_meta.checks_status === "success" ? "var(--color-success-fg)"
                : session.pr_meta.checks_status === "failure" ? "var(--color-danger-fg)"
                : "var(--color-attention-fg)",
              border: "1px solid currentColor",
              borderColor: session.pr_meta.checks_status === "success" ? "var(--color-success-fg)40"
                : session.pr_meta.checks_status === "failure" ? "var(--color-danger-fg)40"
                : "var(--color-attention-fg)40",
            }}>
              <span style=${{
                width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0,
                background: "currentColor",
              }} />
              <span>
                ${session.pr_meta.checks_status === "success" ? "CI passing"
                  : session.pr_meta.checks_status === "failure" ? "CI failing"
                  : "CI pending"}
              </span>
            </span>
          `}
        </div>
      `}

      <!-- Top row -->
      <div style=${{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        flexWrap: "nowrap",
        overflow: "hidden",
      }}>
        <!-- Logo + branch info -->
        <div style=${{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
          <!-- Sidebar toggle -->
          <button
            onClick=${onToggleSidebar}
            title=${sidebarOpen ? "Close file tree" : "Open file tree"}
            style=${{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "3px 5px",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-fg-muted)",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
            onMouseEnter=${(e) => { e.currentTarget.style.background = "var(--color-canvas-subtle)" }}
            onMouseLeave=${(e) => { e.currentTarget.style.background = "none" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="3" width="14" height="1.5" rx="0.75"/>
              <rect x="1" y="7.25" width="14" height="1.5" rx="0.75"/>
              <rect x="1" y="11.5" width="14" height="1.5" rx="0.75"/>
            </svg>
          </button>

          <span style=${{
            fontWeight: "700",
            fontSize: "15px",
            color: "var(--color-fg-default)",
            letterSpacing: "-0.3px",
            flexShrink: 0,
          }}>clodiff</span>

          <span style=${{ color: "var(--color-fg-muted)" }}>·</span>

          <!-- Branch display with pickers -->
          <span style=${{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--color-fg-default)",
          }}>
            <${RefPicker}
              value=${displayFrom}
              label="base"
              onSelect=${(ref) => handleRediff(ref, displayTo)}
            />
            <span style=${{ color: "var(--color-fg-muted)", userSelect: "none" }}>←</span>
            <${RefPicker}
              value=${displayTo}
              label="compare"
              onSelect=${(ref) => handleRediff(displayFrom, ref)}
            />
            ${rediffStatus === "loading" && html`
              <span style=${{ fontSize: "11px", color: "var(--color-fg-muted)", marginLeft: "4px" }}>Reloading…</span>
            `}
            ${rediffStatus === "error" && html`
              <span style=${{ fontSize: "11px", color: "var(--color-danger-fg)", marginLeft: "4px" }}>Rediff failed</span>
            `}
          </span>

          <!-- File count — hidden on very small screens -->
          ${fileCount > 0 && !isMobile && html`
            <span style=${{
              color: "var(--color-fg-muted)",
              fontSize: "12px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}>${fileCount} file${fileCount !== 1 ? "s" : ""}</span>
          `}
        </div>

        <!-- WS status -->
        <${WsIndicator} />
      </div>

      <!-- Action row -->
      <div style=${{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: isMobile ? "6px 10px 8px" : "6px 16px 8px",
        borderTop: "1px solid var(--color-border-muted)",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        flexShrink: 0,
      }}>
        <!-- View mode toggle — hidden on mobile (unified is forced) -->
        ${!isMobile && html`
          <div style=${{
            display: "flex",
            border: "1px solid var(--color-border-default)",
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
            flexShrink: 0,
          }}>
            ${["unified", "side-by-side"].map((mode) => html`
              <button
                key=${mode}
                onClick=${() => onViewMode?.(mode)}
                style=${{
                  ...btnBase,
                  border: "none",
                  borderRadius: 0,
                  background: viewMode === mode ? "var(--color-accent-emphasis)" : "var(--color-bg)",
                  color: viewMode === mode ? "#ffffff" : "var(--color-fg-default)",
                  borderRight: mode === "unified" ? "1px solid var(--color-border-default)" : "none",
                  fontWeight: viewMode === mode ? "600" : "400",
                  fontSize: "12px",
                  whiteSpace: "nowrap",
                }}
              >${mode === "unified" ? "Unified" : "Side by side"}</button>
            `)}
          </div>
        `}

        <div style=${{ flex: 1 }} />

        <!-- Submit Review (opens modal) -->
        <button
          onClick=${() => setShowSubmitModal(true)}
          disabled=${pushStatus === "pushing"}
          style=${{
            ...btnBase,
            background: pushStatus === "error"
              ? "var(--color-danger-fg)"
              : pushStatus === "done"
              ? "var(--color-success-emphasis)"
              : "var(--color-accent-emphasis)",
            color: "#ffffff",
            border: "1px solid transparent",
            fontWeight: "600",
          }}
        >
          ${pushStatus === "pushing" ? "Submitting…"
            : pushStatus === "done" ? "✓ Submitted"
            : pushStatus === "error" ? "Failed"
            : "Submit Review"}
        </button>
      </div>
    </header>

    <!-- Submit Review Modal -->
    ${showSubmitModal && html`
      <${SubmitReviewModal}
        comments=${comments}
        session=${session}
        onClose=${() => setShowSubmitModal(false)}
        onSubmit=${async (event, body) => {
          setPushStatus("pushing")
          try {
            // 1. Set event
            const evRes = await fetch("/review/event", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event }),
            })
            if (!evRes.ok) throw new Error(await evRes.text())

            // 2. Set review body (optional)
            const bodyRes = await fetch("/review/body", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ body }),
            })
            if (!bodyRes.ok) throw new Error(await bodyRes.text())

            // 3. Push to GitHub
            const pushRes = await fetch("/push", { method: "POST" })
            if (!pushRes.ok) throw new Error(await pushRes.text())

            setPushStatus("done")
            setShowSubmitModal(false)
            setTimeout(() => setPushStatus(null), 4000)
          } catch (err) {
            setPushStatus("error")
            setTimeout(() => setPushStatus(null), 5000)
            throw err
          }
        }}
      />
    `}
  `
}

import { html } from "https://esm.sh/htm/preact"
import { useState, useCallback } from "https://esm.sh/preact/hooks"

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
export function Header({ session, fileCount, wsStatus, viewMode, onViewMode }) {
  const [pushStatus, setPushStatus] = useState(null) // null | "pushing" | "done" | "error"
  const [reviewStatus, setReviewStatus] = useState(null)

  const baseBranch = session?.base_branch || "main"
  const currentBranch = session?.repo
    ? session.repo.split("/").pop()
    : "HEAD"

  const handleApprove = useCallback(async () => {
    setReviewStatus("approving")
    try {
      await fetch("/review/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "APPROVE" }),
      })
      setReviewStatus("approved")
      setTimeout(() => setReviewStatus(null), 2000)
    } catch {
      setReviewStatus("error")
      setTimeout(() => setReviewStatus(null), 3000)
    }
  }, [])

  const handleRequestChanges = useCallback(async () => {
    setReviewStatus("requesting")
    try {
      await fetch("/review/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "REQUEST_CHANGES" }),
      })
      setReviewStatus("changes_requested")
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
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg)
      }
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
        ? "#1a7f37"
        : wsStatus === "reconnecting"
        ? "#9a6700"
        : "#6e7781"
    const label =
      wsStatus === "connected"
        ? "Connected"
        : wsStatus === "reconnecting"
        ? "Reconnecting…"
        : "Disconnected"

    return html`
      <span style=${{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "12px",
        color: "var(--color-fg-muted)",
        padding: "3px 8px",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-canvas-subtle)",
        border: "1px solid var(--color-border-default)",
      }}>
        <span style=${{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }} />
        ${label}
      </span>
    `
  }

  const btnBase = {
    padding: "4px 12px",
    fontSize: "13px",
    fontWeight: "500",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    border: "1px solid var(--color-border-default)",
    fontFamily: "var(--font-ui)",
  }

  return html`
    <header style=${{
      position: "sticky",
      top: 0,
      zIndex: 100,
      background: "var(--color-canvas-subtle)",
      borderBottom: "1px solid var(--color-border-default)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    }}>
      <!-- Top row -->
      <div style=${{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "8px 16px",
        flexWrap: "wrap",
      }}>
        <!-- Logo + branch info -->
        <div style=${{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
          <span style=${{
            fontWeight: "700",
            fontSize: "15px",
            color: "var(--color-fg-default)",
            letterSpacing: "-0.3px",
            flexShrink: 0,
          }}>clodiff</span>

          <span style=${{ color: "var(--color-fg-muted)" }}>·</span>

          <!-- Branch display -->
          <span style=${{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--color-fg-default)",
            overflow: "hidden",
          }}>
            <span style=${{
              padding: "1px 6px",
              background: "var(--color-canvas-subtle)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-fg-muted)",
              whiteSpace: "nowrap",
            }}>${baseBranch}</span>
            <span style=${{ color: "var(--color-fg-muted)" }}>←</span>
            <span style=${{
              padding: "1px 6px",
              background: "#ddf4ff",
              border: "1px solid #b6e3ff",
              borderRadius: "var(--radius-sm)",
              color: "#0969da",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>${currentBranch}</span>
          </span>

          <!-- File count -->
          ${fileCount > 0 && html`
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
        padding: "6px 16px 8px",
        borderTop: "1px solid var(--color-border-muted)",
        flexWrap: "wrap",
      }}>
        <!-- View mode toggle -->
        <div style=${{
          display: "flex",
          border: "1px solid var(--color-border-default)",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
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
              }}
            >${mode === "unified" ? "Unified" : "Side by side"}</button>
          `)}
        </div>

        <div style=${{ flex: 1 }} />

        <!-- Approve -->
        <button
          onClick=${handleApprove}
          disabled=${reviewStatus === "approving"}
          style=${{
            ...btnBase,
            background:
              reviewStatus === "approved"
                ? "#2da44e"
                : reviewStatus === "approving"
                ? "var(--color-canvas-subtle)"
                : "var(--color-bg)",
            color:
              reviewStatus === "approved"
                ? "#ffffff"
                : "var(--color-success-fg)",
            borderColor:
              reviewStatus === "approved"
                ? "#2da44e"
                : "var(--color-border-default)",
          }}
        >
          ${reviewStatus === "approving" ? "Approving…" : reviewStatus === "approved" ? "✓ Approved" : "Approve"}
        </button>

        <!-- Request Changes -->
        <button
          onClick=${handleRequestChanges}
          disabled=${reviewStatus === "requesting"}
          style=${{
            ...btnBase,
            background:
              reviewStatus === "changes_requested"
                ? "var(--color-danger-fg)"
                : "var(--color-bg)",
            color:
              reviewStatus === "changes_requested"
                ? "#ffffff"
                : "var(--color-danger-fg)",
            borderColor:
              reviewStatus === "changes_requested"
                ? "var(--color-danger-fg)"
                : "var(--color-border-default)",
          }}
        >
          ${reviewStatus === "requesting"
            ? "Requesting…"
            : reviewStatus === "changes_requested"
            ? "✓ Changes Requested"
            : "Request Changes"}
        </button>

        <!-- Push to GitHub -->
        <button
          onClick=${handlePush}
          disabled=${pushStatus === "pushing"}
          style=${{
            ...btnBase,
            background:
              pushStatus === "done"
                ? "#2da44e"
                : pushStatus === "error"
                ? "var(--color-danger-fg)"
                : "#2da44e",
            color: "#ffffff",
            border: "none",
          }}
        >
          ${pushStatus === "pushing"
            ? "Pushing…"
            : pushStatus === "done"
            ? "✓ Pushed"
            : pushStatus === "error"
            ? "Push Failed"
            : "Push to GitHub"}
        </button>
      </div>
    </header>
  `
}

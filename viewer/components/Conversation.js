import { html } from "https://esm.sh/htm/preact"
import { useState } from "https://esm.sh/preact/hooks"
import { MarkdownBody, Avatar } from "./CommentCard.js"

const STATE_STYLE = {
  APPROVED: { label: "approved", color: "var(--color-success-fg)" },
  CHANGES_REQUESTED: { label: "requested changes", color: "var(--color-danger-fg)" },
  COMMENTED: { label: "commented", color: "var(--color-fg-muted)" },
  DISMISSED: { label: "dismissed", color: "var(--color-fg-subtle)" },
}

function timeAgo(iso) {
  if (!iso) return ""
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  })
}

function Entry({ author, body, created_at, state }) {
  const st = state ? STATE_STYLE[state] : null
  return html`
    <div style=${{
      border: "1px solid var(--color-border-default)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      marginBottom: "8px",
    }}>
      <div style=${{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "8px 12px",
        background: "var(--color-canvas-subtle)",
        borderBottom: "1px solid var(--color-border-muted)",
      }}>
        <${Avatar} label=${author} />
        <span style=${{ fontSize: "13px", fontWeight: "600", color: "var(--color-fg-default)" }}>@${author}</span>
        ${st && html`
          <span style=${{
            fontSize: "11px", fontWeight: "600", textTransform: "uppercase",
            letterSpacing: "0.4px", color: st.color, border: `1px solid ${st.color}33`,
            borderRadius: "var(--radius-sm)", padding: "1px 6px",
          }}>${st.label}</span>
        `}
        <span style=${{ marginLeft: "auto", fontSize: "12px", color: "var(--color-fg-subtle)", whiteSpace: "nowrap" }}>
          ${timeAgo(created_at)}
        </span>
      </div>
      <${MarkdownBody}
        text=${body}
        style=${{ padding: "10px 12px", fontSize: "var(--font-code-size)", lineHeight: "1.6", color: "var(--color-fg-default)" }}
      />
    </div>
  `
}

/**
 * Conversation — PR-level discussion that isn't pinned to a diff line:
 * the PR description, top-level comments, and review summary bodies.
 *
 * Props:
 *   prMeta       — session.pr_meta (for the description + author)
 *   conversation — session.pr_conversation (ConversationComment[])
 */
export function Conversation({ prMeta, conversation }) {
  const items = conversation || []
  const hasBody = prMeta?.body && prMeta.body.trim()
  const count = items.length + (hasBody ? 1 : 0)
  const [open, setOpen] = useState(count > 0 && count <= 6)

  if (!prMeta || count === 0) return null

  return html`
    <div style=${{
      margin: "12px 16px 0",
      border: "1px solid var(--color-border-default)",
      borderRadius: "var(--radius-lg)",
      background: "var(--color-bg)",
      boxShadow: "var(--shadow-sm)",
    }}>
      <button
        onClick=${() => setOpen((o) => !o)}
        style=${{
          width: "100%", display: "flex", alignItems: "center", gap: "8px",
          padding: "10px 14px", background: "transparent", border: "none",
          cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "13px",
          fontWeight: "600", color: "var(--color-fg-default)",
        }}
      >
        <span style=${{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--color-fg-muted)" }}>▸</span>
        Conversation
        <span style=${{ fontSize: "12px", fontWeight: "500", color: "var(--color-fg-subtle)" }}>${count}</span>
      </button>
      ${open && html`
        <div style=${{ padding: "0 14px 12px" }}>
          ${hasBody && html`<${Entry} author=${prMeta.author} body=${prMeta.body} state=${null} />`}
          ${items.map((c) => html`<${Entry} key=${c.id} author=${c.author} body=${c.body} created_at=${c.created_at} state=${c.state} />`)}
        </div>
      `}
    </div>
  `
}

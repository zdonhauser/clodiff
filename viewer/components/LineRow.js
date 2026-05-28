import { html } from "https://esm.sh/htm/preact"

/**
 * LineRow — renders a single diff line using flexbox.
 *
 * Props:
 *   line     — { type: "added"|"removed"|"context", content, oldLineNumber, newLineNumber }
 *   viewMode — "unified" | "side-by-side"
 *   side     — "left" | "right" (side-by-side only)
 *   path     — file path (for data attribute anchoring)
 *   onClick  — called when the line gutter is clicked (to add a comment)
 */
export function LineRow({ line, viewMode, side, path, onClick }) {
  if (!line) return null

  const { type, content, oldLineNumber, newLineNumber } = line

  const bgColor =
    type === "added"
      ? "var(--color-added-bg)"
      : type === "removed"
      ? "var(--color-removed-bg)"
      : "var(--color-bg)"

  const gutterColor =
    type === "added"
      ? "var(--color-added-gutter)"
      : type === "removed"
      ? "var(--color-removed-gutter)"
      : "transparent"

  const prefix = type === "added" ? "+" : type === "removed" ? "-" : " "

  const anchorLine =
    viewMode === "side-by-side"
      ? side === "left"
        ? oldLineNumber
        : newLineNumber
      : newLineNumber ?? oldLineNumber

  const lineStyle = {
    display: "flex",
    alignItems: "center",
    background: bgColor,
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-code-size)",
    lineHeight: "1.7",
  }

  const gutterStyle = {
    width: "4px",
    minWidth: "4px",
    alignSelf: "stretch",
    background: gutterColor,
    flexShrink: 0,
    padding: "0",
  }

  const lineNumStyle = {
    padding: "0 8px",
    textAlign: "right",
    color: "var(--color-fg-subtle)",
    userSelect: "none",
    width: "50px",
    minWidth: "50px",
    flexShrink: 0,
    whiteSpace: "nowrap",
    cursor: onClick ? "pointer" : "default",
    fontSize: "var(--font-code-size)",
  }

  const prefixStyle = {
    padding: "0 4px",
    color:
      type === "added"
        ? "var(--color-added-gutter)"
        : type === "removed"
        ? "var(--color-removed-gutter)"
        : "var(--color-fg-subtle)",
    userSelect: "none",
    width: "16px",
    minWidth: "16px",
    flexShrink: 0,
    textAlign: "center",
    fontSize: "var(--font-code-size)",
  }

  const contentStyle = {
    padding: "0 16px 0 4px",
    whiteSpace: "pre",
    tabSize: 4,
    flex: 1,
    minWidth: 0,
    fontSize: "var(--font-code-size)",
  }

  const dataAttrs = {}
  if (anchorLine !== null && anchorLine !== undefined) {
    dataAttrs["data-line"] = anchorLine
  }
  if (path) {
    dataAttrs["data-path"] = path
  }

  if (viewMode === "unified") {
    return html`
      <div style=${lineStyle} ...${dataAttrs}>
        <div style=${gutterStyle} />
        <div
          style=${lineNumStyle}
          title="Old line ${oldLineNumber ?? ""}"
          onClick=${onClick ? () => onClick(oldLineNumber) : undefined}
        >${oldLineNumber ?? ""}</div>
        <div
          style=${lineNumStyle}
          title="New line ${newLineNumber ?? ""}"
          onClick=${onClick ? () => onClick(newLineNumber) : undefined}
        >${newLineNumber ?? ""}</div>
        <div style=${prefixStyle}>${prefix}</div>
        <div class="diff-line-content" style=${contentStyle}>${content}</div>
      </div>
    `
  }

  // Side-by-side
  if (side === "left") {
    const show = type === "removed" || type === "context"
    if (!show) {
      return html`
        <div style=${{ ...lineStyle, background: "var(--color-canvas-subtle)" }} ...${dataAttrs}>
          <div style=${gutterStyle} />
          <div style=${{ ...lineNumStyle, color: "transparent" }}> </div>
          <div style=${{ ...prefixStyle, color: "transparent" }}> </div>
          <div style=${{ ...contentStyle, color: "transparent" }}> </div>
        </div>
      `
    }
    return html`
      <div style=${lineStyle} ...${dataAttrs}>
        <div style=${gutterStyle} />
        <div
          style=${lineNumStyle}
          onClick=${onClick ? () => onClick(oldLineNumber) : undefined}
        >${oldLineNumber ?? ""}</div>
        <div style=${prefixStyle}>${type === "removed" ? "-" : " "}</div>
        <div class="diff-line-content" style=${contentStyle}>${content}</div>
      </div>
    `
  }

  // side === "right"
  const show = type === "added" || type === "context"
  if (!show) {
    return html`
      <div style=${{ ...lineStyle, background: "var(--color-canvas-subtle)" }} ...${dataAttrs}>
        <div style=${gutterStyle} />
        <div style=${{ ...lineNumStyle, color: "transparent" }}> </div>
        <div style=${{ ...prefixStyle, color: "transparent" }}> </div>
        <div style=${{ ...contentStyle, color: "transparent" }}> </div>
      </div>
    `
  }
  return html`
    <div style=${lineStyle} ...${dataAttrs}>
      <div style=${gutterStyle} />
      <div
        style=${lineNumStyle}
        onClick=${onClick ? () => onClick(newLineNumber) : undefined}
      >${newLineNumber ?? ""}</div>
      <div style=${prefixStyle}>${type === "added" ? "+" : " "}</div>
      <div class="diff-line-content" style=${contentStyle}>${content}</div>
    </div>
  `
}

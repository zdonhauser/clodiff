import { html } from "https://esm.sh/htm/preact"

/**
 * LineRow — renders a single diff line.
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

  // The effective line number for anchoring (side determines which number to use in side-by-side)
  const anchorLine =
    viewMode === "side-by-side"
      ? side === "left"
        ? oldLineNumber
        : newLineNumber
      : newLineNumber ?? oldLineNumber

  const lineStyle = {
    display: "table-row",
    background: bgColor,
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    lineHeight: "20px",
    minHeight: "20px",
  }

  const gutterStyle = {
    display: "table-cell",
    width: "4px",
    minWidth: "4px",
    background: gutterColor,
    padding: "0",
  }

  const lineNumStyle = {
    display: "table-cell",
    padding: "0 8px",
    textAlign: "right",
    color: "var(--color-fg-subtle)",
    userSelect: "none",
    width: "50px",
    minWidth: "50px",
    whiteSpace: "nowrap",
    cursor: onClick ? "pointer" : "default",
    fontSize: "12px",
  }

  const prefixStyle = {
    display: "table-cell",
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
    textAlign: "center",
    fontSize: "12px",
  }

  const contentStyle = {
    display: "table-cell",
    padding: "0 16px 0 4px",
    whiteSpace: "pre",
    tabSize: 4,
    width: "100%",
    fontSize: "12px",
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
      <div
        style=${lineStyle}
        ...${dataAttrs}
      >
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

  // Side-by-side: render either left or right cell depending on side
  if (side === "left") {
    const show = type === "removed" || type === "context"
    if (!show) {
      // Empty placeholder row
      return html`
        <div style=${{ ...lineStyle, background: "var(--color-canvas-subtle)" }} ...${dataAttrs}>
          <div style=${gutterStyle} />
          <div style=${{ ...lineNumStyle, color: "transparent" }}> </div>
          <div style=${prefixStyle}> </div>
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
        <div style=${prefixStyle}> </div>
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

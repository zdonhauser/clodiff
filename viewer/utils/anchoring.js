/**
 * scrollToLine(path, line, { expandFile, getFileRef })
 *
 * - expandFile(path): callback to expand a collapsed file
 * - getFileRef(path): returns the DOM element for the file section
 *
 * Scrolls the viewport to the target line, highlights it briefly.
 */
export function scrollToLine(path, line, { expandFile, getFileRef } = {}) {
  // Expand the file if collapsed
  expandFile?.(path)

  // Use a short delay to allow the DOM to update after expansion
  setTimeout(() => {
    const fileEl = getFileRef?.(path)
    if (!fileEl) return

    // Find the line row by data attributes
    const lineEl = fileEl.querySelector(
      `[data-path="${CSS.escape(path)}"][data-line="${line}"]`
    ) || fileEl.querySelector(`[data-line="${line}"]`)

    if (lineEl) {
      lineEl.scrollIntoView({ behavior: "smooth", block: "center" })
      // Highlight the line briefly
      lineEl.style.outline = "2px solid var(--color-accent-emphasis)"
      lineEl.style.outlineOffset = "-2px"
      setTimeout(() => {
        lineEl.style.outline = ""
        lineEl.style.outlineOffset = ""
      }, 2000)
    } else {
      // Fallback: scroll to file header
      fileEl.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, 50)
}

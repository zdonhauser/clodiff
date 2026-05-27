/**
 * attachPrismObserver(containerEl)
 *
 * Sets up IntersectionObserver on hunk containers.
 * When a hunk enters viewport, loads Prism from esm.sh and applies syntax highlighting.
 * Never blocks main thread.
 */

const EXT_TO_LANG = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  cs: "csharp",
  cpp: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  css: "css",
  scss: "scss",
  less: "less",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  toml: "toml",
  dockerfile: "docker",
  tf: "hcl",
  swift: "swift",
  kt: "kotlin",
  php: "php",
  lua: "lua",
  r: "r",
}

let prismLoaded = false
let prismLoading = false
let prismPromise = null

async function loadPrism() {
  if (prismLoaded) return window.Prism
  if (prismLoading) return prismPromise

  prismLoading = true
  prismPromise = (async () => {
    try {
      // Load Prism core
      await import("https://esm.sh/prismjs@1/components/prism-core")
      // Load autoloader
      await import("https://esm.sh/prismjs@1/plugins/autoloader/prism-autoloader")
      if (window.Prism && window.Prism.plugins && window.Prism.plugins.autoloader) {
        window.Prism.plugins.autoloader.languages_path =
          "https://esm.sh/prismjs@1/components/"
      }
      prismLoaded = true
      return window.Prism
    } catch {
      // Silently fail — syntax highlighting is best-effort
      return null
    }
  })()

  return prismPromise
}

function getLanguageFromPath(filePath) {
  if (!filePath) return null
  const fileName = filePath.split("/").pop() || ""
  // Handle filenames like "Dockerfile"
  if (fileName.toLowerCase() === "dockerfile") return "docker"
  const ext = fileName.split(".").pop()?.toLowerCase()
  return ext ? (EXT_TO_LANG[ext] || null) : null
}

function highlightHunk(hunkEl) {
  const filePath = hunkEl.dataset.filePath
  const lang = getLanguageFromPath(filePath)
  if (!lang) return

  const codeEls = hunkEl.querySelectorAll(".diff-line-content")
  if (!codeEls.length) return

  loadPrism().then((Prism) => {
    if (!Prism) return
    // Use requestIdleCallback to not block main thread
    const highlight = () => {
      codeEls.forEach((el) => {
        if (!el.dataset.highlighted) {
          el.dataset.highlighted = "true"
          const text = el.textContent || ""
          try {
            const html = Prism.highlight(text, Prism.languages[lang] || Prism.languages.plain, lang)
            el.innerHTML = html
          } catch {
            // Silently fail
          }
        }
      })
    }

    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(highlight, { timeout: 1000 })
    } else {
      setTimeout(highlight, 0)
    }
  })
}

export function attachPrismObserver(containerEl) {
  if (!containerEl || typeof IntersectionObserver === "undefined") return

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          highlightHunk(entry.target)
          observer.unobserve(entry.target)
        }
      })
    },
    { rootMargin: "200px" }
  )

  // Observe all hunk containers
  const hunks = containerEl.querySelectorAll("[data-hunk]")
  hunks.forEach((el) => observer.observe(el))

  // Return a function to observe newly added hunks
  return {
    observe(el) {
      observer.observe(el)
    },
    disconnect() {
      observer.disconnect()
    },
  }
}

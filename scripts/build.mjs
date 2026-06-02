#!/usr/bin/env node
// Bundle the CLI to plain JS for publishing.
//
// Why this exists: the runtime is Node, and Node runs the TypeScript source
// directly via type-stripping during development (`node src/cli.ts`). But Node
// deliberately disables type-stripping for files under `node_modules` — so once
// the package is installed, a `.ts` bin cannot execute. Shipping a compiled
// `dist/cli.js` is what makes `npm i -g clodiff` / `npx clodiff` actually run.
//
// esbuild bundles the .ts graph into one ESM file (resolving the .ts import
// extensions at build time) and leaves real dependencies (ws) + node built-ins
// external, to be required from node_modules at runtime. The output lands at
// dist/cli.js so `import.meta.dirname/../viewer` still resolves to the shipped
// viewer/ directory.
import { build } from "esbuild"
import { chmodSync, readFileSync } from "fs"

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external", // ws + node built-ins stay external (resolved at runtime)
  logLevel: "info",
})

// esbuild preserves the entry file's own `#!/usr/bin/env node` shebang at the
// top of the bundle. Make the bin executable so the npm-installed symlink runs.
chmodSync("dist/cli.js", 0o755)

// Sanity: the bundle must start with exactly one shebang.
const head = readFileSync("dist/cli.js", "utf-8").slice(0, 64)
if (!head.startsWith("#!/usr/bin/env node")) {
  console.error("build: missing shebang in dist/cli.js"); process.exit(1)
}
if (head.indexOf("#!", 2) !== -1) {
  console.error("build: duplicate shebang in dist/cli.js"); process.exit(1)
}

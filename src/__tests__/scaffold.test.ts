import { describe, it, expect } from "bun:test"
import { existsSync } from "fs"

describe("scaffold", () => {
  const requiredPaths = [
    "src/cli.ts",
    "src/server.ts",
    "src/diff-parser.ts",
    "src/anchoring.ts",
    "src/session.ts",
    "src/github.ts",
    "viewer/index.html",
    "viewer/app.js",
    "package.json",
    "tsconfig.json",
  ]

  requiredPaths.forEach(p => {
    it(`${p} exists`, () => {
      expect(existsSync(p)).toBe(true)
    })
  })
})

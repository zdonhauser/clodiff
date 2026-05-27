import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { parseArgs, installHooks } from "../cli"

describe("CLI args", () => {
  it("defaults base to main", () => {
    const args = parseArgs([])
    expect(args.base).toBe("main")
  })

  it("accepts --base flag", () => {
    const args = parseArgs(["--base", "develop"])
    expect(args.base).toBe("develop")
  })

  it("accepts --port flag", () => {
    const args = parseArgs(["--port", "9000"])
    expect(args.port).toBe(9000)
  })

  it("defaults port to 7777", () => {
    const args = parseArgs([])
    expect(args.port).toBe(7777)
  })

  it("accepts --resume flag", () => {
    const args = parseArgs(["--resume"])
    expect(args.resume).toBe(true)
  })

  it("defaults resume to false", () => {
    const args = parseArgs([])
    expect(args.resume).toBe(false)
  })

  it("accepts --stdin flag", () => {
    const args = parseArgs(["--stdin"])
    expect(args.stdin).toBe(true)
  })

  it("defaults stdin to false", () => {
    const args = parseArgs([])
    expect(args.stdin).toBe(false)
  })

  it("accepts --patch flag with path", () => {
    const args = parseArgs(["--patch", "/tmp/my.patch"])
    expect(args.patch).toBe("/tmp/my.patch")
  })

  it("defaults patch to undefined", () => {
    const args = parseArgs([])
    expect(args.patch).toBeUndefined()
  })

  it("accepts --from and --to flags", () => {
    const args = parseArgs(["--from", "abc123", "--to", "def456"])
    expect(args.from).toBe("abc123")
    expect(args.to).toBe("def456")
  })

  it("defaults from and to to undefined", () => {
    const args = parseArgs([])
    expect(args.from).toBeUndefined()
    expect(args.to).toBeUndefined()
  })

  it("accepts --install-hooks flag", () => {
    const args = parseArgs(["--install-hooks"])
    expect(args.installHooks).toBe(true)
  })

  it("defaults installHooks to false", () => {
    const args = parseArgs([])
    expect(args.installHooks).toBe(false)
  })

  it("throws on unknown flag", () => {
    expect(() => parseArgs(["--unknown-flag"])).toThrow("Unknown flag: --unknown-flag")
  })

  it("--port without value throws", () => {
    expect(() => parseArgs(["--port"])).toThrow("--port requires a value")
  })

  it("--base without value throws", () => {
    expect(() => parseArgs(["--base"])).toThrow("--base requires a value")
  })

  it("--port followed by another flag throws", () => {
    expect(() => parseArgs(["--port", "--base"])).toThrow("--port requires a value")
  })

  it("parses port as integer", () => {
    const args = parseArgs(["--port", "8080"])
    expect(args.port).toBe(8080)
    expect(typeof args.port).toBe("number")
  })

  it("handles multiple flags together", () => {
    const args = parseArgs(["--base", "dev", "--port", "3000", "--resume", "--stdin"])
    expect(args.base).toBe("dev")
    expect(args.port).toBe(3000)
    expect(args.resume).toBe(true)
    expect(args.stdin).toBe(true)
  })
})

describe("installHooks", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clodiff-cli-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("preserves existing PreToolUse hook alongside new UserPromptSubmit and SessionStart entries", async () => {
    const settingsDir = join(tmpDir, ".claude")
    await mkdir(settingsDir, { recursive: true })

    const existingSettings = {
      someOtherKey: "value",
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "echo pre-tool-use" }] },
        ],
      },
    }
    await writeFile(join(settingsDir, "settings.json"), JSON.stringify(existingSettings, null, 2))

    await installHooks(tmpDir)

    const raw = await Bun.file(join(settingsDir, "settings.json")).text()
    const result = JSON.parse(raw)

    // Original key preserved
    expect(result.someOtherKey).toBe("value")

    // Pre-existing hook event preserved
    expect(result.hooks.PreToolUse).toBeDefined()
    expect(result.hooks.PreToolUse[0].hooks[0].command).toBe("echo pre-tool-use")

    // New hook events added
    expect(result.hooks.UserPromptSubmit).toBeDefined()
    expect(result.hooks.SessionStart).toBeDefined()
    expect(result.hooks.UserPromptSubmit[0].hooks[0].command).toContain("inject-replies.js")
    expect(result.hooks.SessionStart[0].hooks[0].command).toContain("load-session.js")
  })

  it("appends to existing UserPromptSubmit array instead of replacing it", async () => {
    const settingsDir = join(tmpDir, ".claude")
    await mkdir(settingsDir, { recursive: true })

    const existingSettings = {
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "echo existing-hook" }] },
        ],
      },
    }
    await writeFile(join(settingsDir, "settings.json"), JSON.stringify(existingSettings, null, 2))

    await installHooks(tmpDir)

    const raw = await Bun.file(join(settingsDir, "settings.json")).text()
    const result = JSON.parse(raw)

    expect(Array.isArray(result.hooks.UserPromptSubmit)).toBe(true)
    expect(result.hooks.UserPromptSubmit).toHaveLength(2)
    expect(result.hooks.UserPromptSubmit[0].hooks[0].command).toBe("echo existing-hook")
    expect(result.hooks.UserPromptSubmit[1].hooks[0].command).toContain("inject-replies.js")
  })
})

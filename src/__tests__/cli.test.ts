import { describe, it, expect } from "bun:test"
import { parseArgs } from "../cli"

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

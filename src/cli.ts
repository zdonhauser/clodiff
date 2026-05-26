import { readFile, writeFile, mkdir, copyFile } from "fs/promises"
import { join, dirname } from "path"
import { existsSync } from "fs"

export interface CliArgs {
  base: string
  port: number
  resume: boolean
  stdin: boolean
  patch?: string
  from?: string
  to?: string
  installHooks: boolean
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    base: "main",
    port: 7777,
    resume: false,
    stdin: false,
    installHooks: false,
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]

    if (arg === "--base") {
      args.base = argv[++i]
    } else if (arg === "--port") {
      args.port = parseInt(argv[++i], 10)
    } else if (arg === "--resume") {
      args.resume = true
    } else if (arg === "--stdin") {
      args.stdin = true
    } else if (arg === "--patch") {
      args.patch = argv[++i]
    } else if (arg === "--from") {
      args.from = argv[++i]
    } else if (arg === "--to") {
      args.to = argv[++i]
    } else if (arg === "--install-hooks") {
      args.installHooks = true
    } else if (arg.startsWith("--")) {
      throw new Error("Unknown flag: " + arg)
    }

    i++
  }

  return args
}

export async function installHooks(repoDir: string): Promise<void> {
  const settingsDir = join(repoDir, ".claude")
  const settingsPath = join(settingsDir, "settings.json")

  await mkdir(settingsDir, { recursive: true })

  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    const raw = await readFile(settingsPath, "utf-8")
    settings = JSON.parse(raw)
  }

  const hooksConfig = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "node .review/hooks/inject-replies.js" }] },
      ],
      SessionStart: [
        { hooks: [{ type: "command", command: "node .review/hooks/load-session.js" }] },
      ],
    },
  }

  settings = { ...settings, ...hooksConfig }
  await writeFile(settingsPath, JSON.stringify(settings, null, 2))

  // Copy hook scripts to .review/hooks/
  const hooksTargetDir = join(repoDir, ".review", "hooks")
  await mkdir(hooksTargetDir, { recursive: true })

  // Source hooks are relative to this file's location, in the project root hooks/ dir
  const hooksSourceDir = join(dirname(import.meta.path), "..", "hooks")
  await copyFile(
    join(hooksSourceDir, "inject-replies.js"),
    join(hooksTargetDir, "inject-replies.js")
  )
  await copyFile(
    join(hooksSourceDir, "load-session.js"),
    join(hooksTargetDir, "load-session.js")
  )
}

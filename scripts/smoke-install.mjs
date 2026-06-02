#!/usr/bin/env node
// Packaged-install smoke: prove that the PUBLISHED artifact actually runs the
// way a user installs it. This guards two real defects that the in-repo dev path
// (`node src/cli.ts`) cannot catch:
//   1. shipping a .ts bin — Node won't type-strip files under node_modules, so an
//      installed .ts bin throws ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
//   2. an entry guard that string-compares process.argv[1] to import.meta.url —
//      through the npm bin *symlink* those differ, so main() silently never runs.
//
// So we pack a tarball, install it into a throwaway repo, launch the installed
// bin THROUGH ITS SYMLINK, and require the server to actually come up and serve.
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), "clodiff-smoke-"))
const repo = join(work, "repo")
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let child = null

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf-8", ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout || ""}${r.stderr || ""}`)
  return r.stdout.trim()
}

function fail(msg) {
  console.error("SMOKE FAIL:", msg)
  if (child) child.kill()
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

try {
  // Build + pack the real tarball.
  run("npm", ["run", "build"], { cwd: root })
  run("npm", ["pack", "--pack-destination", work], { cwd: root })
  const tgz = run("node", ["-e", `const fs=require('fs');console.log(fs.readdirSync(${JSON.stringify(work)}).find(f=>f.endsWith('.tgz')))`])
  const tarball = join(work, tgz)

  // A throwaway git repo with an uncommitted change to diff.
  run("git", ["init", "-q", repo])
  run("git", ["-C", repo, "config", "user.email", "smoke@clodiff.dev"])
  run("git", ["-C", repo, "config", "user.name", "smoke"])
  writeFileSync(join(repo, "f.js"), "export const a = 1\n")
  run("git", ["-C", repo, "add", "-A"])
  run("git", ["-C", repo, "commit", "-qm", "init"])
  writeFileSync(join(repo, "f.js"), "export const a = 1\nexport const b = 2\n")

  // Install the packed clodiff into the repo.
  run("npm", ["init", "-y"], { cwd: repo })
  run("npm", ["install", tarball], { cwd: repo })

  // 1) --version through the bin symlink (proves main() runs + module loads).
  const ver = run("node", ["node_modules/.bin/clodiff", "--version"], { cwd: repo })
  if (!/^\d+\.\d+\.\d+/.test(ver)) fail(`--version through bin symlink gave: ${JSON.stringify(ver)}`)
  console.log("ok: clodiff --version ->", ver)

  // 2) start the server through the bin symlink and require it to serve.
  const port = 7836
  const sess = join(repo, ".git", "clodiff", "session.json")
  let log = ""
  child = spawn("node", ["node_modules/.bin/clodiff", "--working", "--port", String(port)], {
    cwd: repo, env: { ...process.env, BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", (d) => (log += d))
  child.stderr.on("data", (d) => (log += d))

  let booted = false
  for (let i = 0; i < 60; i++) {
    await wait(250)
    if (existsSync(sess)) { try { if (JSON.parse(readFileSync(sess, "utf-8")).port) { booted = true; break } } catch {} }
  }
  if (!booted) fail(`server never wrote session.json (the symlink-guard bug). log: ${JSON.stringify(log.trim())}`)

  const init = await fetch(`http://localhost:${port}/init`).then((r) => r.json()).catch((e) => ({ err: e.message }))
  if (!Array.isArray(init.diff)) fail(`/init did not return a diff: ${JSON.stringify(init)}`)
  const html = await fetch(`http://localhost:${port}/`).then((r) => r.text()).catch(() => "")
  if (!html.includes("<!DOCTYPE html")) fail("viewer HTML not served from the shipped viewer/ dir")
  const assetOk = await fetch(`http://localhost:${port}/app.js`).then((r) => r.ok).catch(() => false)
  if (!assetOk) fail("viewer asset app.js not served")

  console.log("ok: installed server boots and serves (port", port + ", files:", init.diff.length + ")")
  child.kill()
  rmSync(work, { recursive: true, force: true })
  console.log("SMOKE PASS")
} catch (err) {
  fail(err.message)
}

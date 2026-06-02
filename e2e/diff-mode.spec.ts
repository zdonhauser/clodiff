import { test, expect } from "./fixtures/server.js"
import { readFileSync, writeFileSync } from "fs"

// The header ref pickers carry stable titles (see RefPicker.js): the "base"
// (from) picker and the "compare" (to) picker.
const basePicker = (page: import("@playwright/test").Page) =>
  page.locator('button[title="Change base ref"]')
const comparePicker = (page: import("@playwright/test").Page) =>
  page.locator('button[title="Change compare ref"]')

test("POST /mode switches the server diff range", async ({ server }) => {
  // Launch range is HEAD~1 -> HEAD (from the fixture).
  const before = await fetch(`http://localhost:${server.port}/init`).then((r) => r.json())
  expect(before.session._from).toBe("HEAD~1")
  expect(before.session._to).toBe("HEAD")

  const res = await fetch(`http://localhost:${server.port}/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "working" }),
  })
  expect(res.status).toBe(200)

  const after = await fetch(`http://localhost:${server.port}/init`).then((r) => r.json())
  expect(after.session._from).toBe("HEAD")
  expect(after.session._to).toBe("WORKING")
})

test("PR mode with no open PR returns a graceful error", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "pr" }),
  })
  expect(res.status).toBe(500)
  expect(await res.text()).toMatch(/No open PR/i)
})

test("mode switch updates the header pickers and survives a session_update", async ({ page, server }) => {
  await page.goto(server.baseURL)

  // Initial range from the fixture: HEAD~1 -> HEAD.
  await expect(basePicker(page)).toHaveText("HEAD~1", { timeout: 15000 })

  // Switch to "working" (HEAD -> working tree) via the mode endpoint; the server
  // broadcasts a fresh init that the viewer applies.
  await fetch(`http://localhost:${server.port}/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "working" }),
  })
  await expect(basePicker(page)).toHaveText("HEAD")
  await expect(comparePicker(page)).toHaveText("working tree")

  // Regression guard: _from/_to are live view-state, never persisted to
  // session.json. A session_update (e.g. an annotation save) reloads the
  // on-disk session — which has no _from/_to — and must NOT clobber the live
  // range back to its defaults. Trigger a session_update by writing session.json.
  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  session.updated_at = new Date().toISOString()
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  // Give the watcher + client a beat to process the session_update.
  await page.waitForTimeout(900)

  // Still on the working-tree range — base is "HEAD", not the default branch.
  await expect(basePicker(page)).toHaveText("HEAD")
  await expect(comparePicker(page)).toHaveText("working tree")
})

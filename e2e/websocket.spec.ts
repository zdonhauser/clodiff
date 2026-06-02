import { test, expect } from "./fixtures/server.js"

test("highlight broadcast adds clodiff-highlight class to the target line", async ({ page, server }) => {
  await page.goto(server.baseURL)
  // Wait for Preact to render file sections
  await page.waitForSelector("[data-file-path='app.ts']", { timeout: 15000 })

  // Files are expanded by default, so the line rows are already present.
  await page.waitForSelector('[data-path="app.ts"]', { timeout: 5000 })

  // Broadcast a highlight event for app.ts line 2 (the added farewell function)
  await fetch(`http://localhost:${server.port}/_ws_broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "highlight", path: "app.ts", line: 2 }),
  })

  // The target line element should gain clodiff-highlight class within ~400ms
  const lineEl = page.locator('[data-path="app.ts"][data-line="2"]')
  await expect(lineEl).toHaveClass(/clodiff-highlight/, { timeout: 5000 })
})

test("scroll_to broadcast does not crash and broadcasts successfully", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  const res = await fetch(`http://localhost:${server.port}/_ws_broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "scroll_to", path: "app.ts", line: 2 }),
  })
  expect(res.status).toBe(200)

  // No JS errors on the page
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.waitForTimeout(500)
  expect(errors).toHaveLength(0)
})

test("rapid-fire highlight broadcasts do not crash the page", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))

  // Send 5 highlights in quick succession
  await Promise.all(
    [1, 2, 1, 2, 1].map((line) =>
      fetch(`http://localhost:${server.port}/_ws_broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "highlight", path: "app.ts", line }),
      }),
    ),
  )

  await page.waitForTimeout(600)
  expect(errors).toHaveLength(0)
})

import { readFileSync, writeFileSync } from "fs"
import { test, expect } from "./fixtures/server.js"

test("viewer page loads and returns 200", async ({ page, server }) => {
  const res = await page.goto(server.baseURL)
  expect(res?.status()).toBe(200)
})

test("diff content is rendered — file sections appear", async ({ page, server }) => {
  await page.goto(server.baseURL)
  // Wait for Preact to render (it loads from CDN). FileSection renders with data-file-path.
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })
  const fileSections = await page.locator("[data-file-path]").count()
  expect(fileSections).toBeGreaterThan(0)
})

test("annotation appears in viewer after session_update broadcast", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  // Write an annotation directly to session.json
  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const review = session.reviews[session.reviews.length - 1]
  review.comments.push({
    id: "e2e-test-comment-1",
    created_at: new Date().toISOString(),
    source: "claude-code",
    body: "e2e annotation: this line looks suspicious",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 2,
    side: "RIGHT",
    line_content: 'export function farewell(name: string)',
    severity: "warning",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  // Trigger session_update via broadcast endpoint
  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/_ws_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_update" }),
    })
  }, server.port)

  // CommentCard renders the body text — wait for it to appear
  await expect(page.getByText("e2e annotation: this line looks suspicious")).toBeVisible({ timeout: 8000 })
})

test("Reply button opens textarea", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  // Pre-load a comment
  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const review = session.reviews[session.reviews.length - 1]
  const commentId = "e2e-reply-test"
  review.comments.push({
    id: commentId,
    created_at: new Date().toISOString(),
    source: "claude-code",
    body: "click reply to respond",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 2,
    side: "RIGHT",
    line_content: "export function farewell",
    severity: "note",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/_ws_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_update" }),
    })
  }, server.port)

  await expect(page.getByText("click reply to respond")).toBeVisible({ timeout: 8000 })

  // Click the Reply button
  await page.getByRole("button", { name: /reply/i }).first().click()

  // Textarea should appear
  await expect(page.locator("textarea")).toBeVisible({ timeout: 4000 })
})

test("submitting a reply writes to replies.json", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const review = session.reviews[session.reviews.length - 1]
  const commentId = "e2e-submit-reply"
  review.comments.push({
    id: commentId,
    created_at: new Date().toISOString(),
    source: "claude-code",
    body: "reply submission test",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 2,
    side: "RIGHT",
    line_content: "export function farewell",
    severity: "note",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/_ws_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_update" }),
    })
  }, server.port)

  await expect(page.getByText("reply submission test")).toBeVisible({ timeout: 8000 })
  await page.getByRole("button", { name: /reply/i }).first().click()
  await page.locator("textarea").fill("great point, will fix")
  // Submit via keyboard (⌘↵) — the submit button is also labeled "Reply" which is ambiguous
  await page.keyboard.press("Meta+Enter")

  // Wait for replies.json to be written
  await page.waitForFunction(
    (path) => {
      try {
        // This runs in node via page.waitForFunction — but we can't use fs here.
        // Use a polling approach via the page instead.
        return true // fallback — verify below
      } catch {
        return false
      }
    },
    server.repliesPath,
    { timeout: 5000 },
  )

  // Verify replies.json was written with our reply
  await page.waitForTimeout(500) // let the POST complete
  const replies = JSON.parse(readFileSync(server.repliesPath, "utf-8"))
  const ourReply = replies.find((r: { comment_id: string }) => r.comment_id === commentId)
  expect(ourReply).toBeDefined()
  expect(ourReply.body).toBe("great point, will fix")
})

test("Fix It button posts 'Fix It' reply and resolves the comment", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const review = session.reviews[session.reviews.length - 1]
  const commentId = "fix-it-test-" + Date.now()
  review.comments.push({
    id: commentId,
    created_at: new Date().toISOString(),
    source: "claude-code",
    body: "this code needs fixing",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 2,
    side: "RIGHT",
    line_content: "export function farewell",
    severity: "error",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/_ws_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_update" }),
    })
  }, server.port)

  await expect(page.getByText("this code needs fixing")).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("button", { name: "Fix It" })).toBeVisible()

  await page.getByRole("button", { name: "Fix It" }).click()

  // Button disappears once comment is resolved
  await expect(page.getByRole("button", { name: "Fix It" })).not.toBeVisible({ timeout: 5000 })

  await page.waitForTimeout(500)
  const replies = JSON.parse(readFileSync(server.repliesPath, "utf-8"))
  const reply = replies.find((r: { comment_id: string }) => r.comment_id === commentId)
  expect(reply?.body).toBe("Fix It")

  const updated = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const comment = updated.reviews
    .flatMap((r: { comments: Array<{ id: string; resolved?: boolean }> }) => r.comments)
    .find((c: { id: string }) => c.id === commentId)
  expect(comment?.resolved).toBe(true)
})

test("Reject button posts 'Rejected' reply and resolves the comment", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const review = session.reviews[session.reviews.length - 1]
  const commentId = "reject-test-" + Date.now()
  review.comments.push({
    id: commentId,
    created_at: new Date().toISOString(),
    source: "claude-code",
    body: "this suggestion should be rejected",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 2,
    side: "RIGHT",
    line_content: "export function farewell",
    severity: "suggestion",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/_ws_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_update" }),
    })
  }, server.port)

  await expect(page.getByText("this suggestion should be rejected")).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("button", { name: "Reject" })).toBeVisible()

  await page.getByRole("button", { name: "Reject" }).click()

  await expect(page.getByRole("button", { name: "Reject" })).not.toBeVisible({ timeout: 5000 })

  await page.waitForTimeout(500)
  const replies = JSON.parse(readFileSync(server.repliesPath, "utf-8"))
  const reply = replies.find((r: { comment_id: string }) => r.comment_id === commentId)
  expect(reply?.body).toBe("Rejected")

  const updated = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const comment = updated.reviews
    .flatMap((r: { comments: Array<{ id: string; resolved?: boolean }> }) => r.comments)
    .find((c: { id: string }) => c.id === commentId)
  expect(comment?.resolved).toBe(true)
})

test("Fix It and Reject buttons do not appear on user-authored comments", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const review = session.reviews[session.reviews.length - 1]
  review.comments.push({
    id: "user-comment-no-actions",
    created_at: new Date().toISOString(),
    source: "user",
    body: "user authored note",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 2,
    side: "RIGHT",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/_ws_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_update" }),
    })
  }, server.port)

  await expect(page.getByText("user authored note")).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("button", { name: "Fix It" })).not.toBeVisible()
  await expect(page.getByRole("button", { name: "Reject" })).not.toBeVisible()
})

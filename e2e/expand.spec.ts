import { test, expect } from "./fixtures/server.js"

const collapseAll = (page: import("@playwright/test").Page) =>
  page.locator('button[title="Collapse all files"]')
const expandAll = (page: import("@playwright/test").Page) =>
  page.locator('button[title="Expand all files"]')

test("all files are expanded by default", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path='app.ts']", { timeout: 15000 })

  // Both changed files in the fixture show their line rows without any clicking.
  await expect(page.locator('[data-path="app.ts"]').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-path="utils.ts"]').first()).toBeVisible()

  // Since everything is expanded, the header offers "Collapse all".
  await expect(collapseAll(page)).toBeVisible()
})

test("the Files-changed header toggles all files collapsed/expanded", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path='app.ts']", { timeout: 15000 })
  await expect(page.locator('[data-path="app.ts"]').first()).toBeVisible({ timeout: 5000 })

  // Collapse all — line rows disappear and the button flips to "Expand all".
  await collapseAll(page).click()
  await expect(page.locator('[data-path="app.ts"]')).toHaveCount(0)
  await expect(page.locator('[data-path="utils.ts"]')).toHaveCount(0)
  await expect(expandAll(page)).toBeVisible()

  // Expand all — rows come back and the button flips to "Collapse all".
  await expandAll(page).click()
  await expect(page.locator('[data-path="app.ts"]').first()).toBeVisible()
  await expect(collapseAll(page)).toBeVisible()
})

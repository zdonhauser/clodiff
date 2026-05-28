import { test, expect } from "./fixtures/server.js"

test("/tree returns array of tracked files", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/tree`)
  expect(res.status).toBe(200)
  const files = await res.json()
  expect(Array.isArray(files)).toBe(true)
  expect(files).toContain("app.ts")
  expect(files).toContain("utils.ts")
})

test("/refs returns an array", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/refs`)
  expect(res.status).toBe(200)
  const refs = await res.json()
  expect(Array.isArray(refs)).toBe(true)
})

test("/file endpoint serves tracked file content", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/file?path=app.ts`)
  expect(res.status).toBe(200)
  const content = await res.text()
  expect(content).toContain("farewell")
})

test("/file rejects path traversal attempts", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/file?path=../../etc/passwd`)
  expect(res.status).toBe(403)
})

test("/file returns 404 for missing files", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/file?path=nonexistent.ts`)
  expect(res.status).toBe(404)
})

test("/session returns the current session JSON", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/session`)
  expect(res.status).toBe(200)
  const session = await res.json()
  expect(session.version).toBe(1)
  expect(typeof session.repo).toBe("string")
  expect(Array.isArray(session.reviews)).toBe(true)
})

test("/init returns diff and session payload", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/init`)
  expect(res.status).toBe(200)
  const payload = await res.json()
  expect(Array.isArray(payload.diff)).toBe(true)
  expect(payload.diff.length).toBeGreaterThan(0)
  expect(payload.diff[0].path).toBeTruthy()
})

test("GET / serves the viewer HTML", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/`)
  expect(res.status).toBe(200)
  const html = await res.text()
  expect(html).toContain("<!DOCTYPE html")
})

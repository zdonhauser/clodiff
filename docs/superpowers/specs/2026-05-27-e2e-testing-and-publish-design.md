# E2E Testing & npm Publish — Design Spec

**Date:** 2026-05-27  
**Status:** Approved

---

## Problem

clodiff has ~113 backend unit/integration tests but zero coverage of the viewer (17 files), zero tests for `github.ts` (the GitHub push flow), and no CI to enforce correctness on changes. The package is not published to npm, so `bunx clodiff` doesn't work yet.

The goal is full confidence: every meaningful user-facing workflow is exercised before the package ships.

---

## Architecture

Three test layers:

| Layer | Location | Runner | What it covers |
|---|---|---|---|
| Unit / integration | `src/__tests__/` | `bun test` | Logic, HTTP endpoints, session I/O (existing + github.ts) |
| Browser E2E | `e2e/` | Playwright | Viewer rendering, annotation flow, WebSocket real-time, component interactions |
| CI | `.github/workflows/` | GitHub Actions | Both layers on every push/PR; publish on version tags |

---

## Section 1: github.ts unit tests

**New file:** `src/__tests__/github.test.ts`

A fake `gh` shell script is created in a temp directory and prepended to `PATH` before each test. The script handles:
- `gh auth status` → exit 0
- `gh pr view --json number,headRefName` → fixture JSON with PR number + branch
- `gh api .../pulls/.../reviews` (POST) → 200 response JSON

The fake script appends every invocation (argv + stdin) to a temp log file so tests can assert what was called with what arguments.

**Tests:**
- `checkAuth()` — returns true when `gh auth status` exits 0; false when it exits 1
- `findOpenPR()` — parses PR number and branch from fixture JSON
- `buildReviewPayload()` — pure function, no CLI; asserts correct GitHub review shape from a session fixture
- `pushReview()` — full path: calls `checkAuth` → `findOpenPR` → `buildReviewPayload` → `gh api`; asserts log shows correct endpoint and payload body

---

## Section 2: Playwright E2E

**Dependencies:**
```
bun add -D @playwright/test
```

**Config:** `playwright.config.ts` at repo root. Uses `webServer` to start the clodiff server before tests; all tests share one server instance per worker.

**Shared fixture:** `e2e/fixtures/server.ts`
- Creates a temp git repo with two commits (adds a file in commit 1, modifies it in commit 2)
- Starts `bun run src/cli.ts --from HEAD~1 --to HEAD --port 0 --resume` (port 0 = OS-assigned)
- Reads the assigned port from `.review/session.json`
- Yields `{ port, sessionPath, repoDir }` to each test
- Tears down (kill server, rm temp dir) after each test

**Test files:**

### `e2e/review-flow.spec.ts` — core happy path

1. Server starts, viewer loads (`GET /`) returns 200
2. Diff is rendered — at least one file section appears in DOM
3. Write an annotation directly to `session.json` (same pattern as review skill)
4. POST `/_ws_broadcast scroll_to` → page scrolls (verify active element or scroll position changes)
5. CommentCard appears in the viewer with correct body text and severity badge
6. User clicks Reply → textarea appears
7. User types reply + submits → `replies.json` is written with correct `comment_id`

### `e2e/websocket.spec.ts` — real-time events

1. POST `/_ws_broadcast { type: "scroll_to", path, line }` → verify DOM scrolls to that file section
2. POST `/_ws_broadcast { type: "highlight", path, line }` → verify the target line row has the amber highlight class
3. Rapid-fire 5 `scroll_to` broadcasts → no crash, last one wins

### `e2e/viewer.spec.ts` — component interactions

1. **RefPicker** — `GET /refs` returns branch list; clicking RefPicker shows branch options
2. **File sidebar** — clicking a filename in FileSidebar scrolls the main view to that file
3. **Settings panel** — toggle opens/closes without error
4. **File tree** — `GET /tree` endpoint returns files; verify response structure

---

## Section 3: CI/CD

### `.github/workflows/ci.yml`

Runs on every push and pull_request:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test
      - run: bunx playwright install --with-deps chromium
      - run: bunx playwright test
```

### `.github/workflows/release.yml`

Runs on version tags (`v*`):

```yaml
name: Release
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test
      - run: bun publish --access public
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Requires `NPM_TOKEN` set in repo Settings → Secrets.

---

## Section 4: package.json + README updates

**`package.json` additions:**
```json
"files": ["src", "viewer", "README.md"],
"engines": { "bun": ">=1.0.0" }
```

This excludes `src/__tests__/`, `e2e/`, `docs/`, `.review/`, `.github/`, `playwright.config.ts` from the published package.

**README:** Remove `npx clodiff` (Node can't run `.ts` + Bun-specific APIs). Replace with:
```markdown
Requires [Bun](https://bun.sh). Run without installing:

    bunx clodiff

Or install globally:

    bun add -g clodiff
    clodiff
```

**First publish:** Done manually (`bun publish --access public` from local machine) since `NPM_TOKEN` isn't configured yet. Subsequent releases go through the tag workflow.

---

## Verification

1. `bun test` — all existing + new `github.test.ts` pass
2. `bunx playwright test` — all 4 E2E specs pass locally (headed optional)
3. Push to GitHub → CI workflow runs green
4. `bun publish --dry-run` → confirm `viewer/` and `src/` included, `__tests__/` and `e2e/` excluded
5. `bunx clodiff@latest` in a fresh temp directory → server starts, browser opens

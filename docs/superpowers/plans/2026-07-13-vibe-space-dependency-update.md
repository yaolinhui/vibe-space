# Vibe Space Dependency Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Vibe Space from deprecated `xterm` package names to actively maintained `@xterm/*` scoped packages, lock dependencies in version control, and add automated security auditing via GitHub Actions.

**Architecture:** Keep the public URL paths (`/xterm/*`, `/xterm-addon-fit/*`, `/xterm-css/*`) unchanged so the browser/PWA code continues to work without modification. Only change the server-side static file mappings so they resolve from the new `@xterm` package directories in `node_modules`. Add a CI workflow that runs `npm audit` on every push/PR and weekly.

**Tech Stack:** Node.js 18+, npm, Express 5, xterm.js 6, GitHub Actions

## Global Constraints

- Node.js engine floor: `>=18.0.0` (from `package.json`)
- Must not break existing browser URL paths `/xterm/xterm.js`, `/xterm-addon-fit/xterm-addon-fit.js`, `/xterm-css/xterm.css`
- `npm audit` must report zero vulnerabilities after migration
- `npm test` must pass after migration
- Package-lock must be reproducible and committed
- Commits follow conventional style used in repo (`deps:`, `ci:`, `chore:`)

---

## File Map

| File | Responsibility | Change |
|---|---|---|
| `package.json` | Dependency declarations and npm metadata | Replace `xterm` deps with `@xterm/*` equivalents; add `package-lock.json` to `files` |
| `package-lock.json` | Locked dependency tree | Regenerate and commit |
| `.gitignore` | Ignore patterns | Remove `package-lock.json` so it is tracked |
| `server.js` | Express static file routes | Update 3 static routes to point to new `node_modules/@xterm/*` paths |
| `public/index.html` | Frontend script tags | No path changes required (keeps `/xterm/*` URLs) |
| `public/sw.js` | Service worker precache list | No path changes required (keeps `/xterm/*` URLs) |
| `public/client.js` | xterm Terminal/FitAddon usage | Verify globals `window.Terminal` and `window.FitAddon` still work; adjust if API changed |
| `.github/workflows/security-audit.yml` | CI workflow | New file; runs `npm audit` on push, PR, and weekly schedule |

---

## Task 1: Replace xterm dependencies in package.json

**Files:**
- Modify: `package.json:44-50`

**Interfaces:**
- Consumes: nothing
- Produces: updated dependency list that `npm install` resolves to `@xterm/*` packages

- [ ] **Step 1: Edit dependencies block**

Replace the `dependencies` entries for xterm packages:

```json
"dependencies": {
  "express": "^5.2.1",
  "node-pty": "^1.1.0",
  "ws": "^8.21.0",
  "@xterm/xterm": "^6.0.0",
  "@xterm/addon-fit": "^0.11.0"
},
```

Remove `xterm`, `xterm-addon-fit`, and `xterm-addon-web-links` from dependencies.

> Note: `xterm-addon-web-links` is not used by the application (no import/reference in HTML or client code), so it is dropped rather than migrated.

- [ ] **Step 2: Add package-lock.json to published files**

In `package.json`, update the `files` array:

```json
"files": [
  "bin/",
  "public/",
  "server.js",
  "config.example.json",
  "package-lock.json",
  "README.md",
  "LICENSE"
],
```

- [ ] **Step 3: Commit the package.json changes**

```bash
git add package.json
git commit -m "deps: migrate xterm packages to @xterm scoped names"
```

---

## Task 2: Update server.js static routes

**Files:**
- Modify: `server.js:684-686`

**Interfaces:**
- Consumes: `package.json` dependencies now point to `@xterm/*`
- Produces: Express routes `/xterm/*`, `/xterm-addon-fit/*`, `/xterm-css/*` still serve the same browser files but from new disk locations

- [ ] **Step 1: Locate the static routes**

Open `server.js` around line 684. The existing routes are:

```javascript
app.use('/xterm', express.static(path.join(__dirname, 'node_modules', 'xterm', 'lib')));
app.use('/xterm-addon-fit', express.static(path.join(__dirname, 'node_modules', 'xterm-addon-fit', 'lib')));
app.use('/xterm-css', express.static(path.join(__dirname, 'node_modules', 'xterm', 'css')));
```

- [ ] **Step 2: Update to new package paths**

Replace with:

```javascript
app.use('/xterm', express.static(path.join(__dirname, 'node_modules', '@xterm', 'xterm', 'lib')));
app.use('/xterm-addon-fit', express.static(path.join(__dirname, 'node_modules', '@xterm', 'addon-fit', 'lib')));
app.use('/xterm-css', express.static(path.join(__dirname, 'node_modules', '@xterm', 'xterm', 'css')));
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "chore: update static file routes for @xterm packages"
```

---

## Task 3: Allow package-lock.json to be tracked

**Files:**
- Modify: `.gitignore:3`
- Create: `package-lock.json` (via `npm install` in Task 4)

**Interfaces:**
- Consumes: `.gitignore` currently excludes `package-lock.json`
- Produces: `package-lock.json` will be tracked by git

- [ ] **Step 1: Remove package-lock.json from .gitignore**

Edit `.gitignore` and delete or comment out this line:

```text
# package-lock.json
```

Keep the other lock files ignored (`yarn.lock`, `pnpm-lock.yaml`).

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: track package-lock.json for reproducible installs"
```

---

## Task 4: Install new dependencies and verify

**Files:**
- Create: `package-lock.json`
- Modify: `node_modules/` (local only, not committed)

**Interfaces:**
- Consumes: updated `package.json` and `.gitignore`
- Produces: fresh `package-lock.json` reflecting `@xterm/*` packages; runtime verified

- [ ] **Step 1: Remove old node_modules and lock file**

```bash
rm -rf node_modules package-lock.json
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

Expected: installs without errors; `node_modules/@xterm/xterm` and `node_modules/@xterm/addon-fit` exist.

- [ ] **Step 3: Run security audit**

```bash
npm audit
```

Expected output: `found 0 vulnerabilities`

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Verify static files are served from new paths**

Start the server briefly and curl the three endpoints:

```bash
node server.js --no-open --port=19988 &
SERVER_PID=$!
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:19988/xterm/xterm.js
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:19988/xterm-addon-fit/xterm-addon-fit.js
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:19988/xterm-css/xterm.css
kill $SERVER_PID
```

Expected: all three return `200`.

- [ ] **Step 6: Commit package-lock.json**

```bash
git add package-lock.json
git commit -m "chore: regenerate package-lock.json with @xterm dependencies"
```

---

## Task 5: Verify frontend xterm globals still work

**Files:**
- Read-only: `public/client.js:1180-1200`, `public/client.js:3430-3450`
- Modify (if needed): `public/client.js`

**Interfaces:**
- Consumes: xterm 6.x global objects `window.Terminal` and `window.FitAddon`
- Produces: no changes if globals are unchanged; otherwise minimal updates to constructor/addon usage

- [ ] **Step 1: Check current Terminal instantiation**

In `public/client.js` around line 1186:

```javascript
const term = new Terminal({
  fontSize: config.theme.fontSize,
  theme: termTheme,
  cursorBlink: true,
  scrollback: config.theme.scrollback || 1000,
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
```

If xterm 6.x changed the global name (e.g. `window.Terminal` becomes `window.xterm.Terminal`), update accordingly. For `@xterm/xterm` 6.x, the UMD bundle still exposes `window.Terminal` and `window.FitAddon`, so usually no change is needed.

- [ ] **Step 2: Run a manual browser smoke test**

```bash
npm start
```

Open `http://localhost:9988/workspace`, add a project, and confirm:
1. Terminal pane renders text
2. Resizing the pane triggers fit (font/layout adjusts)
3. Focus/blur between panes works

If anything fails, inspect the browser console for xterm errors and adjust `public/client.js` minimally.

- [ ] **Step 3: Commit any client fixes**

If no changes were needed:

```bash
git status   # confirm public/client.js is clean
```

If changes were needed:

```bash
git add public/client.js
git commit -m "fix: adapt client xterm usage for @xterm/xterm 6.x"
```

---

## Task 6: Add GitHub Actions security audit workflow

**Files:**
- Create: `.github/workflows/security-audit.yml`

**Interfaces:**
- Consumes: `package.json`, `package-lock.json`
- Produces: CI check that fails the build if `npm audit` finds vulnerabilities

- [ ] **Step 1: Create the workflow directory and file**

```bash
mkdir -p .github/workflows
```

Write `.github/workflows/security-audit.yml`:

```yaml
name: Security Audit

on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]
  schedule:
    # Run every Monday at 06:00 UTC
    - cron: '0 6 * * 1'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run security audit
        run: npm audit --audit-level=moderate

      - name: Run tests
        run: npm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/security-audit.yml
git commit -m "ci: add scheduled npm audit workflow"
```

---

## Task 7: Push changes to GitHub

**Files:**
- None (git push)

**Interfaces:**
- Consumes: all previous commits
- Produces: updated `master` branch on remote

- [ ] **Step 1: Review the final diff**

```bash
git log --oneline -10
git status
```

Ensure the working tree is clean except for ignored runtime files (`daemon.pid`, `config.json`, etc.).

- [ ] **Step 2: Push to origin**

```bash
git push origin master
```

Expected: pushes successfully. The remote will now have the dependency migration, tracked lock file, and CI workflow.

- [ ] **Step 3: Verify CI badge (optional)**

After push, GitHub Actions should trigger. Check the Actions tab to confirm the security audit workflow runs without errors.

---

## Self-Review

1. **Spec coverage:**
   - Migrate `xterm` → `@xterm/*`: Tasks 1, 2, 4, 5
   - Track `package-lock.json`: Tasks 1, 3, 4
   - Add CI security audit: Task 6
   - Verify with `npm install`, `npm audit`, `npm test`: Task 4
   - Push to GitHub: Task 7

2. **Placeholder scan:**
   - No TBD/TODO left.
   - All code blocks contain concrete content.
   - Exact file paths and line ranges are provided.

3. **Type consistency:**
   - Routes keep the same browser-facing URL paths.
   - Global names `Terminal` and `FitAddon` are assumed consistent with xterm 6.x UMD build; Task 5 includes a smoke-test fallback if they changed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-vibe-space-dependency-update.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach would you like?

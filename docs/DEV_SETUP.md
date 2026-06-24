# 🛠️ Dev Setup Guide — Zoo Code Fork

> Complete setup from zero to working dev environment.

---

## Prerequisites

| Tool | Required Version | Install |
|------|-----------------|---------|
| Node.js | **20.20.2** (exact) | https://nodejs.org or `nvm use` |
| pnpm | **10.8.1** (exact) | `npm install -g pnpm@10.8.1` |
| Git | Latest | https://git-scm.com |
| Git LFS | Latest | `git lfs install` |
| VS Code | Latest | https://code.visualstudio.com |

---

## Step 1 — Clone (Already Done ✅)

```bash
# Full clone (no shallow)
git clone https://github.com/hacker-b2k/Zoo-Code.git
cd Zoo-Code

# Add upstream for syncing
git remote add upstream https://github.com/Zoo-Code-Org/Zoo-Code.git

# Verify
git remote -v
# origin    https://github.com/hacker-b2k/Zoo-Code.git
# upstream  https://github.com/Zoo-Code-Org/Zoo-Code.git
```

---

## Step 2 — Install Dependencies

```bash
pnpm install
```

This runs `scripts/bootstrap.mjs` automatically which handles all package setup.

---

## Step 3 — Build All Packages

```bash
pnpm build
```

Build order (handled automatically by Turborepo):
1. `@roo-code/types`
2. `@roo-code/ipc`, `@roo-code/core`, `@roo-code/cloud`, `@roo-code/telemetry`
3. `webview-ui` + `src` (parallel)

---

## Step 4 — Run Tests

```bash
pnpm test           # all tests
pnpm check-types    # TypeScript check only
pnpm lint           # ESLint check only
```

---

## Step 5 — Build the Extension (.vsix)

```bash
pnpm vsix           # builds installable extension
```

Output: `src/zoo-code-<version>.vsix`

---

## Step 6 — Install & Test in VS Code

```bash
pnpm install:vsix   # builds + installs into VS Code automatically
```

Or manually: VS Code → Extensions → `...` → Install from VSIX → select the file.

---

## Development Workflow

```bash
# 1. Sync with upstream before starting any work
git fetch upstream
git merge upstream/main

# 2. Create feature branch
git checkout -b feature/your-feature-name

# 3. Write your plan (REQUIRED)
# Create: docs/plans/your-feature-name.md

# 4. Make changes, then verify
pnpm check-types
pnpm test
pnpm lint

# 5. Commit with proper message format
git add src/path/to/changed/file.ts
git commit -m "feat(scope): description"

# 6. Push
git push -u origin feature/your-feature-name
```

---

## Keeping Fork Updated

```bash
# Sync fork's main with upstream
gh repo sync hacker-b2k/Zoo-Code --source Zoo-Code-Org/Zoo-Code --branch main

# Pull to local
git pull origin main
```

---

## Common Issues

### pnpm version mismatch
```bash
npm install -g pnpm@10.8.1
```

### Node version mismatch
```bash
nvm install 20.20.2
nvm use 20.20.2
```

### Build fails after changing @roo-code/types
```bash
pnpm clean
pnpm build
```

### Test fails due to missing mock
Check existing mocks in `src/**/__mocks__/` and `webview-ui/src/__mocks__/`.

---

*Last updated: 2026-06-24*

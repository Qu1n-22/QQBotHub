# Public Release Sanitizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a script that scans a small whitelist of files for sensitive content, writes sanitized copies into `publish/`, updates `.gitignore` for untracked sensitive source files, and can optionally stage the safe outputs.

**Architecture:** Keep the CLI entrypoint in `scripts/prepare-public-release.js`, but move the core logic into testable functions in the same module. The script loads a root config file, collects only whitelisted paths, applies built-in and custom replacement rules, writes sanitized copies into `publish/`, updates `.gitignore`, and returns a structured report that the CLI prints.

**Tech Stack:** Node.js ESM, built-in `node:test`, native `fs/promises`, Git CLI via `child_process`.

---

### Task 1: Add Failing Tests For Core Sanitizer Behavior

**Files:**
- Create: `test/prepare-public-release.test.js`

- [ ] **Step 1: Write the failing test file**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

import {
  runPublicReleasePreparation
} from '../scripts/prepare-public-release.js'

test('creates sanitized publish copies and updates ignore for untracked sensitive files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'public-release-'))
  await fs.mkdir(path.join(root, 'config'), { recursive: true })
  await fs.writeFile(path.join(root, '.gitignore'), '')
  await fs.writeFile(path.join(root, 'README.md'), 'token=abc123')
  await fs.writeFile(path.join(root, 'config', 'message.yaml'), 'chatApiKey: sk-secret-value')
  await fs.writeFile(path.join(root, 'public-release.config.json'), JSON.stringify({ extraFiles: [], customRules: [] }, null, 2))

  const result = await runPublicReleasePreparation({
    rootDir: root,
    dryRun: false,
    stage: false,
    git: {
      isTracked: async file => file === 'README.md',
      stagePaths: async () => ({ attempted: false })
    }
  })

  const publishMessage = await fs.readFile(path.join(root, 'publish', 'config', 'message.yaml'), 'utf8')
  const publishReadme = await fs.readFile(path.join(root, 'publish', 'README.md'), 'utf8')
  const gitignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8')

  assert.equal(result.hitFiles.length, 2)
  assert.match(publishMessage, /sk-xxxxx/)
  assert.match(publishReadme, /your_token_here/)
  assert.match(gitignore, /config\/message\.yaml/)
  assert.equal(result.trackedSensitiveFiles.includes('README.md'), true)
  assert.equal(result.ignoredOriginalFiles.includes('README.md'), false)
})

test('dry run reports matches without writing files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'public-release-dry-'))
  await fs.mkdir(path.join(root, 'config'), { recursive: true })
  await fs.writeFile(path.join(root, '.gitignore'), '')
  await fs.writeFile(path.join(root, 'config', 'message.yaml'), 'token: abc123')
  await fs.writeFile(path.join(root, 'public-release.config.json'), JSON.stringify({ extraFiles: [], customRules: [] }, null, 2))

  const result = await runPublicReleasePreparation({
    rootDir: root,
    dryRun: true,
    stage: false,
    git: {
      isTracked: async () => false,
      stagePaths: async () => ({ attempted: false })
    }
  })

  await assert.rejects(fs.access(path.join(root, 'publish', 'config', 'message.yaml')))
  assert.equal(result.hitFiles.length, 1)
})

test('stage option asks git layer to stage safe outputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'public-release-stage-'))
  await fs.mkdir(path.join(root, 'config'), { recursive: true })
  await fs.writeFile(path.join(root, '.gitignore'), '')
  await fs.writeFile(path.join(root, 'config', 'message.yaml'), 'chatApiKey: sk-stage-value')
  await fs.writeFile(path.join(root, 'public-release.config.json'), JSON.stringify({ extraFiles: [], customRules: [] }, null, 2))

  let staged = null
  await runPublicReleasePreparation({
    rootDir: root,
    dryRun: false,
    stage: true,
    git: {
      isTracked: async () => false,
      stagePaths: async pathsToStage => {
        staged = pathsToStage
        return { attempted: true, success: true }
      }
    }
  })

  assert.deepEqual(staged, ['publish', '.gitignore', 'public-release.config.json'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/prepare-public-release.test.js`
Expected: FAIL because `scripts/prepare-public-release.js` does not yet export `runPublicReleasePreparation`

- [ ] **Step 3: Commit**

```bash
git add test/prepare-public-release.test.js
git commit -m "test: add failing tests for public release sanitizer"
```

### Task 2: Implement Minimal Sanitizer Script And Config

**Files:**
- Create: `scripts/prepare-public-release.js`
- Create: `public-release.config.json`

- [ ] **Step 1: Write the minimal implementation to satisfy the tests**

Implementation must include:

```js
export async function runPublicReleasePreparation(options = {}) {
  // load config
  // collect whitelist files
  // sanitize matching files
  // write publish copies when not dry-run
  // update .gitignore for untracked source files
  // optionally stage publish outputs
  // return structured report
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // parse --dry-run and --stage
  // call runPublicReleasePreparation
  // print summary
}
```

Default config file content:

```json
{
  "extraFiles": [],
  "customRules": []
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test test/prepare-public-release.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/prepare-public-release.js public-release.config.json
git commit -m "feat: add public release sanitizer script"
```

### Task 3: Wire The Script Into Package Metadata And Ignore Rules

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add a package script and publish ignore entry**

Package script to add:

```json
"prepare:public-release": "node scripts/prepare-public-release.js"
```

Ignore entry to add:

```gitignore
publish/
```

- [ ] **Step 2: Run targeted tests again**

Run: `node --test test/prepare-public-release.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: wire public release sanitizer command"
```

### Task 4: Execute The Script In This Repository

**Files:**
- Read: `config/`
- Read: `README.md`
- Read: `public-release.config.json`
- Generate: `publish/**`

- [ ] **Step 1: Run a dry-run first**

Run: `node scripts/prepare-public-release.js --dry-run`
Expected: printed report listing matched files without writing `publish/`

- [ ] **Step 2: Run the real export with staging**

Run: `node scripts/prepare-public-release.js --stage`
Expected: `publish/` created, safe files written, `.gitignore` updated for untracked sensitive files, safe outputs staged

- [ ] **Step 3: Inspect Git state**

Run: `git status --short`
Expected: staged `publish/`, `.gitignore`, `public-release.config.json`, script, tests, and package metadata changes; no accidental staging of sensitive source files

- [ ] **Step 4: Commit**

```bash
git add scripts/prepare-public-release.js test/prepare-public-release.test.js public-release.config.json package.json .gitignore publish
git commit -m "feat: add public release sanitization workflow"
```

### Task 5: Verify And Push To User Repository

**Files:**
- Read: repository status

- [ ] **Step 1: Run final verification**

Run:

```bash
node --test test/prepare-public-release.test.js
git status --short
git remote -v
```

Expected:

- test suite passes
- only intended files are staged/committed
- `origin` points to `https://github.com/Qu1n-22/QQBotHub.git`

- [ ] **Step 2: Push to user repository**

Run: `git push -u origin main`
Expected: push succeeds and branch tracks `origin/main`


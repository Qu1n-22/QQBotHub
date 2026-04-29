import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

import {
  createGitHelpers,
  runPublicReleasePreparation
} from '../scripts/prepare-public-release.js'

async function createTempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('creates sanitized publish copies and updates ignore for untracked sensitive files', async () => {
  const root = await createTempRoot('public-release-')
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
      stagePaths: async () => ({ attempted: false, success: false })
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
  const root = await createTempRoot('public-release-dry-')
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
      stagePaths: async () => ({ attempted: false, success: false })
    }
  })

  await assert.rejects(fs.access(path.join(root, 'publish', 'config', 'message.yaml')))
  assert.equal(result.hitFiles.length, 1)
})

test('stage option asks git layer to stage safe outputs', async () => {
  const root = await createTempRoot('public-release-stage-')
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

test('default git helper force-adds ignored publish output', async () => {
  const calls = []
  const git = createGitHelpers('/tmp/repo', async (command, args, options) => {
    calls.push({ command, args, options })
    return { stdout: '', stderr: '' }
  })

  const result = await git.stagePaths(['publish', '.gitignore', 'public-release.config.json'])

  assert.equal(result.success, true)
  assert.deepEqual(calls, [
    {
      command: 'git',
      args: ['add', '-f', 'publish', '.gitignore', 'public-release.config.json'],
      options: { cwd: '/tmp/repo' }
    }
  ])
})

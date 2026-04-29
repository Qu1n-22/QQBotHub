import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)

const DEFAULT_CONFIG = {
  extraFiles: [],
  customRules: []
}

const DEFAULT_RULE_DEFS = [
  {
    name: 'authorization-bearer',
    pattern: /(Authorization\s*[:=]\s*["']?Bearer\s+)([^"'\s,}]+)/gi,
    replacement: '$1your_token_here'
  },
  {
    name: 'cookie-header',
    pattern: /(Cookie\s*[:=]\s*["']?)([^"'\r\n]+)/gi,
    replacement: '$1your_cookie_here'
  },
  {
    name: 'openai-style-key',
    pattern: /((?:api(?:key)?|chatApiKey|toolsAiApikey|trackAiApikey|memoryAiApikey|embeddingApiKey|imageEditApiKey|analysisApiKey|searchApiKey)\s*[:=]\s*["']?)sk-[A-Za-z0-9_-]+/gi,
    replacement: '$1sk-xxxxx'
  },
  {
    name: 'generic-token-assignment',
    pattern: /((?:token|accessToken|refreshToken|secret)\s*[:=]\s*["']?)([^"'\s,}]+)/gi,
    replacement: '$1your_token_here'
  },
  {
    name: 'password-assignment',
    pattern: /((?:password)\s*[:=]\s*["']?)([^"'\s,}]+)/gi,
    replacement: '$1your_password_here'
  },
  {
    name: 'cookie-assignment',
    pattern: /((?:cookie)\s*[:=]\s*["']?)([^"'\r\n]+)/gi,
    replacement: '$1your_cookie_here'
  },
  {
    name: 'qq-number-label',
    pattern: /((?:qq号|QQ号)\s*[:：]?\s*)(\d{5,12})/g,
    replacement: '$1示例QQ号'
  },
  {
    name: 'group-number-label',
    pattern: /((?:群号|群组ID|群组)\s*[:：]?\s*)(\d{5,12})/g,
    replacement: '$1示例群号'
  }
]

function normalizeRelative(filePath) {
  return filePath.split(path.sep).join('/')
}

function buildCustomRule(rule, index) {
  if (!rule || typeof rule.pattern !== 'string' || typeof rule.replacement !== 'string') {
    throw new Error(`Invalid custom rule at index ${index}`)
  }

  return {
    name: rule.name || `custom-${index}`,
    pattern: new RegExp(rule.pattern, rule.flags || 'g'),
    replacement: rule.replacement
  }
}

function buildRules(customRules = []) {
  return [
    ...DEFAULT_RULE_DEFS,
    ...customRules.map(buildCustomRule)
  ]
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function collectFiles(dirPath, rootDir) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath, rootDir))
    } else if (entry.isFile()) {
      files.push(normalizeRelative(path.relative(rootDir, fullPath)))
    }
  }

  return files
}

async function loadConfig(rootDir) {
  const configPath = path.join(rootDir, 'public-release.config.json')
  if (!await pathExists(configPath)) {
    return { ...DEFAULT_CONFIG }
  }

  const raw = await fs.readFile(configPath, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    extraFiles: Array.isArray(parsed.extraFiles) ? parsed.extraFiles : [],
    customRules: Array.isArray(parsed.customRules) ? parsed.customRules : []
  }
}

function applyRules(content, rules) {
  let sanitized = content
  let matched = false

  for (const rule of rules) {
    const next = sanitized.replace(rule.pattern, rule.replacement)
    if (next !== sanitized) {
      matched = true
      sanitized = next
    }
  }

  return { matched, sanitized }
}

async function ensureParentDir(targetFile) {
  await fs.mkdir(path.dirname(targetFile), { recursive: true })
}

async function appendIgnoreEntries(ignorePath, entries) {
  let current = ''
  if (await pathExists(ignorePath)) {
    current = await fs.readFile(ignorePath, 'utf8')
  }

  const existing = new Set(
    current
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
  )

  const toAppend = entries.filter(entry => !existing.has(entry))
  if (toAppend.length === 0) {
    return []
  }

  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  const body = `${prefix}${toAppend.join('\n')}\n`
  await fs.writeFile(ignorePath, `${current}${body}`, 'utf8')
  return toAppend
}

export function createGitHelpers(rootDir, execFileFn = execFileAsync) {
  return {
    async isTracked(relativePath) {
      try {
        await execFileFn('git', ['ls-files', '--error-unmatch', relativePath], { cwd: rootDir })
        return true
      } catch {
        return false
      }
    },
    async stagePaths(pathsToStage) {
      await execFileFn('git', ['add', '-f', ...pathsToStage], { cwd: rootDir })
      return { attempted: true, success: true }
    }
  }
}

function unique(list) {
  return [...new Set(list)]
}

async function collectCandidateFiles(rootDir, extraFiles, warnings) {
  const files = []
  const readmePath = path.join(rootDir, 'README.md')
  if (await pathExists(readmePath)) {
    files.push('README.md')
  }

  const configPath = path.join(rootDir, 'config')
  if (await pathExists(configPath)) {
    files.push(...await collectFiles(configPath, rootDir))
  }

  for (const extraFile of extraFiles) {
    const normalized = normalizeRelative(extraFile)
    const fullPath = path.join(rootDir, normalized)
    if (await pathExists(fullPath)) {
      files.push(normalized)
    } else {
      warnings.push(`extra file not found: ${normalized}`)
    }
  }

  return unique(files)
}

export async function runPublicReleasePreparation(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd())
  const dryRun = Boolean(options.dryRun)
  const stage = Boolean(options.stage)
  const git = options.git || createGitHelpers(rootDir)
  const warnings = []

  const config = await loadConfig(rootDir)
  const rules = buildRules(config.customRules)
  const candidateFiles = await collectCandidateFiles(rootDir, config.extraFiles, warnings)

  const report = {
    rootDir,
    scannedFiles: candidateFiles,
    hitFiles: [],
    publishFiles: [],
    ignoredOriginalFiles: [],
    trackedSensitiveFiles: [],
    warnings,
    stageResult: { attempted: false, success: false }
  }

  const pendingIgnoreEntries = []

  for (const relativeFile of candidateFiles) {
    const sourcePath = path.join(rootDir, relativeFile)
    const content = await fs.readFile(sourcePath, 'utf8')
    const { matched, sanitized } = applyRules(content, rules)
    if (!matched) {
      continue
    }

    report.hitFiles.push(relativeFile)
    const publishRelative = normalizeRelative(path.join('publish', relativeFile))
    report.publishFiles.push(publishRelative)

    const tracked = await git.isTracked(relativeFile)
    if (tracked) {
      report.trackedSensitiveFiles.push(relativeFile)
    } else {
      pendingIgnoreEntries.push(relativeFile)
    }

    if (!dryRun) {
      const targetPath = path.join(rootDir, publishRelative)
      await ensureParentDir(targetPath)
      await fs.writeFile(targetPath, sanitized, 'utf8')
    }
  }

  if (!dryRun) {
    const ignorePath = path.join(rootDir, '.gitignore')
    report.ignoredOriginalFiles = await appendIgnoreEntries(ignorePath, unique(pendingIgnoreEntries))
  }

  if (!dryRun && stage) {
    report.stageResult = await git.stagePaths(['publish', '.gitignore', 'public-release.config.json'])
  }

  return report
}

function formatReport(report) {
  const lines = [
    '[public-release] done',
    `scanned: ${report.scannedFiles.length}`,
    `matched: ${report.hitFiles.length}`
  ]

  if (report.publishFiles.length > 0) {
    lines.push(`publish files: ${report.publishFiles.join(', ')}`)
  }

  if (report.ignoredOriginalFiles.length > 0) {
    lines.push(`ignored originals: ${report.ignoredOriginalFiles.join(', ')}`)
  }

  if (report.trackedSensitiveFiles.length > 0) {
    lines.push(`tracked sensitive files: ${report.trackedSensitiveFiles.join(', ')}`)
  }

  if (report.warnings.length > 0) {
    lines.push(`warnings: ${report.warnings.join(' | ')}`)
  }

  return lines.join('\n')
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run')
  const stage = argv.includes('--stage')
  const report = await runPublicReleasePreparation({ dryRun, stage })
  console.log(formatReport(report))
}

const entryArg = process.argv[1]
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  main().catch(error => {
    console.error('[public-release] failed')
    console.error(error.message)
    process.exitCode = 1
  })
}

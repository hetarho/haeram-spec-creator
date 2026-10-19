import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inspectWorkspace, git } from './workspace.mjs'
import { readTaskBoard } from './task-board.mjs'
import { decisionBlocks, sections, tableRows } from './spec-format.mjs'
import { SkillPackageError } from './errors.mjs'

// Extract only explicitly labelled tiers. Conditional prose remains guidance, never
// a shell command. In particular, ARCH-30's example Chromium invocation needs paths.
export function verificationTiers(markdown) {
  const result = { task: [], batch: [], ci: [], guidance: [], declared: false }
  let tier = null, relevant = false
  const labels = new Set()
  for (const line of sections(markdown).get('decisions') ?? []) {
    if (/^- /.test(line)) { tier = null; relevant = /\b(verification|verify|checks|testing|tests|CI\/CD)\b|검증/i.test(line) && /\[o\]/.test(line) }
    if (!relevant) continue
    if (/\[x\]/.test(line)) continue
    const label = line.match(/^\s*-\s*(task|batch|CI|태스크|묶음|push 전)(?=[,:\s])/i)
    if (label) {
      tier = /^(task|태스크)$/i.test(label[1]) ? 'task' : /^(ci)$/i.test(label[1]) ? 'ci' : 'batch'
      labels.add(tier)
      const colon = line.indexOf(':', label[0].length)
      if (colon >= 0 && tier !== 'ci') {
        for (const match of line.slice(colon + 1).matchAll(/`([^`]+)`/g)) result[tier].push(match[1])
      }
      if (tier === 'ci') result.guidance.push(line)
    } else if (tier && /^\s+-\s+`[^`]+`[.,]?\s*$/.test(line)) {
      result[tier].push(line.match(/`([^`]+)`/)[1])
    } else if (line.trim()) {
      result.guidance.push(line)
    }
  }
  result.declared = ['task', 'batch', 'ci'].every((tier) => labels.has(tier))
  for (const name of ['task', 'batch', 'ci']) result[name] = [...new Set(result[name])]
  return result
}

export async function readVerification(root) {
  const arch = await readFile(path.join(root, 'spec/ssot/ARCH.md'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  const verify = verificationTiers(arch)
  // Legacy ARCH: infer only familiar fast checks; never default a task to verify.
  if (!verify.declared) {
    let scripts = {}, manager = 'npm run'
    try {
      const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
      scripts = pkg.scripts ?? {}
      if (pkg.packageManager?.startsWith('pnpm')) manager = 'pnpm run'
      if (pkg.packageManager?.startsWith('yarn')) manager = 'yarn'
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!verify.batch.length) verify.batch = scripts.verify ? [`${manager} verify`] : scripts.test ? [`${manager} test`] : []
    if (!verify.task.length) verify.task = ['typecheck', 'lint', 'format:check'].filter((name) => scripts[name]).map((name) => `${manager} ${name}`)
    // Legacy commands belong to the batch gate and are selected explicitly by
    // the caller, rather than treating prose/code examples as executable config.
    verify.guidance.push('No explicit tiers: task = changed/affected tests plus fast checks; batch = full suite once before code push; CI = after push. Select legacy ARCH batch commands explicitly with --verify.')
  }
  return verify
}

export async function vibeBrief(options = {}) {
  const workspace = await inspectWorkspace(options)
  const root = workspace.git?.root ?? workspace.targetRoot
  const board = await readTaskBoard({ targetRoot: root })
  const task = board.tasks.find((task) => task.id === options.task)
  if (!task) throw new SkillPackageError(`태스크를 찾을 수 없습니다: ${options.task}`)
  const state = sections(await readFile(path.join(root, 'spec/STATE.md'), 'utf8'))
  const revs = new Map(tableRows(state.get('ssot')).map(([id, rev]) => [id, Number(rev)]))
  const decisions = []
  for (const domain of new Set(task.ssot.map((id) => id.split('-')[0]))) {
    const blocks = decisionBlocks(await readFile(path.join(root, `spec/ssot/${domain}.md`), 'utf8'))
    for (const id of task.ssot.filter((id) => id.startsWith(`${domain}-`))) {
      if (!blocks.has(id)) throw new SkillPackageError(`결정 블록이 없습니다: ${id}`)
      decisions.push({ id, text: blocks.get(id) })
    }
  }
  const current = workspace.git?.head ?? null
  const startFile = workspace.git ? path.join(workspace.git.gitDir, 'haeram-task-start.json') : null
  const saved = startFile ? await readFile(startFile, 'utf8').then(JSON.parse).catch(() => null) : null
  const diffBase = options.diffBase ?? process.env.HAERAM_DIFF_BASE ?? (saved?.task === task.id ? saved.diffBase : current)
  if (diffBase && workspace.git) await git(root, ['rev-parse', '--verify', `${diffBase}^{commit}`])
  if (startFile) await writeFile(startFile, JSON.stringify({ task: task.id, diffBase }))
  return { schemaVersion: 1, taskId: task.id, commit: current, diffBase,
    task: { ...task, content: await readFile(path.join(root, task.file), 'utf8') }, decisions,
    freshness: task.base.map((entry) => { const [domain, rev] = entry.split('@'); return { domain, base: Number(rev), current: revs.get(domain) ?? null, stale: Number(rev) !== revs.get(domain) } }),
    verify: await readVerification(root), touches: task.touches,
    reading: 'This brief is the reading scope. Do not re-read STATE, FORMAT or ARCH in full. Retrieve only a missing section or decision ID.' }
}

export async function vibeFormat(options = {}) {
  const markdown = await readFile(new URL('../skills/create-architecture/assets/FORMAT.md', import.meta.url), 'utf8')
  const names = { task: ['Notation', 'Skeletons (section order fixed; only (opt) may be omitted; no sections beyond the skeleton)', 'State rules'], state: ['State rules', 'Sessions'], ssot: ['Principles', 'Notation'], report: ['Sessions'], reading: ['Reading'] }
  const requested = names[options.section] ?? [options.section]
  const map = sections(markdown)
  if (!requested.every((name) => map.has(name))) throw new SkillPackageError(`알 수 없는 FORMAT section: ${options.section}`)
  const entries = requested.map((name) => {
    let lines = map.get(name)
    if (['task', 'state', 'report', 'ssot'].includes(options.section)) {
      const topic = { task: /task|acceptance|result|touches|base:|st:|dep:|\[v\]/i, state: /STATE|active|inbox|log|push|report/i, report: /report|autopilot|loop/i, ssot: /decision|SSOT|\[o\]|\[x\]|\[\?\]|rev|chg/i }[options.section]
      const selected = []
      let keep = false
      for (const line of lines) {
        if (/^\S/.test(line)) keep = topic.test(line)
        if (keep) selected.push(line)
      }
      lines = selected
    }
    return { name, text: lines.join('\n').trim() }
  })
  return { schemaVersion: 1, section: options.section, sections: entries }
}

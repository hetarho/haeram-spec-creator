import { mkdir, open, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeSync } from 'node:fs'
import path from 'node:path'
import { inspectWorkspace, git } from './workspace.mjs'
import { runtimeRoot, readRuntime } from './work-runtime.mjs'
import { workingTree, commitTree, checkKey, cachedPass, recordPass, withHeavyLock } from './check-cache.mjs'
import { SkillPackageError } from './errors.mjs'
import { sections, tableRows } from './spec-format.mjs'

export async function runVibeCheck(options = {}, command) {
  if (!command?.trim()) throw new SkillPackageError('vibe check -- <command>')
  const workspace = await inspectWorkspace(options)
  if (!workspace.git?.head) throw new SkillPackageError('커밋이 있는 Git checkout이 필요합니다.')
  const root = workspace.git.root, runtime = runtimeRoot(workspace)
  const saved = await readFile(path.join(workspace.git.gitDir, 'haeram-task-start.json'), 'utf8').then(JSON.parse).catch(() => null)
  const state = await readFile(path.join(root, 'spec/STATE.md'), 'utf8').catch(() => '')
  const stillActive = saved && tableRows(sections(state).get('tasks')).some(([id]) => id === saved.task)
  const taskStart = saved && (options.task === saved.task || (!options.task && stillActive)) ? saved : null
  const scope = { TIER: options.tier ?? process.env.HAERAM_TIER ?? 'task', DIFF_BASE: options.diffBase ?? process.env.HAERAM_DIFF_BASE ?? taskStart?.diffBase ?? workspace.git.head,
    TASK: options.task ?? process.env.HAERAM_TASK ?? taskStart?.task ?? '', TASKS: options.task ?? process.env.HAERAM_TASKS ?? taskStart?.task ?? '' }
  if (!['task', 'batch', 'unit', 'group', 'ci'].includes(scope.TIER)) throw new SkillPackageError('지원하지 않는 검증 tier입니다.')
  const final = ['batch', 'group'].includes(scope.TIER)
  if (final && !options.allowFinal) {
    const state = await readRuntime(runtime)
    const delegated = (options.env?.HAERAM_VIBE_UNIT ?? process.env.HAERAM_VIBE_UNIT) === '1' || Object.values(state.attempts).some((entry) =>
      (entry.workspace === root && !entry.cleanedAt) || [entry.review, ...(entry.reviewHistory ?? [])].some((review) => review?.workspace === root))
    if (delegated) throw new SkillPackageError('최종 검증은 조정자/호스트가 실행합니다. 워커·리뷰어는 태스크 검사만 실행하세요. 사용자가 별도 실행을 명시한 경우만 --allow-final을 사용하세요.')
  }
  await git(root, ['rev-parse', '--verify', `${scope.DIFF_BASE}^{commit}`])
  const timeout = Number(options.timeoutMs ?? 3600000)
  if (!Number.isFinite(timeout) || timeout <= 0) throw new SkillPackageError('--timeout-ms는 양수입니다.')
  const perform = async () => {
    const commit = (await git(root, ['rev-parse', 'HEAD'])).trim()
    // A script may read HAERAM_* internally even if its invocation does not name
    // them. Standalone cache identity always includes the effective scope.
    const tree = await workingTree(root), key = `${checkKey(tree, command, scope)}\u0000${JSON.stringify(scope)}`
    // Design verification (vibe design verify) checks the uncommitted design before its one commit.
    if (final && !options.uncommitted && tree !== await commitTree(root, commit)) throw new SkillPackageError('최종 검증 전에 작업 트리를 커밋하세요. 조정자는 고정된 통합 결과를 검증합니다.')
    const hit = !options.noCache && await cachedPass(runtime, key)
    if (hit) return { schemaVersion: 1, ok: true, exitCode: 0, cached: true, scope, commit, tree, log: hit.log ?? null, tail: [], failedTests: [] }
    const directory = path.join(runtime, 'logs')
    await mkdir(directory, { recursive: true })
    const log = path.join(directory, `check-${randomUUID()}.log`)
    let tail = '', failedTests = new Set(), partial = ''
    const collect = (chunk) => {
      const text = chunk.toString().replace(/\x1b\[[0-9;]*m/g, '')
      tail = (tail + text).slice(-4000)
      const lines = (partial + text).split('\n'); partial = lines.pop().slice(-1000)
      for (const line of lines) if (/^\s*(?:FAIL\b|FAILED\b|✕|×|not ok\b|\d+\)\s*\[)/.test(line)) {
        if (failedTests.size < 20) failedTests.add(line.trim().slice(0, 250))
      }
    }
    const run = async () => {
      const file = await open(log, 'w', 0o600)
      try {
        return await new Promise((resolve) => {
          const child = spawn(command, { cwd: root, shell: true, detached: process.platform !== 'win32', env: { ...process.env, ...options.env, ...Object.fromEntries(Object.entries(scope).map(([key, value]) => [`HAERAM_${key}`, value])) }, stdio: ['ignore', 'pipe', 'pipe'] })
          let timedOut = false, interrupted = false, forced
          const kill = (signal) => { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal) } catch {} }
          const stop = () => { interrupted = true; kill('SIGTERM'); forced ??= setTimeout(() => kill('SIGKILL'), 2000) }
          const timer = setTimeout(() => { timedOut = true; stop() }, timeout)
          process.on('SIGINT', stop); process.on('SIGTERM', stop)
          options.signal?.addEventListener('abort', stop, { once: true })
          if (options.signal?.aborted) stop()
          // File writes are synchronous OS descriptors; only a bounded tail stays in memory.
          const output = (chunk) => { writeSync(file.fd, chunk); collect(chunk) }
          child.stdout.on('data', output); child.stderr.on('data', output)
          const finish = (code) => { if (interrupted) kill('SIGKILL'); clearTimeout(timer); clearTimeout(forced); process.off('SIGINT', stop); process.off('SIGTERM', stop); options.signal?.removeEventListener('abort', stop); resolve({ code: interrupted ? code || 1 : code, timedOut }) }
          child.on('error', () => finish(127))
          child.on('close', (code) => finish(code ?? 1))
        })
      } finally { await file.close() }
    }
    const start = Date.now()
    const { code, timedOut } = await run()
    const unchanged = await workingTree(root) === tree && (!final || (await git(root, ['rev-parse', 'HEAD'])).trim() === commit)
    if (code === 0 && unchanged) await recordPass(runtime, key, { command, tree, scope, log, ms: Date.now() - start })
    const stale = final && !unchanged
    return { schemaVersion: 1, ok: code === 0 && !stale, exitCode: stale ? 1 : code, cached: false, timedOut, stale, ms: Date.now() - start, scope, commit, tree, log,
      failedTests: [...failedTests], tail: tail.trimEnd().split('\n').slice(-8) }
  }
  // Read the tree and cache only after acquiring the lock: a second caller reuses
  // the first caller's receipt instead of queuing a duplicate browser run.
  return final || options.heavy ? withHeavyLock(runtime, command, perform, { timeoutMs: timeout, signal: options.signal }) : perform()
}

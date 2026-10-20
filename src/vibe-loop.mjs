import { readFile, writeFile, mkdir, rm, open, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { vibeStatus, vibeSession, vibePreflight, vibeBeat, vibePush, vibeAwake, vibeCheckpoint, vibeSync } from './vibe.mjs'
import { readVerification, vibeBrief } from './vibe-brief.mjs'
import { runVibeCheck } from './vibe-check.mjs'
import { vibeCIWait } from './vibe-ci.mjs'
import { git } from './workspace.mjs'
import { inspectWork } from './work-groups.mjs'
import { SESSION_TAG } from './spec-format.mjs'
import { sections, tableRows } from './spec-format.mjs'
import { validateAgentResult } from './agent-adapter.mjs'
import { SkillPackageError } from './errors.mjs'

const cli = fileURLToPath(new URL('../bin/haeram-spec-creator.mjs', import.meta.url))
const adapter = fileURLToPath(new URL('../bin/haeram-agent-adapter.mjs', import.meta.url))
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' } }
const present = (file) => access(file).then(() => true, () => false)
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
const positive = (value, fallback, label, integer = false) => {
  const n = Number(value ?? fallback)
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isSafeInteger(n))) throw new SkillPackageError(`${label}: 양수가 필요합니다.`)
  return n
}

// One adapter invocation is one new provider process. Logs and session IDs are
// persisted before parsing a result; retries never resume a previous context.
export async function executeVibeUnit(options, job, directory, limits = {}) {
  const id = randomUUID(), logPath = path.join(directory, `${id}.log`), sessionFile = path.join(directory, `${id}.session`)
  let config = { command: process.execPath, args: [adapter, '--provider', options.provider, ...(options.model ? ['--model', options.model] : [])] }
  if (options.adapter) {
    const file = path.resolve(options.adapter)
    config = JSON.parse(await readFile(file, 'utf8'))
    if (!config?.command || !Array.isArray(config.args) || config.args.some((value) => typeof value !== 'string')) throw new SkillPackageError('adapter에는 command와 문자열 args 배열이 필요합니다.')
    if (config.command.includes('/') && !path.isAbsolute(config.command)) config.command = path.resolve(path.dirname(file), config.command)
  }
  const log = await open(logPath, 'w', 0o600)
  await writeFile(path.join(directory, `${id}.job.json`), JSON.stringify({ ...job, sessionFile }, null, 2))
  let output = '', forced, stopped = null
  try {
    return await new Promise((resolve) => {
      const child = spawn(config.command, config.args, { cwd: job.workspace, env: { ...process.env, ...options.env,
        HAERAM_VIBE_UNIT: '1', HAERAM_VIBE_TAG: options.tag, HAERAM_DIFF_BASE: job.diffBase, HAERAM_TIER: 'task' },
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', log.fd] })
      const kill = (signal) => { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal) } catch {} }
      const stop = (reason) => { stopped ??= reason; kill('SIGTERM'); forced ??= setTimeout(() => kill('SIGKILL'), 2000) }
      const signal = () => stop('signal')
      process.on('SIGINT', signal); process.on('SIGTERM', signal)
      const abort = () => stop(limits.signal?.reason ?? 'stopped')
      limits.signal?.addEventListener('abort', abort, { once: true })
      if (limits.signal?.aborted) abort()
      const timeout = setTimeout(() => stop('unit-timeout'), limits.timeoutMs ?? 3600000)
      let checking = false
      const timer = setInterval(async () => {
        if (checking) return
        checking = true
        try {
          if (await present(limits.stopFile)) stop('stop-file')
          if (Date.now() >= limits.deadline) stop('max-hours')
        } catch { /* checkpoint errors do not discard the unit */ }
        finally { checking = false }
      }, 1000)
      const finish = async (code, error) => {
        if (stopped) kill('SIGKILL')
        clearInterval(timer); clearTimeout(timeout); clearTimeout(forced)
        process.off('SIGINT', signal); process.off('SIGTERM', signal)
        limits.signal?.removeEventListener('abort', abort)
        let result = null
        if (code === 0 && !stopped) {
          try { result = validateAgentResult('unit', JSON.parse(output.trim().split('\n').at(-1))) }
          catch (parseError) { error = parseError.message }
        }
        const session = await readFile(sessionFile, 'utf8').catch(() => null)
        resolve({ dispatch: id, exitCode: code, stopped, error: error ?? null, result, session: session?.trim() ?? null, log: logPath })
      }
      child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 1024 * 1024) stop('output-limit') })
      child.on('error', (error) => finish(127, error.message))
      child.on('close', (code) => finish(code ?? 1))
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify({ ...job, sessionFile }))
    })
  } finally {
    await log.writeFile(`\n${output.slice(-1024 * 1024)}\n`)
    await log.close()
  }
}

export async function vibeLoop(options = {}, injected = {}) {
  if (!SESSION_TAG.test(options.tag ?? '')) throw new SkillPackageError('--tag에는 영숫자 2-8자가 필요합니다.')
  if (!options.stop && !options.adapter && !['claude', 'codex'].includes(options.provider)) throw new SkillPackageError('--provider claude|codex가 필요합니다.')
  if (!['acceptEdits', 'bypass'].includes(options.permissionMode ?? 'acceptEdits')) throw new SkillPackageError('--permission-mode는 acceptEdits 또는 bypass입니다.')
  const maxUnits = positive(options.maxUnits, 100, 'max-units', true), hours = positive(options.maxHours, 8, 'max-hours')
  const batchSize = positive(options.batchSize, 3, 'batch-size', true), timeoutMs = positive(options.timeoutMs, 3600000, 'timeout-ms')
  const context = await vibeSession(options), root = context.root
  const directory = path.join(context.runtime, 'loops', options.tag), stopFile = path.join(directory, 'STOP'), manifest = path.join(directory, 'loop.json')
  const deps = { status: vibeStatus, preflight: vibePreflight, execute: executeVibeUnit, push: vibePush, ci: vibeCIWait, check: runVibeCheck, checkpoint: vibeCheckpoint, now: Date.now, ...injected }
  if (options.stop) { await mkdir(directory, { recursive: true }); await writeFile(stopFile, 'stop\n'); return { schemaVersion: 1, ok: true, stopFile } }
  const state = await deps.status({ ...options, tag: options.tag })
  const verify = await readVerification(root)
  const batchVerify = options.verify ?? verify.batch
  if (!Array.isArray(batchVerify) || batchVerify.some((command) => typeof command !== 'string' || !command.trim())) throw new SkillPackageError('--verify에는 실행 가능한 명령이 필요합니다.')
  const plan = { schemaVersion: 1, tag: options.tag, provider: options.provider ?? 'command', permissionMode: options.permissionMode ?? 'acceptEdits',
    cwd: root, concurrency: state.concurrency, route: state.route, limits: { maxUnits, maxHours: hours, batchSize, timeoutMs }, verify, batchVerify,
    directory, stopFile, manifest, freshSessionPerUnit: true }
  if (options.dryRun) return { ...plan, dryRun: true, modelRequests: 0 }
  if ((await inspectWork({ targetRoot: root })).mode !== 'single') throw new SkillPackageError('vibe loop는 단독 checkout에서 실행하세요. 활성 work 공간은 work run을 사용합니다.')
  await mkdir(directory, { recursive: true })
  if (options.detach) {
    const config = path.join(directory, `config-${randomUUID()}.json`)
    await writeFile(config, JSON.stringify({ ...options, targetRoot: root, detach: false }), { mode: 0o600 })
    const logPath = path.join(directory, 'host.log'), log = await open(logPath, 'a')
    try {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/haeram-vibe-loop.mjs', import.meta.url)), config], { cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd], env: options.env ?? process.env })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      child.unref()
      return { ...plan, ok: true, detached: true, pid: child.pid, status: 'starting; inspect manifest/host log for preflight result', log: logPath }
    } finally { await log.close() }
  }
  const lock = path.join(context.workspace.git.gitDir, 'haeram-vibe-loop.lock')
  try { await writeFile(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), tag: options.tag }), { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const owner = JSON.parse(await readFile(lock, 'utf8'))
    if (owner.host !== os.hostname() || alive(owner.pid)) throw new SkillPackageError('이 checkout에서 vibe loop가 실행 중입니다.', [JSON.stringify(owner)])
    await rm(lock)
    return vibeLoop(options, injected)
  }
  const start = deps.now(), deadline = start + hours * 3600000
  const report = `spec/reports/${new Date(start).toISOString().slice(2, 10).replaceAll('-', '')}-${options.tag}.md`
  const reportPath = path.join(root, report)
  let initialized = false, awake = false, stopped = false, reason = null, error = null, base = context.workspace.git.head, pending = [], failureStreak = 0, noProgress = 0, count = 0, codePushed = false
  const previous = await readFile(manifest, 'utf8').then(JSON.parse).catch(() => null)
  let priorityTask = /^T\d+$/.test(previous?.priorityTask ?? '') ? previous.priorityTask : null
  let recovery = previous?.recovery?.reason === 'blocked-task' && /^T\d+$/.test(previous.recovery.taskId ?? '') ? previous.recovery : null
  const dispatches = [], batches = []
  const controller = new AbortController()
  let stopReason = null, watching = false, checkpointAt = start
  const checkpoint = async () => {
    if (initialized && !stopped && deps.now() - checkpointAt >= 3600000) {
      checkpointAt = deps.now()
      await deps.checkpoint({ ...options, targetRoot: root, tag: options.tag }).catch(() => {})
    }
  }
  const stop = (why) => { stopped = true; stopReason ??= why; controller.abort(stopReason) }
  const interrupted = () => stop('signal')
  const watcher = setInterval(async () => {
    if (watching) return
    watching = true
    try {
      if (await present(stopFile)) stop('stop-file')
      if (deps.now() >= deadline) stop('max-hours')
      await checkpoint()
    } finally { watching = false }
  }, 1000)
  const save = async () => writeFile(manifest, JSON.stringify({ ...plan, pid: process.pid, startedAt: new Date(start).toISOString(), report, units: count, dispatches, batches, priorityTask, recovery, reason, error, running: !reason }, null, 2))
  const metadataCommit = async (message) => {
    const changed = (await git(root, ['status', '--porcelain', '--', 'spec/STATE.md', report])).trim()
    if (!changed) return
    await git(root, ['add', '--', 'spec/STATE.md', report])
    await git(root, ['commit', '--quiet', '--only', '-m', message, '--', 'spec/STATE.md', report])
  }
  const updateReport = async (closing = false) => {
    let text = await readFile(reportPath, 'utf8')
    if (closing) text = text.replace(/\bto:-/, `to:${new Date(deps.now()).toISOString()}`)
    const lines = pending.map((entry) => `- ${entry.result?.kind ?? 'session'} ${entry.result?.id ?? '-'}: ${entry.result?.outcome ?? 'failed'} (${entry.head.slice(0, 12)})`).filter((line) => !text.includes(line))
    if (lines.length) text = text.replace('\n## decided', `${lines.join('\n')}\n\n## decided`)
    const current = await deps.status({ ...options, targetRoot: root, section: 'inbox', fetch: false })
    for (const kind of ['decided', 'parked']) {
      const entries = current.inbox?.filter((entry) => entry.kind === kind).map((entry) => entry.line) ?? []
      const next = kind === 'decided' ? 'parked' : 'checks'
      const fresh = entries.filter((line) => !text.includes(line))
      if (fresh.length) text = text.replace(`\n## ${next}`, `${fresh.join('\n')}\n\n## ${next}`)
    }
    const checks = batches.map((entry) => entry.ci ? `- CI ${entry.ci.commit ?? '-'}: ${entry.ci.outcome} ${entry.ci.runUrl ?? ''}` : `- ${entry.command}: ${entry.ok ? 'pass' : 'fail'} (${entry.log ?? '-'})`)
      .filter((line) => !text.includes(line))
    if (checks.length) text = text.replace('\n## next', `${checks.join('\n')}\n\n## next`)
    if (closing) text = text.replace(/## next[\s\S]*$/, `## next\n- loop stopped: ${reason}\n${priorityTask ? `- priority task: ${priorityTask}\n` : ''}`)
    await writeFile(reportPath, text)
  }
  const flush = async (closing = false) => {
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim()
    const files = (await git(root, ['diff', '--name-only', base, head])).trim().split('\n').filter(Boolean)
    const code = files.some((file) => !/^(spec\/|docs\/)|\.md$/i.test(file))
    if (code) {
      if (!batchVerify.length) throw new SkillPackageError('코드 push 전 묶음 검증이 없습니다. ARCH batch 단계 또는 --verify를 지정하세요.')
      for (const command of batchVerify) {
        const checked = await deps.check({ targetRoot: root, tier: 'batch', diffBase: base, heavy: true, signal: controller.signal, timeoutMs: Math.min(timeoutMs, Math.max(1, deadline - deps.now())) }, command)
        batches.push({ command, ...checked })
        if (!checked.ok) throw new SkillPackageError(`묶음 검증 실패: ${command}`, [checked.log ?? ''])
      }
    }
    await updateReport(closing)
    await metadataCommit(`vibe ${options.tag}: ${closing ? 'close report' : 'batch report'}`)
    const pushed = await deps.push({ ...options, targetRoot: root })
    if (pushed.ok === false) throw new SkillPackageError('묶음 push 실패')
    if (pushed.pushed && code) {
      codePushed = true
      const ci = await deps.ci({ ...options, targetRoot: root, signal: controller.signal, timeoutMs: Math.max(1, deadline - deps.now()), commit: pushed.pushed, branch: context.target, diffBase: base })
      batches.push({ ci })
      if (!ci.ok && ci.outcome === 'cancelled') throw new SkillPackageError('CI 대기가 중지됐습니다.')
      if (!ci.ok) {
        // Persist a concrete fix task. The next fresh session can implement it
        // without recovering CI output from the previous conversation.
        const file = path.join(root, 'spec/STATE.md')
        let text = await readFile(file, 'utf8')
        const { readdir } = await import('node:fs/promises')
        const names = [...await readdir(path.join(root, 'spec/tasks')).catch(() => []), ...await readdir(path.join(root, 'spec/tasks/done')).catch(() => [])]
        const id = `T${String(Math.max(0, ...names.map((name) => Number(name.match(/^T(\d+)\./)?.[1] ?? 0))) + 1).padStart(3, '0')}`
        const rev = tableRows(sections(text).get('ssot')).find(([id]) => id === 'ARCH')?.[1] ?? '1'
        const taskPath = `spec/tasks/${id}.fix-ci.md`
        await writeFile(path.join(root, taskPath), `# ${id} Fix CI failure\n> st:todo | ssot:- | base:ARCH@${rev} | dep:-\n\n## goal\nFix the failing checks for ${pushed.pushed}; preserve existing contracts.\n\n## acceptance\n- [ ] The failed checks pass with a regression test where appropriate.\n\n## impl notes\n- CI: ${ci.runUrl ?? '-'}\n- Jobs: ${JSON.stringify(ci.jobs ?? [])}\n\n## result\n`)
        text = text.replace(/(## tasks\n[\s\S]*?)(?=\n## |$)/, (section) => `${section.trimEnd()}\n| ${id} | Fix CI failure | ARCH | - | todo |\n`)
        text = text.replace(/## next\n[\s\S]*?(?=\n## |$)/, `## next\n- implement-task ${id}\n`)
        await writeFile(file, text)
        await git(root, ['add', '--', file, taskPath])
        await git(root, ['commit', '--quiet', '--only', '-m', `create-task ${id}: CI failure`, '--', file, taskPath])
        // A failed check is work for the next unit, not a request for a person.
        // Keep it ahead of the normal queue even though its ID was allocated last.
        priorityTask = id
      }
    }
    // The last CI result (and any repair queued at a limit) arrives after the
    // code push. Persist it in the closing report and publish that metadata too.
    if (closing && pushed.pushed && code) {
      await updateReport(true)
      await metadataCommit(`vibe ${options.tag}: final CI result`)
      const final = await deps.push({ ...options, targetRoot: root })
      if (final.ok === false) throw new SkillPackageError('마감 보고서 push 실패')
    }
    base = (await git(root, ['rev-parse', 'HEAD'])).trim(); pending = []
    await save()
  }
  process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted)
  try {
    await save()
    if (await present(stopFile)) { reason = 'stop-file'; return { ...plan, ok: true, reason, units: 0 } }
    const allowTool = [...new Set(['Bash(git *)', `Bash(${process.execPath} ${cli} *)`, ...(options.allowTool ?? [])])]
    const probe = options.probe ?? `git status --porcelain${context.target ? ` && git push --dry-run ${quote(context.remote)} ${quote(`HEAD:refs/heads/${context.target}`)}` : ''}`
    const preflight = await deps.preflight({ ...options, targetRoot: root, signal: controller.signal, probe, allowTool, probeWorkspace: 'current', probeTimeoutMs: Math.min(Number(options.probeTimeoutMs ?? 900000), Math.max(1, deadline - deps.now())) })
    await writeFile(path.join(directory, 'preflight.json'), JSON.stringify(preflight, null, 2))
    if (!preflight.ok) throw new SkillPackageError('맡김 preflight 실패', preflight.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`))
    if (state.git?.behind) await vibeSync({ ...options, targetRoot: root })
    base = (await git(root, ['rev-parse', 'HEAD'])).trim()
    await vibeBeat({ targetRoot: root, tag: options.tag, mode: 'autopilot' })
    await mkdir(path.dirname(reportPath), { recursive: true })
    if (await present(reportPath)) {
      const previous = await readFile(reportPath, 'utf8')
      await writeFile(reportPath, previous.replace(/\bto:[^|\n]+/, 'to:- '))
    } else await writeFile(reportPath, `# REPORT ${path.basename(report, '.md')}\n> mode:autopilot | host:${os.hostname()} | from:${new Date(start).toISOString()} | to:- | push:${context.push}\n\n## done\n\n## decided\n\n## parked\n\n## checks\n\n## next\n- continue remaining work\n`)
    initialized = true
    if (process.platform === 'darwin') { const receipt = await vibeAwake({ targetRoot: root, hours: Math.min(hours, 72) }); awake = receipt.ok && !receipt.reused }
    for (;;) {
      if (stopped) { reason = stopReason; break }
      if (await present(stopFile)) { reason = 'stop-file'; break }
      if (deps.now() >= deadline) { reason = 'max-hours'; break }
      if (count >= maxUnits) { reason = 'max-units'; break }
      let status = await deps.status({ ...options, targetRoot: root, tag: options.tag })
      if (status.git?.fetchError) throw new SkillPackageError('원격 판정 실패', [status.git.fetchError])
      if (priorityTask && status.remaining && !status.remaining.some((task) => task.id === priorityTask)) priorityTask = null
      if (recovery && status.remaining && !status.remaining.some((task) => task.id === recovery.taskId)) recovery = null
      if (!recovery && status.implementation?.blocked?.length) {
        const inbox = await deps.status({ ...options, targetRoot: root, section: 'inbox', fetch: false })
        const parked = new Set((inbox.inbox ?? []).filter((entry) => entry.kind === 'parked').flatMap((entry) => entry.refs))
        const taskId = status.implementation.blocked.find((id) => !parked.has(id))
        if (taskId) { recovery = { reason: 'blocked-task', taskId }; priorityTask = taskId }
      }
      const finished = status.parkedOnly ? 'parked-only' : status.settled || status.route === 'ideation-first' ? 'no-work' : null
      if (finished && !recovery) {
        // Flush before deciding there is no more work: CI can add a repair task.
        if (pending.length) { await flush(); if (priorityTask || recovery) continue }
        reason = finished; break
      }
      if (status.concurrency === 'strict') {
        if (pending.length) await flush()
        await metadataCommit(`vibe ${options.tag}: session presence`)
        await deps.push({ ...options, targetRoot: root })
        status = await deps.status({ ...options, targetRoot: root, tag: options.tag })
      }
      const before = { head: (await git(root, ['rev-parse', 'HEAD'])).trim(), state: await readFile(path.join(root, 'spec/STATE.md'), 'utf8') }
      const nextTask = status.next?.[0]?.match(/^- implement-task (T\d+)\b/)?.[1]
      const selected = recovery?.taskId ?? (status.runnable?.includes(priorityTask) ? priorityTask : null) ?? status.implementation?.resume?.find((id) => status.runnable?.includes(id)) ?? (status.runnable?.includes(nextTask) ? nextTask : null) ?? status.runnable?.[0]
      const brief = selected ? await vibeBrief({ targetRoot: root, task: selected, diffBase: before.head }) : null
      const job = { schemaVersion: 1, role: 'unit', mode: 'autopilot', workspaceMode: 'single', workspace: root, tag: options.tag, report, status, brief,
        cliCommand: [process.execPath, cli], allowTools: allowTool, permissionMode: options.permissionMode ?? 'acceptEdits', diffBase: before.head, hostManaged: true,
        ...(recovery ? { recovery } : {}) }
      const receipt = await deps.execute(options, job, directory, { stopFile, deadline, signal: controller.signal, timeoutMs: Math.min(timeoutMs, Math.max(1, deadline - deps.now())) })
      count++
      const after = { head: (await git(root, ['rev-parse', 'HEAD'])).trim(), state: await readFile(path.join(root, 'spec/STATE.md'), 'utf8') }
      const entry = { ...receipt, unit: count, head: after.head, at: new Date(deps.now()).toISOString() }
      dispatches.push(entry); pending.push(entry)
      await checkpoint()
      const failed = receipt.exitCode !== 0 || !receipt.result
      if (!failed) {
        const taskId = receipt.result.id || selected
        // A unit owns planning as well as implementation. Give a blocked task a
        // fresh planning unit even if its STATE row is no longer runnable.
        recovery = receipt.result.outcome === 'blocked' && /^T\d+$/.test(taskId ?? '')
          ? { reason: 'blocked-task', taskId, previousResult: receipt.result } : null
        if (recovery) priorityTask = taskId
        if (receipt.result.outcome === 'parked' && taskId === priorityTask) priorityTask = null
      }
      failureStreak = failed ? failureStreak + 1 : 0
      noProgress = before.head === after.head && before.state === after.state ? noProgress + 1 : 0
      await save()
      if (receipt.stopped) { reason = receipt.stopped; break }
      if (failureStreak >= 2) { reason = 'session-failures'; break }
      if (noProgress >= 2) { reason = 'no-progress'; break }
      if (failed) continue
      const afterStatus = await deps.status({ ...options, targetRoot: root, tag: options.tag })
      if (priorityTask && afterStatus.remaining && !afterStatus.remaining.some((task) => task.id === priorityTask)) priorityTask = null
      if (count >= maxUnits) { reason = 'max-units'; break }
      const completed = pending.filter((entry) => ['task', 'fix'].includes(entry.result?.kind) && entry.result.outcome === 'completed').length
      if (afterStatus.concurrency === 'strict' || completed >= batchSize || !afterStatus.runnable?.length) await flush()
    }
  } catch (caught) { reason = 'failed'; error = caught.message }
  finally {
    clearInterval(watcher)
    process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted)
    if (initialized) {
      try {
        await vibeBeat({ targetRoot: root, tag: options.tag, end: true })
        if (!error && failureStreak === 0) await flush(true)
        else { await updateReport(true); await metadataCommit(`vibe ${options.tag}: stopped (${reason})`) }
      } catch (caught) { error ??= caught.message; reason = 'failed'; await updateReport(true).catch(() => {}) }
    }
    if (awake) await vibeAwake({ targetRoot: root, stop: true }).catch(() => {})
    await save()
    await rm(lock, { force: true })
  }
  return { ...plan, ok: !error && reason !== 'session-failures', reason, error, units: count, report, codePushed, priorityTask, recovery, manifest }
}

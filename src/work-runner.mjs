import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { inspectWork, claimNextWork, submitWork, integrateWork, workBoard, workInternals } from './work-groups.mjs'
import { claimReview, finishReview, releaseReview, resumeWork } from './work-review.mjs'
import { readRuntime, transaction } from './work-runtime.mjs'
import { workLimits } from './work-policy.mjs'

const { repository, groupOf, attemptOf, now, fail, requireStopped, commands } = workInternals

export async function recoverRunner(options) {
  const context = await repository(options)
  return transaction(context.root, (state) => {
    const group = groupOf(state, options.work)
    if (!group.runner) fail('복구할 runner 기록이 없습니다.')
    requireStopped(group.runner)
    for (const entry of Object.values(state.attempts)) {
      const dispatch = entry.dispatch
      if (dispatch?.runner !== group.runner.id || !['starting', 'running'].includes(dispatch.status)) continue
      if (!dispatch.pid) fail('시작 중 중단된 실행의 PID를 확인할 수 없습니다. 실행기 프로세스를 수동으로 확인해야 합니다.', [dispatch.id])
      requireStopped(dispatch)
      dispatch.status = 'interrupted'
      if (entry.status === 'doing') { entry.status = 'blocked'; entry.reason = 'runner interrupted; inspect worker before resuming' }
      // A review claim remains explicit: review-release after confirming the reviewer stopped.
    }
    group.lastRun = { ...group.runner, stoppedAt: now(), outcome: 'recovered' }
    delete group.runner
    return group.lastRun
  })
}

async function adapterConfig(file) {
  if (!file) fail('run에는 실행할 어댑터 설정 --adapter <json-file>이 필요합니다.')
  const filename = path.resolve(file)
  const config = JSON.parse(await readFile(filename, 'utf8'))
  if (!config || typeof config.command !== 'string' || !config.command || !Array.isArray(config.args) || config.args.some((value) => typeof value !== 'string')) fail('어댑터 설정에는 command와 문자열 args 배열이 필요합니다.')
  if (config.command.includes('/') && !path.isAbsolute(config.command)) config.command = path.resolve(path.dirname(filename), config.command)
  for (const [key, fallback] of [['timeoutMs', 3600000], ['maxDispatches', 200], ['maxTaskRuns', 3]]) {
    config[key] ??= fallback
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) fail(`${key}: 양의 정수가 필요합니다.`)
  }
  return config
}

export async function runWork(options) {
  const verify = commands(options)
  const config = await adapterConfig(options.adapter)
  const context = await repository(options)
  const run = { id: randomUUID(), pid: process.pid, host: os.hostname(), startedAt: now() }
  const group = await transaction(context.root, (state) => {
    const group = groupOf(state, options.work)
    if (group.runner) fail('작업 묶음에 runner가 이미 있습니다. 종료 후 runner-recover로 확인하세요.', [JSON.stringify(group.runner)])
    group.runner = run
    return structuredClone(group)
  })
  const limits = workLimits(group.limits)
  const jobs = new Map()
  const failures = []
  const integrationFailures = new Set()
  const counts = new Map()
  let dispatched = 0
  let stopping = false
  let interrupted = false
  const abort = new AbortController()
  let heartbeatError = null
  const kill = (job) => {
    if (!job.child || job.settled) return
    try { if (process.platform === 'win32') job.child.kill('SIGTERM'); else process.kill(-job.child.pid, 'SIGTERM') } catch {}
  }
  const stop = () => { interrupted = true; stopping = true; abort.abort(); for (const job of jobs.values()) kill(job) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  let heartbeat = Promise.resolve()
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(() => transaction(context.root, (state) => {
      if (state.groups[group.id]?.runner?.id !== run.id) fail('runner ownership changed')
      state.groups[group.id].runner.heartbeatAt = now()
      for (const job of jobs.values()) {
        const entry = state.attempts[job.attempt]
        if (entry?.dispatch?.id !== job.id || job.settled) continue
        entry.heartbeatAt = now()
        if (job.review && entry.review?.id === job.review.id) entry.review.heartbeatAt = now()
      }
    })).catch((error) => { heartbeatError = error.message; stop() })
  }, 10000)
  timer.unref()

  const launch = async (role, attempt, slot, review) => {
    if (stopping) {
      if (review) await releaseReview({ ...options, review: review.id, reason: 'runner stopped before launch' })
      else await transaction(context.root, (state) => { Object.assign(attemptOf(state, attempt.id), { status: 'blocked', reason: 'runner stopped before launch' }) })
      return
    }
    const id = randomUUID()
    const job = { id, role, attempt: attempt.id, slot, review, workspace: review?.workspace ?? attempt.workspace, settled: false }
    await transaction(context.root, (state) => {
      attemptOf(state, attempt.id).dispatch = { id, runner: run.id, role, slot, status: 'starting', pid: null, host: os.hostname(), startedAt: now() }
    })
    jobs.set(id, job)
    dispatched += 1
    const key = `${role}:${attempt.id}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    const payload = { schemaVersion: 1, dispatchId: id, role, slot, group: group.id, attempt: attempt.id,
      taskId: attempt.taskId, workspace: job.workspace, groupBranch: group.branch,
      boardCommand: ['work', 'board', '--work', group.id, '--json'],
      verify, review: review ?? null, correction: attempt.correction ?? null,
      instruction: role === 'worker'
        ? 'Use implement-task. Implement or fix review findings in this workspace, check acceptance, fill result, and commit. Return JSON {"outcome":"completed","summary":"..."}. The runner owns submit; do not submit, integrate, or claim another task. For a blocker return {"outcome":"blocked","summary":"reason"}.'
        : 'Use review-task. Review the pinned commit against baseCommit, task, and SSOT. Do not edit or commit. Return JSON {"verdict":"approved|changes_requested","summary":"...","findings":[{"priority":"P1|P2|P3","where":"file:line","message":"..."}]}. The runner owns review-finish.' }
    const child = spawn(config.command, config.args, { cwd: job.workspace, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HAERAM_ROLE: role, HAERAM_ATTEMPT: attempt.id, HAERAM_DISPATCH: id } })
    job.child = child
    let output = '', stderr = '', overflow = false
    job.promise = new Promise((resolve) => {
      let completed = false
      const finish = (error) => { if (completed) return; completed = true; clearTimeout(timeout); job.settled = true; job.error = error; job.output = output; job.stderr = stderr; resolve(job) }
      const timeout = setTimeout(() => { job.timedOut = true; kill(job); setTimeout(() => { if (job.settled) return; try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL') } catch {} }, 2000).unref() }, config.timeoutMs)
      child.stdout.on('data', (data) => { output += data; if (output.length > 1024 * 1024) { overflow = true; output = output.slice(0, 1024 * 1024); kill(job) } })
      child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-16000) })
      child.on('error', (error) => finish(error.message))
      child.on('close', (code, signal) => finish(job.timedOut ? 'adapter timeout' : overflow ? 'adapter output exceeded 1 MiB' : code === 0 ? null : `adapter exited ${code ?? signal}`))
      child.stdin.on('error', () => {})
      child.stdin.end(`${JSON.stringify(payload)}\n`)
    })
    await transaction(context.root, (state) => {
      const dispatch = attemptOf(state, attempt.id).dispatch
      if (dispatch.id !== id) fail('dispatch ownership changed')
      Object.assign(dispatch, { pid: child.pid ?? null, status: child.pid ? 'running' : 'failed' })
    })
  }

  const settle = async (job) => {
    try {
      if (job.error) fail(job.error, [job.stderr])
      const result = JSON.parse(job.output)
      if (job.role === 'reviewer') await finishReview({ ...options, review: job.review.id, result })
      else {
        if (result.outcome !== 'completed') fail(result.summary || 'worker did not complete')
        await submitWork({ ...options, attempt: job.attempt, verify, signal: abort.signal })
      }
    } catch (error) {
      job.resultError = error.message
      failures.push({ attempt: job.attempt, role: job.role, error: error.message })
      if (job.role === 'reviewer') {
        await releaseReview({ ...options, review: job.review.id, reason: error.message }).catch(() => {})
      } else {
        await transaction(context.root, (state) => {
          const entry = attemptOf(state, job.attempt)
          if (['doing', 'blocked'].includes(entry.status)) Object.assign(entry, { status: 'blocked', reason: error.message })
        })
      }
    } finally {
      await transaction(context.root, (state) => {
        const entry = attemptOf(state, job.attempt)
        if (entry.dispatch?.id === job.id) Object.assign(entry.dispatch, { status: 'finished', finishedAt: now(), error: job.resultError ?? job.error ?? null, stderr: job.stderr })
      })
      jobs.delete(job.id)
    }
  }

  try {
    while (!stopping) {
      for (const job of [...jobs.values()]) if (job.settled) await settle(job)
      if (stopping) break
      let state = await readRuntime(context.root)
      const entries = () => Object.values(state.attempts).filter((entry) => entry.group === group.id)
      const approved = entries().find((entry) => entry.status === 'approved' && !integrationFailures.has(entry.id))
      if (approved && !groupOf(state, group.id).operation) {
        try { await integrateWork({ ...options, attempt: approved.id, verify, signal: abort.signal }) } catch (error) {
          const current = (await readRuntime(context.root)).attempts[approved.id]
          if (current.status !== 'ready') { integrationFailures.add(approved.id); failures.push({ attempt: approved.id, role: 'integration', error: error.message }) }
        }
        continue
      }
      if (dispatched < config.maxDispatches) {
        for (let slot = 1; slot <= limits.workers && !stopping && dispatched < config.maxDispatches; slot += 1) {
          if ([...jobs.values()].some((job) => job.role === 'worker' && job.slot === slot)) continue
          const owner = `${run.id}/worker-${slot}`
          let attempt = await resumeWork({ ...options, owner })
          if (attempt.idle) attempt = await claimNextWork({ ...options, owner, workspace: 'new' })
          if (attempt.idle) continue
          if ((counts.get(`worker:${attempt.id}`) ?? 0) >= config.maxTaskRuns) {
            await transaction(context.root, (live) => { Object.assign(attemptOf(live, attempt.id), { status: 'blocked', reason: 'worker retry limit; inspect review findings' }) })
            failures.push({ attempt: attempt.id, error: 'worker retry limit' }); continue
          }
          await launch('worker', attempt, slot)
        }
        for (let slot = 1; slot <= limits.reviewers && !stopping && dispatched < config.maxDispatches; slot += 1) {
          if ([...jobs.values()].some((job) => job.role === 'reviewer' && job.slot === slot)) continue
          let review
          try { review = await claimReview({ ...options, owner: `${run.id}/reviewer-${slot}` }) } catch (error) { failures.push({ role: 'reviewer', error: error.message }); continue }
          if (review.idle) continue
          if ((counts.get(`reviewer:${review.attempt}`) ?? 0) >= config.maxTaskRuns) {
            await releaseReview({ ...options, review: review.id, reason: 'review retry limit' })
            await transaction(context.root, (live) => { Object.assign(attemptOf(live, review.attempt), { status: 'blocked', reason: 'review retry limit; inspect submission' }) })
            failures.push({ attempt: review.attempt, error: 'review retry limit' }); continue
          }
          state = await readRuntime(context.root)
          await launch('reviewer', attemptOf(state, review.attempt), slot, review)
        }
      }
      if (!jobs.size) break
      await Promise.race([...jobs.values()].map((job) => job.promise))
    }
  } finally {
    for (const job of jobs.values()) kill(job)
    clearInterval(timer)
    await heartbeat
    // Terminate only children created by this runner. Claims and files remain inspectable.
    const forced = setTimeout(() => { for (const job of jobs.values()) if (!job.settled) { try { if (process.platform === 'win32') job.child.kill('SIGKILL'); else process.kill(-job.child.pid, 'SIGKILL') } catch {} } }, 2000)
    await Promise.all([...jobs.values()].map((job) => job.promise))
    clearTimeout(forced)
    for (const job of [...jobs.values()]) { job.error ??= 'runner stopped before accepting result'; await settle(job) }
    process.off('SIGINT', stop); process.off('SIGTERM', stop)
    await transaction(context.root, (state) => {
      const current = groupOf(state, group.id)
      if (current.runner?.id === run.id) { current.lastRun = { ...run, stoppedAt: now(), dispatched, failures }; delete current.runner }
    })
  }
  const board = await workBoard(options)
  const status = await inspectWork(options)
  const attempts = status.attempts.filter((entry) => entry.group === group.id)
  return { schemaVersion: 1, run: run.id, dispatched, failures, heartbeatError,
    outcome: interrupted || heartbeatError ? 'interrupted' : board.tasks.length === 0 ? 'completed' : dispatched >= config.maxDispatches ? 'dispatch-limit' : 'needs-attention',
    remaining: board.tasks.map(({ id, waitingOn, runtimeStatus }) => ({ id, waitingOn, runtimeStatus })),
    attempts: attempts.map(({ id, taskId, status, reason }) => ({ id, taskId, status, reason })) }
}

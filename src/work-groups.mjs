import { readFile, mkdir, writeFile, rename, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { inspectWorkspace, git } from './workspace.mjs'
import { readTaskBoard } from './task-board.mjs'
import { quoteLine, quoteFields, sections, splitRefs, TASK_ID } from './spec-format.mjs'
import { runtimeRoot, readRuntime, transaction, readLock, unlockRuntime, canonicalDestination } from './work-runtime.mjs'
import { SkillPackageError } from './errors.mjs'
import { lintSpec } from './spec-lint.mjs'

const execute = promisify(exec)
import { activeAttempt as active, workerBusy, pendingReview, workLimits, invalidateReview, overlaps, rankedTasks } from './work-policy.mjs'
const now = () => new Date().toISOString()
const date = () => now().slice(2, 10).replaceAll('-', '')
const creator = () => ({ pid: process.pid, host: os.hostname() })
const fail = (message, details = []) => { throw new SkillPackageError(message, details) }
const digest = (value) => createHash('sha256').update(value).digest('hex')
const head = async (root, ref = 'HEAD') => (await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim()
const ancestor = async (root, old, next) => (await git(root, ['merge-base', '--is-ancestor', old, next], [1])) !== null
const clean = async (root) => !(await git(root, ['status', '--porcelain', '--untracked-files=all'])).trim()
const blob = (root, commit, file) => git(root, ['show', `${commit}:${file}`], [128])

async function repository(options) {
  const workspace = await inspectWorkspace(options)
  if (!workspace.git?.head) fail('이 작업에는 커밋이 있는 Git checkout이 필요합니다. 단독 구현은 기존 스킬 흐름으로 진행할 수 있습니다.')
  return { workspace, root: runtimeRoot(workspace), cwd: workspace.git.root }
}

function groupOf(state, id) {
  const group = Object.hasOwn(state.groups, id ?? '') ? state.groups[id] : null
  if (!group || group.status !== 'active') fail(`활성 작업 묶음을 찾을 수 없습니다: ${id ?? '(미지정)'}`)
  return group
}

function attemptOf(state, id) {
  const attempt = Object.hasOwn(state.attempts, id ?? '') ? state.attempts[id] : null
  if (!attempt) fail(`실행 기록을 찾을 수 없습니다: ${id ?? '(미지정)'}`)
  return attempt
}

function noOperation(group) {
  if (group.operation) fail('작업 묶음에서 통합 명령이 실행 중입니다.', [JSON.stringify(group.operation)])
}

function requireStopped(processInfo) {
  if (!processInfo || processInfo.host !== os.hostname()) fail('이 호스트에서 중단 여부를 확인할 수 없는 명령입니다.')
  try { process.kill(processInfo.pid, 0); fail('명령 프로세스가 아직 실행 중입니다.') } catch (error) { if (error.code !== 'ESRCH') throw error }
}

function assertFreeWorkspace(state, destination, except) {
  for (const attempt of Object.values(state.attempts)) {
    if (attempt.id !== except && !attempt.cleanedAt && attempt.workspace === destination) {
      fail('이 작업 공간에는 이미 실행 기록이 있습니다. 종료·정리하거나 다른 공간을 사용하세요.', [attempt.id])
    }
  }
  if (Object.values(state.groups).some((group) => group.path === destination)) fail('기획·통합 공간을 워커에게 배정할 수 없습니다.')
}

async function destination(context, name, requested) {
  const main = context.workspace.git.worktrees.find((tree) => !tree.bare)?.path ?? context.cwd
  const identity = `${path.basename(main)}-${digest(context.workspace.git.commonDir).slice(0, 8)}`
  return canonicalDestination(path.resolve(requested ?? path.join(path.dirname(main), '.haeram-worktrees', identity, name)))
}

async function requireClean(root) {
  if (!(await clean(root))) fail('미커밋·미추적 변경이 있습니다. 해당 작업을 먼저 정리하세요.', [root])
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (await git(root, ['rev-parse', '--verify', '--quiet', marker], [1])) fail(`Git ${marker} 작업이 진행 중입니다.`, [root])
  }
  for (const marker of ['rebase-merge', 'rebase-apply']) {
    const location = (await git(root, ['rev-parse', '--git-path', marker])).replace(/\r?\n$/, '')
    try { await access(path.resolve(root, location)); fail('Git rebase 작업이 진행 중입니다.', [root]) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

async function assertWorkspace(context, entry) {
  const workspace = await inspectWorkspace({ targetRoot: entry.workspace ?? entry.path })
  if (workspace.git?.commonDir !== context.workspace.git.commonDir || workspace.git.gitDir !== entry.gitDir || workspace.git.branch !== entry.branch) {
    fail('작업 공간의 저장소·브랜치·Git 경로가 배정 이후 바뀌었습니다.', [entry.workspace ?? entry.path])
  }
  return workspace
}

function taskContract(content) {
  const map = sections(content)
  return digest(JSON.stringify({ title: content.match(/^# .+$/m)?.[0], quote: quoteLine(content), goal: map.get('goal'), notes: map.get('impl notes'),
    acceptance: map.get('acceptance')?.map((row) => row.replace(/^- \[v\]/, '- [ ]')) }))
}

async function currentTask(context, group, taskId, snapshot) {
  const commit = snapshot?.commit ?? await head(context.cwd, `refs/heads/${group.branch}`)
  const board = snapshot?.board ?? await readTaskBoard({ targetRoot: context.cwd, ref: commit })
  if (!board.ok || board.warnings.length) fail('상위 브랜치의 태스크/STATE를 먼저 정리하고 커밋하세요.', [...board.errors, ...board.warnings])
  const task = board.tasks.find((item) => item.id === taskId)
  if (!task?.dependencyReady) fail(`${taskId}: todo 상태이며 상위 브랜치에서 dep이 충족된 태스크만 배정할 수 있습니다.`)
  for (const base of task.base) {
    const parsed = base.match(/^([A-Z]{2,6})@(\d+)$/)
    if (!parsed) fail(`${taskId}: 잘못된 SSOT base: ${base}`)
    const ssot = await blob(context.cwd, commit, `spec/ssot/${parsed[1]}.md`)
    const revision = quoteLine(ssot ?? '')?.match(/^r(\d+)\b/)?.[1]
    if (revision !== parsed[2]) fail(`${taskId}: ${base}가 현재 SSOT와 다릅니다. 기획 공간에서 신선도를 확인하고 태스크를 갱신하세요.`)
  }
  return { commit, task, content: await blob(context.cwd, commit, task.file) }
}

async function checkWorker(context, group, attempt) {
  const workspace = await assertWorkspace(context, attempt)
  await requireClean(attempt.workspace)
  const current = await currentTask(context, group, attempt.taskId)
  const content = await blob(context.cwd, workspace.git.head, current.task.file)
  if (!content || taskContract(content) !== taskContract(current.content)) fail('태스크 계약이 상위 브랜치와 다릅니다. 기획 변경을 확인하고 작업을 동기화하세요.')
  const acceptance = sections(content).get('acceptance') ?? []
  if (!acceptance.some((row) => /^- \[v\] /.test(row)) || acceptance.some((row) => /^- \[[^v]\]/.test(row))) fail('태스크 acceptance를 실제로 확인하고 모두 [v]로 기록하세요.')
  const result = (sections(content).get('result') ?? []).join('\n')
  for (const key of ['outcome', 'at', 'verified', 'limits']) {
    if (!new RegExp(`^- ${key}: .+`, 'm').test(result)) fail(`태스크 result에 ${key} 기록이 필요합니다.`)
  }
  const refs = quoteFields(quoteLine(current.content) ?? '')
  for (const base of splitRefs(refs.get('base'))) {
    const domain = base.split('@')[0]
    const file = `spec/ssot/${domain}.md`
    const canonical = await blob(context.cwd, current.commit, file)
    if (!canonical || canonical !== await blob(context.cwd, workspace.git.head, file)) fail(`${domain}: 상위 브랜치의 SSOT가 달라졌습니다. 동기화 후 다시 검증하세요.`)
  }
  const common = (await git(context.cwd, ['merge-base', current.commit, workspace.git.head])).trim()
  const changes = (await git(context.cwd, ['diff', '--name-only', '-z', common, workspace.git.head, '--', 'spec/'])).split('\0').filter(Boolean)
  if (changes.some((file) => file !== current.task.file)) fail('워커는 자신의 태스크 외 spec 문서를 변경할 수 없습니다. 기획 공간으로 인계하세요.', changes)
  return { ...current, workerCommit: workspace.git.head }
}

function commands(options) {
  const values = options.verify ?? []
  if (!Array.isArray(values) || !values.length || values.some((value) => typeof value !== 'string' || !value.trim())) {
    fail('실행할 검증 명령을 --verify로 지정하세요. 여러 번 지정할 수 있습니다.')
  }
  return values
}

async function verify(root, checks, commit, signal) {
  const results = []
  for (const command of checks) {
    const startedAt = now()
    try {
      const { stdout, stderr } = await execute(command, { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 15 * 60 * 1000, signal })
      results.push({ command, startedAt, finishedAt: now(), stdout: stdout.slice(-16000), stderr: stderr.slice(-16000) })
    } catch (error) {
      fail(`검증 실패: ${command}`, [(error.stderr || error.stdout || error.message).slice(-16000)])
    }
    if (await head(root) !== commit) fail('검증 명령 실행 중 HEAD가 변경됐습니다. 새 커밋을 다시 검증하세요.')
    await requireClean(root)
  }
  return results
}

export async function inspectWork(options = {}) {
  const workspace = await inspectWorkspace(options)
  if (!workspace.git) return { schemaVersion: 1, mode: 'single', groups: [], attempts: [], lock: null }
  const root = runtimeRoot(workspace)
  const state = await readRuntime(root)
  const groups = Object.values(state.groups)
  const attempts = Object.values(state.attempts)
  const currentAttempt = attempts.find((entry) => entry.workspace === workspace.git.root && !entry.cleanedAt) ?? null
  const currentGroup = groups.find((entry) => entry.path === workspace.git.root && entry.status === 'active') ?? null
  const currentReview = attempts.flatMap((entry) => [entry.review, ...(entry.reviewHistory ?? [])]).find((review) => review?.workspace === workspace.git.root) ?? null
  return { schemaVersion: 1, mode: currentReview ? 'reviewer' : currentAttempt ? 'worker' : currentGroup ? 'group' : 'single',
    currentAttempt, currentReview, currentGroup, groups, attempts, lock: await readLock(root) }
}

export async function startWork(options) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.name ?? '') || options.name.length > 60) fail('작업 이름은 60자 이하의 kebab-case로 지정하세요.')
  const context = await repository(options)
  const mode = options.workspace ?? 'auto'
  if (!['auto', 'new', 'current'].includes(mode)) fail('workspace는 auto, current, new 중 하나여야 합니다.')
  const adopted = mode === 'current' || (mode === 'auto' && context.workspace.git.isLinkedWorktree && !options.path && !options.base && !options.branch)
  if (adopted && (options.path || options.base || options.branch)) fail('current 모드는 현재 브랜치를 그대로 연결합니다. path/base/branch를 함께 지정하지 마세요.')
  const branch = adopted ? context.workspace.git.branch : options.branch ?? `work/${options.name}`
  if (!branch) fail('작업 묶음은 브랜치가 필요합니다. detached HEAD에서는 new 모드를 사용하세요.')
  await git(context.cwd, ['check-ref-format', '--branch', branch])
  const baseRef = adopted ? null : options.base ?? context.workspace.git.branch
  if (!adopted && !baseRef) fail('분기 기준을 --base로 지정하세요.')
  const baseCommit = await head(context.cwd, baseRef ?? 'HEAD')
  // Avoid silently omitting the user's uncommitted planning documents.
  await requireClean(context.cwd)
  const target = adopted ? context.cwd : await destination(context, `${options.name}-plan`, options.path)
  const group = { id: options.name, branch, baseRef, baseCommit, path: target, managed: !adopted, status: 'preparing', creator: creator(), createdAt: now(), limits: workLimits(options) }
  await transaction(context.root, (state) => {
    if (Object.hasOwn(state.groups, group.id)) fail('같은 이름의 작업 묶음이 이미 있습니다. work status를 확인하세요.')
    if (Object.values(state.groups).some((entry) => entry.branch === branch || entry.path === target)) fail('이미 사용 중인 기획 브랜치 또는 작업 공간입니다.')
    if (Object.values(state.attempts).some((entry) => !entry.cleanedAt && entry.workspace === target)) fail('워커가 사용 중인 공간입니다.')
    state.groups[group.id] = group
  })
  try {
    if (!adopted) await git(context.cwd, ['worktree', 'add', '-b', branch, target, baseCommit])
    const created = await inspectWorkspace({ targetRoot: target })
    return await transaction(context.root, (state) => {
      Object.assign(state.groups[group.id], { gitDir: created.git.gitDir, status: 'active' })
      return state.groups[group.id]
    })
  } catch (error) {
    await transaction(context.root, (state) => { Object.assign(state.groups[group.id], { status: 'failed', error: error.message }) })
    throw new SkillPackageError('작업 공간 준비에 실패했습니다. 현재 작업 공간은 전환하지 않았습니다. 남은 경로/브랜치를 확인하세요.', [target, branch, error.message])
  }
}

export async function claimWork(options) {
  if (!TASK_ID.test(options.task ?? '')) fail('배정할 태스크 ID가 필요합니다 (T###).')
  return claimTask(options)
}

export async function claimNextWork(options) {
  if (!options.owner?.trim()) fail('claim-next에는 --owner가 필요합니다.')
  return claimTask(options, true)
}

async function claimTask(options, next = false) {
  const context = await repository(options)
  const initial = await readRuntime(context.root)
  const group = groupOf(initial, options.work)
  const commit = await head(context.cwd, `refs/heads/${group.branch}`)
  const board = await readTaskBoard({ targetRoot: context.cwd, ref: commit })
  if (!board.ok || board.warnings.length) fail('상위 브랜치의 태스크/STATE를 먼저 정리하고 커밋하세요.', [...board.errors, ...board.warnings])
  // Read/validate immutable task snapshots before the short allocation transaction.
  const candidates = []
  const skipped = []
  for (const task of rankedTasks(board.tasks).filter((task) => next ? task.dependencyReady : task.id === options.task)) {
    try { candidates.push(await currentTask(context, group, task.id, { commit, board })) } catch (error) {
      if (!next) throw error
      skipped.push({ task: task.id, reason: error.message })
    }
  }
  if (!next && !candidates.length) fail(`${options.task}: todo 상태이며 상위 브랜치에서 dep이 충족된 태스크만 배정할 수 있습니다.`)
  const mode = options.workspace ?? 'auto'
  if (!['auto', 'current', 'new'].includes(mode)) fail('workspace는 auto, current, new 중 하나여야 합니다.')
  const bound = Object.values(initial.attempts).some((entry) => entry.workspace === context.cwd && !entry.cleanedAt)
  const adopted = mode === 'current' || (mode === 'auto' && !options.path && !bound && context.workspace.git.isLinkedWorktree && context.cwd !== group.path)
  if (adopted && options.path) fail('current 모드에 path를 함께 지정하지 마세요.')
  if (adopted) {
    await requireClean(context.cwd)
    if (!(await ancestor(context.cwd, commit, context.workspace.git.head))) fail('현재 공간에 상위 작업 브랜치의 최신 커밋이 없습니다. 먼저 동기화하거나 --workspace new를 사용하세요.')
  }
  const id = randomUUID()
  const owner = options.owner ?? 'agent'
  const prepared = await Promise.all(candidates.map(async (current) => ({ current,
    target: adopted ? context.cwd : await destination(context, `${group.id}-${current.task.id}-${id.slice(0, 8)}`, options.path),
  })))
  const selected = await transaction(context.root, async (state) => {
    const live = groupOf(state, group.id)
    const idle = (reason) => { if (!next) fail(reason); return { idle: true, reason, skipped } }
    if (live.operation) return idle('integration-in-progress')
    if (await head(context.cwd, `refs/heads/${group.branch}`) !== commit || candidates.some((entry) => entry.commit !== commit)) return idle('planning-changed; retry')
    const all = Object.values(state.attempts)
    const local = all.filter((entry) => entry.group === group.id)
    const limits = workLimits(live.limits)
    if (local.filter(workerBusy).length >= limits.workers) return idle('worker-capacity')
    if (next && local.some((entry) => workerBusy(entry) && entry.owner === owner)) return idle('owner-busy')
    if (local.some((entry) => entry.status === 'changes_requested')) return idle('changes-requested; resume corrections first')
    if (local.filter(pendingReview).length >= limits.maxPending) return idle('review-backpressure')
    const available = prepared.find(({ current }) => !all.some((entry) => active(entry) &&
      (entry.taskId === current.task.id || overlaps(current.task.touches, entry.touches))))
    if (!available) return idle(next ? 'no-eligible-task' : `${options.task}: 다른 실행이 이미 선점했거나 touches 영역을 사용 중입니다.`)
    const { current, target } = available
    assertFreeWorkspace(state, target)
    const branch = adopted ? context.workspace.git.branch : `task/${group.id}/${current.task.id}-${id.slice(0, 8)}`
    const attempt = { id, group: group.id, taskId: current.task.id, owner, contributors: [owner], workspace: target,
      branch, managed: !adopted, startCommit: commit, touches: current.task.touches, status: 'preparing', creator: creator(), createdAt: now(), heartbeatAt: now() }
    state.attempts[id] = attempt
    return attempt
  })
  if (selected.idle) return selected
  try {
    if (!adopted) await git(context.cwd, ['worktree', 'add', '-b', selected.branch, selected.workspace, selected.startCommit])
    const created = await inspectWorkspace({ targetRoot: selected.workspace })
    return await transaction(context.root, (state) => {
      if (attemptOf(state, id).status !== 'preparing') fail('작업 공간 준비 중 배정 상태가 변경됐습니다.')
      Object.assign(attemptOf(state, id), { gitDir: created.git.gitDir, status: 'doing' })
      return state.attempts[id]
    })
  } catch (error) {
    await transaction(context.root, (state) => {
      const entry = attemptOf(state, id)
      if (entry.status === 'preparing') Object.assign(entry, { status: 'failed', error: error.message })
    })
    throw new SkillPackageError('태스크 작업 공간 준비에 실패했습니다. 병렬 쓰기로 우회하지 않습니다.', [selected.workspace, selected.branch ?? '(detached)', error.message])
  }
}

export async function updateWork(options) {
  const context = await repository(options)
  return transaction(context.root, (state) => {
    const attempt = attemptOf(state, options.attempt)
    noOperation(groupOf(state, attempt.group))
    if (!['doing', 'blocked', 'ready', 'approved', 'changes_requested'].includes(attempt.status)) fail(`이 실행은 갱신할 수 없습니다: ${attempt.status}`)
    if (options.status && !['doing', 'blocked'].includes(options.status)) fail('상태는 doing 또는 blocked만 지정할 수 있습니다. ready는 submit으로 검증합니다.')
    if (options.status === 'blocked' && !options.reason?.trim()) fail('blocked에는 --reason이 필요합니다.')
    if (options.status) {
      if (options.status === 'doing' && !workerBusy(attempt) && Object.values(state.attempts).filter((entry) => entry.group === attempt.group && workerBusy(entry)).length >= workLimits(groupOf(state, attempt.group).limits).workers) fail('worker-capacity')
      invalidateReview(attempt, 'worker resumed or blocked')
      attempt.status = options.status
      attempt.reason = options.reason ?? null
      delete attempt.verifiedCommit
    }
    attempt.heartbeatAt = now()
    return attempt
  })
}

export async function releaseWork(options) {
  const context = await repository(options)
  return transaction(context.root, (state) => {
    const attempt = attemptOf(state, options.attempt)
    noOperation(groupOf(state, attempt.group))
    if (!['doing', 'blocked', 'ready', 'approved', 'changes_requested', 'preparing', 'failed'].includes(attempt.status)) fail(`이 실행은 해제할 수 없습니다: ${attempt.status}`)
    if (attempt.status === 'preparing') requireStopped(attempt.creator)
    invalidateReview(attempt, 'attempt released')
    attempt.status = 'released'
    attempt.reason = options.reason ?? 'explicit release; workspace retained'
    attempt.releasedAt = now()
    return attempt
  })
}

async function reserve(context, attemptId, operation, allowed) {
  const token = randomUUID()
  return transaction(context.root, (state) => {
    const attempt = attemptOf(state, attemptId)
    const group = groupOf(state, attempt.group)
    noOperation(group)
    if (!allowed.includes(attempt.status)) fail(`${operation}할 수 없는 상태입니다: ${attempt.status}`)
    if (operation === 'integrating' && (attempt.review?.status !== 'approved' || attempt.review.commit !== attempt.verifiedCommit)) fail('현재 제출 커밋에 대한 리뷰 승인이 필요합니다.')
    if (operation === 'verifying' && !workerBusy(attempt) && Object.values(state.attempts).filter((entry) => entry.group === attempt.group && workerBusy(entry)).length >= workLimits(group.limits).workers) fail('worker-capacity')
    if (operation === 'verifying') { invalidateReview(attempt, 'new submission'); delete attempt.verifiedCommit }
    attempt.operation = { token, attempt: attemptId, kind: operation, pid: process.pid, host: os.hostname(), at: now() }
    if (operation === 'integrating') group.operation = attempt.operation
    attempt.status = operation
    return { attempt: structuredClone(attempt), group: structuredClone(group), token }
  })
}

async function finishOperation(context, reservation, update) {
  return transaction(context.root, (state) => {
    const attempt = attemptOf(state, reservation.attempt.id)
    const group = groupOf(state, reservation.group.id)
    if (attempt.operation?.token !== reservation.token) fail('작업 명령의 소유권이 바뀌었습니다.')
    update(attempt)
    if (group.operation?.token === reservation.token) delete group.operation
    delete attempt.operation
    return attempt
  })
}

export async function submitWork(options) {
  const checks = commands(options)
  const context = await repository(options)
  const reservation = await reserve(context, options.attempt, 'verifying', ['doing', 'blocked', 'ready', 'approved', 'changes_requested'])
  try {
    const current = await checkWorker(context, reservation.group, reservation.attempt)
    const verification = await verify(reservation.attempt.workspace, checks, current.workerCommit, options.signal)
    await assertWorkspace(context, reservation.attempt)
    if (await head(context.cwd, `refs/heads/${reservation.group.branch}`) !== current.commit) fail('검증 중 상위 브랜치가 변경됐습니다. 최신 기준을 확인하고 다시 제출하세요.')
    options.signal?.throwIfAborted()
    await git(context.cwd, ['update-ref', `refs/haeram/attempts/${reservation.attempt.id}`, current.workerCommit])
    return await finishOperation(context, reservation, (attempt) => Object.assign(attempt, {
      status: 'ready', submissionId: randomUUID(), verifiedCommit: current.workerCommit, submittedBase: current.commit, verification, submittedAt: now(), reason: null,
    }))
  } catch (error) {
    await finishOperation(context, reservation, (attempt) => Object.assign(attempt, { status: 'blocked', reason: error.message }))
    throw error
  }
}

async function archiveTask(root, task, worker, verification) {
  const file = path.join(root, task.file)
  let content = await readFile(file, 'utf8')
  content = content.replace(/^> st:[^|]+\|/m, `> st:done@${date()} |`)
  content = content.replace(/^- at:.*$/m, `- at: ${worker}`)
  // Store the checks actually executed by submit, independent of the worker's wording.
  content = content.replace(/^- verified:.*$/m, () => `- verified: ${verification.map((entry) => JSON.stringify(entry.command)).join('; ')}`)
  await writeFile(file, content)
  const archive = path.join(root, 'spec', 'tasks', 'done', path.basename(file))
  try { await access(archive, constants.F_OK); fail('완료 아카이브 파일이 이미 있습니다.', [archive]) } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(path.dirname(archive), { recursive: true })
  await rename(file, archive)
  const statePath = path.join(root, 'spec', 'STATE.md')
  const state = await readFile(statePath, 'utf8')
  let section = null
  let removed = false
  const rows = state.split(/\r?\n/).filter((row) => {
    if (row.startsWith('## ')) section = row.slice(3).trim()
    if (section === 'tasks' && new RegExp(`^\\|\\s*${task.id}\\s*\\|`).test(row)) { removed = true; return false }
    return true
  })
  if (!removed) fail('STATE에서 완료 처리할 태스크 행을 찾지 못했습니다.')
  let next = rows.join('\n').replace(/(## log\s*\n)/, `$1- ${date()} ${task.id} integrated\n`)
  next = next.replace(/## next\n[\s\S]*?(?=\n## |$)/, '## next\n- inspect work board for remaining tasks\n')
  const log = next.indexOf('## log\n')
  if (log !== -1) next = next.slice(0, log) + '## log\n' + next.slice(log + 7).split('\n').filter((row) => row.startsWith('- ')).slice(0, 20).join('\n') + '\n'
  await writeFile(statePath, next)
}

export async function integrateWork(options) {
  const checks = commands(options)
  const context = await repository(options)
  const reservation = await reserve(context, options.attempt, 'integrating', ['approved'])
  const { attempt, group } = reservation
  let candidate
  let applied = false
  try {
    await assertWorkspace(context, group)
    await requireClean(group.path)
    const current = await checkWorker(context, group, attempt)
    if (attempt.review.baseCommit !== current.commit) {
      await finishOperation(context, reservation, (entry) => { invalidateReview(entry, 'integration base changed'); entry.status = 'ready'; entry.reason = 'review-base-changed' })
      fail('상위 브랜치가 리뷰 이후 변경됐습니다. 최신 기준으로 재리뷰하세요.')
    }
    if (current.workerCommit !== attempt.verifiedCommit) fail('제출 이후 워커 HEAD가 바뀌었습니다. submit으로 다시 검증하세요.')
    if (await head(group.path) !== current.commit) fail('기획 공간의 HEAD와 작업 브랜치가 다릅니다.')
    candidate = await destination(context, `${group.id}-integrate-${randomUUID().slice(0, 8)}`)
    await transaction(context.root, (state) => {
      const entry = attemptOf(state, attempt.id)
      Object.assign(entry, { candidate, targetCommit: current.commit, candidateCommit: null, integrationVerification: null })
      entry.candidates = [...(entry.candidates ?? []), candidate]
    })
    await git(context.cwd, ['worktree', 'add', '--detach', candidate, current.commit])
    await git(candidate, ['merge', '--no-ff', '--no-commit', attempt.verifiedCommit])
    await archiveTask(candidate, current.task, attempt.verifiedCommit, attempt.verification)
    const spec = await lintSpec({ targetRoot: candidate })
    if (!spec.ok || spec.warnings.length) fail('통합 후보의 spec 검증에 실패했습니다.', [...spec.errors, ...spec.warnings])
    await git(candidate, ['add', '--', 'spec/STATE.md', current.task.file, `spec/tasks/done/${path.basename(current.task.file)}`])
    await git(candidate, ['commit', '-m', `Integrate ${attempt.taskId} into ${group.id}`])
    const candidateCommit = await head(candidate)
    const verification = await verify(candidate, checks, candidateCommit, options.signal)
    await assertWorkspace(context, group)
    await requireClean(group.path)
    if (await head(group.path) !== current.commit) fail('검증 중 상위 브랜치가 이동했습니다. 새 기준으로 다시 통합하세요.')
    // Persist the receipt before moving the target. recover can reconcile a crash
    // between fast-forward and the last registry update.
    await transaction(context.root, (state) => { Object.assign(attemptOf(state, attempt.id), { candidateCommit, integrationVerification: verification }) })
    options.signal?.throwIfAborted()
    await git(group.path, ['merge', '--ff-only', candidateCommit])
    applied = true
    return await finishOperation(context, reservation, (entry) => Object.assign(entry, {
      status: 'integrated', integratedCommit: candidateCommit, integratedAt: now(), reason: null,
    }))
  } catch (error) {
    if (!applied) {
      const latest = (await readRuntime(context.root)).attempts[attempt.id]
      if (latest.operation?.token === reservation.token) {
        const sameWorker = await head(attempt.workspace).catch(() => null) === attempt.verifiedCommit && await clean(attempt.workspace).catch(() => false)
        const sameBase = await head(group.path).catch(() => null) === attempt.review.baseCommit
        await finishOperation(context, reservation, (entry) => {
          if (!sameWorker || !sameBase) invalidateReview(entry, 'review snapshot changed')
          Object.assign(entry, { status: !sameWorker ? 'blocked' : sameBase ? 'approved' : 'ready', reason: error.message })
        })
      }
    }
    throw new SkillPackageError('통합을 완료하지 못했습니다. 후보 작업 공간을 보존했습니다. work status/recover로 확인하세요.', [candidate ?? '(후보 생성 전)', error.message, ...(error.details ?? [])])
  }
}

export async function recoverWork(options) {
  const context = await repository(options)
  const state = await readRuntime(context.root)
  if (options.work) {
    if (options.attempt) fail('복구 대상은 --work 또는 --attempt 중 하나만 지정하세요.')
    const group = Object.hasOwn(state.groups, options.work) ? state.groups[options.work] : null
    if (!group || !['preparing', 'failed'].includes(group.status)) fail('복구할 작업 묶음 생성 기록이 없습니다.')
    if (group.status === 'preparing') requireStopped(group.creator)
    const workspace = await inspectWorkspace({ targetRoot: group.path })
    if (workspace.git?.commonDir !== context.workspace.git.commonDir || workspace.git.branch !== group.branch ||
        !(await ancestor(context.cwd, group.baseCommit, workspace.git.head))) fail('생성하려던 브랜치/경로와 현재 작업 공간이 다릅니다.')
    return transaction(context.root, (current) => {
      const entry = current.groups[group.id]
      if (entry.status !== group.status) fail('복구 중 생성 기록이 변경됐습니다.')
      Object.assign(entry, { status: 'active', gitDir: workspace.git.gitDir, managed: false, recoveredAt: now() })
      return entry
    })
  }
  const attempt = attemptOf(state, options.attempt)
  const group = groupOf(state, attempt.group)
  const operation = attempt.operation
  if (!operation || operation.attempt !== attempt.id) fail('복구할 실행 중 명령이 없습니다.')
  requireStopped(operation)
  if (operation.kind === 'cleaning') {
    const workspace = (await inspectWorkspace({ targetRoot: context.cwd })).git.worktrees.find((tree) => tree.path === attempt.workspace)
    let missing = false
    try { await access(attempt.workspace) } catch (error) { if (error.code !== 'ENOENT') throw error; missing = true }
    return finishOperation(context, { attempt, group, token: operation.token }, (entry) => {
      entry.status = entry.integratedCommit ? 'integrated' : 'released'
      if (!workspace && missing) entry.cleanedAt = now()
      entry.reason = 'interrupted cleanup recovered; inspect retained candidates'
    })
  }
  const integrated = Boolean(attempt.candidateCommit && attempt.integrationVerification && await ancestor(context.cwd, attempt.candidateCommit, await head(context.cwd, `refs/heads/${group.branch}`)))
  return finishOperation(context, { attempt, group, token: operation.token }, (entry) => Object.assign(entry, integrated
    ? { status: 'integrated', integratedCommit: entry.candidateCommit, integratedAt: now(), reason: null }
    : { status: 'blocked', reason: 'interrupted operation; inspect preserved workspace before resubmitting' }))
}

export async function cleanupWork(options) {
  const context = await repository(options)
  const reservation = await reserve(context, options.attempt, 'cleaning', ['integrated', 'released'])
  const previous = reservation.attempt.integratedCommit ? 'integrated' : 'released'
  const { attempt, group } = reservation
  try {
    if (attempt.cleanedAt) fail('이미 정리된 실행입니다.')
    await assertWorkspace(context, attempt)
    await requireClean(attempt.workspace)
    const workerHead = await head(attempt.workspace)
    if (!(await ancestor(context.cwd, workerHead, await head(context.cwd, `refs/heads/${group.branch}`)))) fail('상위 브랜치에 포함되지 않은 커밋이 있습니다. 작업 공간을 보존합니다.')
    if (attempt.managed) {
      if ((await git(attempt.workspace, ['status', '--porcelain', '--ignored'])).trim()) fail('ignored 파일을 포함해 남은 파일이 있습니다. 확인 후 정리하세요.')
      await git(context.cwd, ['worktree', 'remove', attempt.workspace])
    }
    const preservedCandidates = []
    for (const candidate of attempt.candidates ?? []) {
      try {
        const inspection = await inspectWorkspace({ targetRoot: candidate })
        if (inspection.git?.commonDir !== context.workspace.git.commonDir || !inspection.git.detached ||
            (await git(candidate, ['status', '--porcelain', '--ignored'])).trim() ||
            !(await ancestor(context.cwd, inspection.git.head, await head(group.path)))) {
          preservedCandidates.push(candidate)
          continue
        }
        await git(context.cwd, ['worktree', 'remove', candidate])
      } catch { preservedCandidates.push(candidate) }
    }
    return await finishOperation(context, reservation, (entry) => Object.assign(entry, { status: previous, cleanedAt: now(), workspaceRetained: !attempt.managed, preservedCandidates }))
  } catch (error) {
    await finishOperation(context, reservation, (entry) => Object.assign(entry, { status: previous, reason: error.message }))
    throw error
  }
}

export async function workBoard(options) {
  const context = await repository(options)
  const state = await readRuntime(context.root)
  const group = groupOf(state, options.work)
  const board = await readTaskBoard({ targetRoot: context.cwd, ref: `refs/heads/${group.branch}` })
  const attempts = Object.values(state.attempts)
  for (const task of board.tasks) {
    const attempt = attempts.find((entry) => entry.taskId === task.id && active(entry))
    task.attempt = attempt ?? null
    task.claimable = task.dependencyReady && !attempt && !group.operation && board.ok && board.warnings.length === 0 && !attempts.some((entry) => active(entry) && overlaps(task.touches, entry.touches))
    task.runtimeStatus = attempt?.status ?? null
  }
  return { ...board, scope: 'work', group, limits: workLimits(group.limits), attempts: attempts.filter((entry) => entry.group === group.id),
    queues: Object.fromEntries(['doing', 'ready', 'reviewing', 'approved', 'changes_requested', 'blocked'].map((status) => [status, attempts.filter((entry) => entry.group === group.id && entry.status === status).map((entry) => entry.id)])) }
}

export async function unlockWork(options) {
  const context = await repository(options)
  return unlockRuntime(context.root, options.lockId)
}

// Shared protocol primitives; only public lifecycle APIs are re-exported by index.mjs.
export const workInternals = { repository, groupOf, attemptOf, noOperation, requireStopped, destination, requireClean, assertWorkspace, checkWorker, head, clean, now, creator, fail, verify, commands }

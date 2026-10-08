import { activeAttempt, workerBusy, pendingReview } from './work-policy.mjs'

const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]))
const checks = (values) => values?.map((value) => pick(value, ['command', 'startedAt', 'finishedAt']))
const dispatch = (value) => value && pick(value, ['id', 'runner', 'role', 'slot', 'provider', 'model', 'status', 'startedAt', 'finishedAt', 'error', 'summary'])
const review = (value) => value && pick(value, ['id', 'owner', 'status', 'verdict', 'summary', 'findings', 'commit', 'baseCommit', 'submissionId', 'createdAt', 'finishedAt', 'releasedAt', 'invalidatedAt', 'invalidationReason', 'reason'])
const run = (value) => value && pick(value, ['id', 'adapter', 'providers', 'workers', 'startedAt', 'stoppedAt', 'dispatched', 'outcome', 'failures'])

export function progressAttempt(value) {
  return {
    ...pick(value, ['id', 'group', 'taskId', 'owner', 'contributors', 'status', 'reason', 'error', 'createdAt', 'startCommit', 'verifiedCommit', 'submittedBase', 'submissionId', 'submittedAt', 'integratedCommit', 'integratedAt', 'releasedAt', 'cleanedAt']),
    ...(value.dispatch ? { dispatch: dispatch(value.dispatch) } : {}),
    ...(value.review ? { review: review(value.review) } : {}),
    ...(value.reviewHistory?.length ? { reviewHistory: value.reviewHistory.map(review) } : {}),
    ...(value.verification ? { verification: checks(value.verification) } : {}),
    ...(value.integrationVerification ? { integrationVerification: checks(value.integrationVerification) } : {}),
  }
}

const progressGroup = (value) => ({ ...pick(value, ['id', 'branch', 'status', 'createdAt', 'limits']),
  ...(value.runner ? { runner: run(value.runner) } : {}), ...(value.lastRun ? { lastRun: run(value.lastRun) } : {}) })

// History and the latest state are committed by the same atomic runtime rename.
// Heartbeats, PIDs, local paths and command output are deliberately not history.
export function recordProgress(previous, state, at = new Date().toISOString()) {
  state.history ??= []
  for (const [collection, project, type] of [['groups', progressGroup, 'group'], ['attempts', progressAttempt, 'attempt']]) {
    for (const [id, entry] of Object.entries(state[collection])) {
      const old = Object.hasOwn(previous[collection], id) ? project(previous[collection][id]) : null
      const next = project(entry)
      if (JSON.stringify(old) === JSON.stringify(next)) continue
      const changes = Object.fromEntries([...new Set([...Object.keys(old ?? {}), ...Object.keys(next)])]
        .filter((key) => JSON.stringify(old?.[key]) !== JSON.stringify(next[key]))
        .map((key) => [key, next[key] ?? null]))
      state.history.push({ sequence: state.history.length + 1, at, type, group: type === 'group' ? id : entry.group,
        ...(type === 'attempt' ? { attemptId: id, taskId: entry.taskId } : {}), previousStatus: old?.status ?? null, status: next.status, changes })
    }
  }
}

export function workSummary(board, attempts) {
  const completed = new Set(attempts.filter((entry) => entry.status === 'integrated' && board.doneIds.includes(entry.taskId)).map((entry) => entry.taskId))
  const live = attempts.filter((entry) => activeAttempt(entry) && board.tasks.some((task) => task.id === entry.taskId))
  return { total: board.tasks.length + completed.size, completed: completed.size, remaining: board.tasks.length,
    running: live.filter(workerBusy).length, review: live.filter(pendingReview).length,
    blocked: live.filter((entry) => ['blocked', 'changes_requested'].includes(entry.status)).length,
    unassigned: board.tasks.filter((task) => !live.some((entry) => entry.taskId === task.id)).length }
}

export function progressSnapshot(group, board, state) {
  const attempts = Object.values(state.attempts).filter((entry) => entry.group === group.id)
  return { schemaVersion: 1, snapshotAt: new Date().toISOString(), sourceCommit: board.commit,
    group: progressGroup(group), summary: workSummary(board, attempts),
    tasks: board.tasks.map((task) => ({ id: task.id, title: task.title, dep: task.deps,
      status: attempts.find((entry) => entry.taskId === task.id && activeAttempt(entry))?.status ?? task.st })),
    attempts: attempts.map(progressAttempt), history: (state.history ?? []).filter((entry) => entry.group === group.id) }
}

export function progressState(markdown, snapshot, file) {
  const { summary, group, snapshotAt } = snapshot
  const row = `| ${group.id} | ${group.limits?.workers ?? 4} | ${summary.total} | ${summary.completed} | ${summary.remaining} | ${summary.running} | ${summary.review} | ${summary.blocked} | ${snapshotAt} | [history](${file}) |`
  const header = '| id | workers | total | done | remaining | running | review | blocked | updated | history |\n|---|---|---|---|---|---|---|---|---|---|'
  const section = markdown.match(/^## work\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)
  if (!section) {
    const addition = `## work\n${header}\n${row}\n\n`
    return /^## next\b/m.test(markdown) ? markdown.replace(/^## next\b/m, `${addition}## next`) : `${markdown.trimEnd()}\n\n${addition}`
  }
  let replaced = false
  const lines = section[1].trimEnd().split('\n').map((line) => {
    if (new RegExp(`^\\|\\s*${group.id}\\s*\\|`).test(line)) { replaced = true; return row }
    return line
  })
  if (!replaced) lines.push(row)
  return markdown.replace(section[0], () => `## work\n${lines.join('\n')}\n\n`)
}

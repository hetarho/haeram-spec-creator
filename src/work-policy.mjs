import { SkillPackageError } from './errors.mjs'

export const activeAttempt = (attempt) => !['released', 'failed', 'integrated'].includes(attempt.status)
export const workerBusy = (attempt) => ['preparing', 'doing', 'verifying'].includes(attempt.status)
export const pendingReview = (attempt) => ['ready', 'reviewing', 'approved', 'integrating'].includes(attempt.status)

export function workLimits(options = {}) {
  const limits = {}
  for (const [key, fallback] of [['workers', 4], ['reviewers', 1], ['maxPending', 8]]) {
    const value = Number(options[key] ?? fallback)
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new SkillPackageError(`${key}: 1~100 사이 정수가 필요합니다.`)
    limits[key] = value
  }
  return limits
}

export function invalidateReview(attempt, reason) {
  if (attempt.review) {
    attempt.reviewHistory = [...(attempt.reviewHistory ?? []), { ...attempt.review, invalidatedAt: new Date().toISOString(), invalidationReason: reason }]
    delete attempt.review
  }
}

// Paths are repo-relative literals, not shell globs. Directory prefixes overlap.
export function touchesErrors(value) {
  if (!value || value === '-') return []
  return value.split(/\s+/).filter((item) => item.startsWith('/') || item.includes('\\') || /[*?\[\]:]/.test(item) || item.split('/').some((part, i, all) => part === '..' || part === '.' || (!part && i !== all.length - 1)))
}
export function overlaps(left = [], right = []) {
  return left.some((a) => right.some((b) => {
    a = a.replace(/\/$/, ''); b = b.replace(/\/$/, '')
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
  }))
}
export function rankedTasks(tasks) {
  const descendants = (id, seen = new Set()) => {
    for (const task of tasks) if (task.deps.includes(id) && !seen.has(task.id)) { seen.add(task.id); descendants(task.id, seen) }
    return seen.size
  }
  return tasks.map((task) => ({ ...task, unlocks: descendants(task.id) }))
    .sort((a, b) => b.unlocks - a.unlocks || a.id.localeCompare(b.id, 'en', { numeric: true }))
}

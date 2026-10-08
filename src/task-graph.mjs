import { TASK_ID } from './spec-format.mjs'

export const LANE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })

// graph is the active task set; archived IDs satisfy edges without reading history.
export function dependencyErrors(graph, doneIds) {
  const errors = []
  for (const [id, deps] of graph) {
    for (const dep of deps) {
      if (!TASK_ID.test(dep)) errors.push(`${id}: dep 형식 오류: ${dep}`)
      else if (!graph.has(dep) && !doneIds.has(dep)) errors.push(`${id}: dep ${dep}가 활성 태스크에도 tasks/done/에도 없습니다.`)
    }
  }
  const visited = new Set()
  const visiting = new Set()
  const trail = []
  function visit(id) {
    if (visiting.has(id)) {
      errors.push(`dep 순환: ${[...trail.slice(trail.indexOf(id)), id].join(' → ')}`)
      return
    }
    if (visited.has(id) || !graph.has(id)) return
    visiting.add(id)
    trail.push(id)
    for (const dep of graph.get(id)) visit(dep)
    trail.pop()
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of graph.keys()) visit(id)
  return errors
}

// A lane is one work unit: its tasks are claimed, implemented in order, reviewed and
// integrated together. A lane-less task is a unit of its own.
export const unitKey = (id, lane) => lane ? `lane:${lane}` : id
export const laneValue = (value) => value && value !== '-' ? value : null

// Units must form a DAG. A lane may wait for another unit before it starts, but two
// lanes that wait on each other mid-way can never both finish.
export function laneErrors(lanes, graph) {
  const errors = []
  for (const [id, lane] of lanes) {
    if (lane && (!LANE.test(lane) || lane.length > 40)) errors.push(`${id}: lane 형식 오류: ${lane} (40자 이하 kebab-case)`)
  }
  const unitOf = (id) => unitKey(id, lanes.get(id))
  const edges = new Map()
  for (const [id, deps] of graph) {
    const from = unitOf(id)
    for (const dep of deps) {
      if (!graph.has(dep) || unitOf(dep) === from) continue
      if (!edges.has(from)) edges.set(from, new Map())
      const reasons = edges.get(from)
      reasons.set(unitOf(dep), [...(reasons.get(unitOf(dep)) ?? []), `${id}→${dep}`])
    }
  }
  const visited = new Set()
  const visiting = new Set()
  const trail = []
  const reported = new Set()
  function visit(unit) {
    if (visiting.has(unit)) {
      const cycle = [...trail.slice(trail.indexOf(unit)), unit]
      // A cycle of lane-less tasks is already a task cycle; report only lane deadlocks once.
      const key = [...new Set(cycle)].sort().join(' ')
      if (cycle.some((entry) => entry.startsWith('lane:')) && !reported.has(key)) {
        reported.add(key)
        const because = cycle.slice(1).map((next, index) => edges.get(cycle[index]).get(next).join(' ')).join(', ')
        errors.push(`lane 순환: ${cycle.join(' → ')} (${because}) — 서로 기다리는 줄기는 끝나지 않습니다. 공통 선행은 기반 태스크로, 소비 태스크는 통합 단계로 옮기거나 줄기를 합치세요.`)
      }
      return
    }
    if (visited.has(unit)) return
    visiting.add(unit)
    trail.push(unit)
    for (const next of [...(edges.get(unit)?.keys() ?? [])].sort()) visit(next)
    trail.pop()
    visiting.delete(unit)
    visited.add(unit)
  }
  for (const unit of [...new Set([...graph.keys()].map(unitOf))].sort()) visit(unit)
  return errors
}

// Inside a unit, dep order first and task ID second decide the implementation order.
function unitOrder(tasks) {
  const ids = new Set(tasks.map((task) => task.id))
  const pending = new Map(tasks.map((task) => [task.id, task.deps.filter((dep) => ids.has(dep) && dep !== task.id)]))
  const ordered = []
  while (pending.size) {
    const next = [...pending].filter(([, deps]) => deps.every((dep) => !pending.has(dep))).map(([id]) => id).sort(byId)[0]
      ?? [...pending.keys()].sort(byId)[0]
    ordered.push(tasks.find((task) => task.id === next))
    pending.delete(next)
  }
  return ordered
}

// claimed holds task IDs already owned by an active attempt; they never join a new unit.
export function planUnits(tasks, doneIds, claimed = new Set()) {
  const done = new Set(doneIds)
  const units = new Map()
  for (const task of tasks.filter((entry) => !claimed.has(entry.id))) {
    const key = unitKey(task.id, task.lane)
    if (!units.has(key)) units.set(key, { key, lane: task.lane ?? null, tasks: [] })
    units.get(key).tasks.push(task)
  }
  return [...units.values()].map((unit) => {
    const tasksInOrder = unitOrder(unit.tasks)
    const ids = tasksInOrder.map((task) => task.id)
    const waitingOn = [...new Set(unit.tasks.flatMap((task) => task.deps.filter((dep) => !ids.includes(dep) && !done.has(dep))))].sort(byId)
    return { key: unit.key, lane: unit.lane, ids, tasks: tasksInOrder, waitingOn,
      touches: [...new Set(unit.tasks.flatMap((task) => task.touches ?? []))],
      ready: waitingOn.length === 0 && unit.tasks.every((task) => task.st === 'todo') }
  }).sort((a, b) => byId(a.ids[0], b.ids[0]))
}

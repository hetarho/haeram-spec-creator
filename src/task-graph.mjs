import { TASK_ID } from './spec-format.mjs'

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

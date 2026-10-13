export const TASK_ID = /^T\d{3,}$/
export const TASK_ST = /^(todo|doing@\d{6}(\.[A-Za-z0-9]{2,8})?|done@\d{6}|blocked@\d{6})$/

export function sections(markdown) {
  const map = new Map()
  let current = null
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      current = []
      map.set(heading[1], current)
    } else if (current) {
      current.push(line)
    }
  }
  return map
}

export function tableRows(lines = []) {
  const rows = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length === 0) continue
    if (cells.every((cell) => /^:?-+:?$/.test(cell) || cell === '')) continue
    rows.push(cells)
  }
  return rows.slice(1)
}

export function quoteLine(markdown) {
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('> ')) return line.slice(2).trim()
  }
  return null
}

export function quoteFields(quote) {
  const fields = new Map()
  for (const part of quote.split('|')) {
    const trimmed = part.trim()
    const colon = trimmed.indexOf(':')
    if (colon > 0) fields.set(trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim())
  }
  return fields
}

export function splitRefs(cell) {
  return (cell ?? '').split(/[\s,]+/).filter((ref) => ref && ref !== '-')
}

// Exploratory tasks carry a wall-clock timebox; `-` or absence means an ordinary task.
export const EXPLORE = /^\d+[mh]$/
export const exploreValue = (value) => value && value !== '-' ? value : null
export const EXIT_LINE = /^- \[[ v]\] exit: \S/

// Session presence and the owner's inbox (STATE ## active · ## inbox).
export const SESSION_TAG = /^[A-Za-z0-9]{2,8}$/
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/
export const INBOX_LINE = /^- (\d{6}) (decided|parked|suggest) ([^:]+?): (\S.*)$/
export const REPORT_FILE = /^(\d{6}-[A-Za-z0-9]{2,8})\.md$/
export const REPORT_SECTIONS = ['done', 'decided', 'parked', 'checks', 'next']

// Decision blocks by ID: the decision line plus its indented sub-lines and table rows.
export function decisionBlocks(markdown) {
  const blocks = new Map()
  let current = null
  for (const line of sections(markdown).get('decisions') ?? []) {
    const head = line.match(/^-\s+([A-Z]{2,6}-\d+)\s+\[/)
    if (head) { current = [line]; blocks.set(head[1], current) }
    else if (current && /^\s+\S/.test(line)) current.push(line)
    else if (line.trim() !== '') current = null
  }
  return new Map([...blocks].map(([id, lines]) => [id, lines.join('\n')]))
}

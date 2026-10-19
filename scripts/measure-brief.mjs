#!/usr/bin/env node
// Task context size, before and after the 0.7 brief, read from one commit of a target project.
// Read-only: nothing is written to the target. Token counts need tiktoken on PYTHONPATH (--tokens);
// they are a tokenizer proxy (o200k_base), not a provider's billing or hidden system prompt.
//   node scripts/measure-brief.mjs --target ../project [--ref HEAD] [--tasks T201,T225] [--tokens] [--json]
//     [--questions questions.json]  {"T201": [{"q": "…", "evidence": [{"quote": "exact SSOT substring", "where": "PLAYER-6"}]}]}
// --questions asks the same policy questions of every variant: a question is answered when all its
// evidence quotes are present verbatim.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'
import { assembleBrief, commitSource, renderBrief } from '../src/spec-context.mjs'
import { parseSsot, references, refId, quoteLine, quoteFields, splitRefs, sections } from '../src/spec-format.mjs'

const execute = promisify(execFile)
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const root = path.resolve(option('--target', process.cwd()))
const commit = (await execute('git', ['-C', root, 'rev-parse', option('--ref', 'HEAD')])).stdout.trim()
const source = commitSource(root, commit)
const read = async (file) => (await source.read(file)) ?? ''
const docs = new Map()
for (const name of (await source.list('spec/ssot')).filter((entry) => entry.endsWith('.md'))) {
  const text = await read(`spec/ssot/${name}`)
  docs.set(name.slice(0, -3), { text, doc: parseSsot(text) })
}
const files = (await source.list('spec/tasks')).filter((name) => /^T\d+\..+\.md$/.test(name))
const wanted = option('--tasks', null)?.split(',') ?? null
const tasks = files.map((name) => name.split('.')[0]).filter((id) => !wanted || wanted.includes(id))
const block = (id) => docs.get(id.split('-')[0])?.doc.decisions.get(id)

// ≤0.6 brief: only the cited blocks, and only their indented lines (the old decisionBlocks).
function oldBlocks(markdown) {
  const blocks = new Map()
  let current = null
  for (const line of sections(markdown).get('decisions') ?? []) {
    const head = line.match(/^-\s+([A-Z]{2,6}-\d+)\s+\[/)
    if (head) { current = [line]; blocks.set(head[1], current) } else if (current && /^\s+\S/.test(line)) current.push(line)
    else if (line.trim() !== '') current = null
  }
  return new Map([...blocks].map(([id, lines]) => [id, lines.join('\n')]))
}
const flat = (text) => text.replace(/\n\s*\n/g, '\n')

// brief = the default (no cfg brief ⇒ scope domain); every other variant changes one thing.
const VARIANTS = { brief: {}, lean: { always: [] }, cited: { scope: 'cited' }, citedLean: { scope: 'cited', always: [] }, citedNoReferrers: { scope: 'cited', referrers: false }, deep: { deep: true } }
const rows = []
for (const id of tasks) {
  const content = await read(`spec/tasks/${files.find((name) => name.startsWith(`${id}.`))}`)
  const cited = splitRefs(quoteFields(quoteLine(content) ?? '').get('ssot')).filter((ref) => block(ref))
  // 0.5 reading: the task plus every cited domain doc read whole (to its ## chg) and ARCH.
  const docsChars = content.length + [...new Set([...cited.map((ref) => ref.split('-')[0]), 'ARCH'])].filter((domain) => docs.has(domain)).reduce((sum, domain) => sum + docs.get(domain).text.length, 0)
  const old = cited.map((ref) => oldBlocks(docs.get(ref.split('-')[0]).text).get(ref) ?? '')
  // Every reference followed to the end, whatever its kind.
  const closure = new Set(cited)
  for (const queue = [...cited]; queue.length;) {
    for (const ref of references(block(queue.shift()).text)) {
      const target = refId(ref)
      if (ref.number === null || closure.has(target) || !block(target)) continue
      closure.add(target)
      queue.push(target)
    }
  }
  const built = {}
  for (const [key, options] of Object.entries(VARIANTS)) built[key] = await assembleBrief({ source, roots: [id], ...options })
  const text = { old: content + old.join('\n'), closure: content + [...closure].map((ref) => block(ref).text).join('\n'), ...Object.fromEntries(Object.entries(built).map(([key, brief]) => [key, renderBrief(brief)])) }
  rows.push({ id, complete: built.brief.complete, unfollowed: built.brief.refs.unfollowed.length,
    decisions: { old: cited.length, closure: closure.size, ...Object.fromEntries(Object.entries(built).map(([key, brief]) => [key, brief.decisions.length])) },
    chars: { docs: docsChars, ...Object.fromEntries(Object.entries(text).map(([key, value]) => [key, value.length])) },
    // cited blocks whose non-blank lines the old extractor did not return in full
    oldLostBlocks: cited.filter((ref, index) => flat(old[index]) !== flat(block(ref).text)).length, text })
}

const KEYS = ['old', 'closure', ...Object.keys(VARIANTS)]
if (args.includes('--tokens')) {
  const script = 'import json,sys,tiktoken\nenc=tiktoken.get_encoding("o200k_base")\nprint(json.dumps([len(enc.encode(t)) for t in json.load(sys.stdin)]))'
  const child = execute('python3', ['-c', script], { maxBuffer: 64 * 1024 * 1024 })
  child.child.stdin.end(JSON.stringify(rows.flatMap((row) => KEYS.map((key) => row.text[key]))))
  const counts = JSON.parse((await child).stdout)
  rows.forEach((row, index) => { row.tokens = Object.fromEntries(KEYS.map((key, offset) => [key, counts[index * KEYS.length + offset]])) })
}
const questionsFile = option('--questions', null)
if (questionsFile) {
  const questions = JSON.parse(await readFile(questionsFile, 'utf8'))
  for (const row of rows) {
    const asked = questions[row.id] ?? []
    if (!asked.length) continue
    row.questions = { asked: asked.length }
    for (const key of KEYS) {
      const missing = asked.flatMap((entry) => entry.evidence.filter((item) => !row.text[key].includes(item.quote)).map((item) => ({ q: entry.q, where: item.where, quote: item.quote })))
      row.questions[key] = { answered: asked.filter((entry) => entry.evidence.every((item) => row.text[key].includes(item.quote))).length, missing }
    }
  }
}
for (const row of rows) delete row.text

const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0)
const median = (pick) => { const values = rows.map(pick).sort((a, b) => a - b); return values[Math.floor(values.length / 2)] }
const summary = { tasks: rows.length, commit, incomplete: rows.filter((row) => !row.complete).map((row) => row.id), oldLostBlocks: sum((row) => row.oldLostBlocks),
  chars: Object.fromEntries(['docs', ...KEYS].map((key) => [key, { sum: sum((row) => row.chars[key]), median: median((row) => row.chars[key]) }])),
  decisions: Object.fromEntries(KEYS.map((key) => [key, sum((row) => row.decisions[key])])) }
if (args.includes('--json')) process.stdout.write(`${JSON.stringify({ summary, rows }, null, 2)}\n`)
else {
  process.stdout.write(`| task | 0.5 docs | ≤0.6 brief | all refs | ${Object.keys(VARIANTS).join(' | ')} |\n|---|${'---:|'.repeat(3 + Object.keys(VARIANTS).length)}\n`)
  for (const row of rows) process.stdout.write(`| ${row.id} | ${row.chars.docs} | ${KEYS.map((key) => `${row.chars[key]} (${row.decisions[key]})`).join(' | ')} |\n`)
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

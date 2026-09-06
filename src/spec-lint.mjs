import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const DOMAIN_ID = /^[A-Z]{2,6}$/
const TASK_ID = /^T\d{3,}$/
const TASK_ST = /^(todo|doing@\d{6}(\.[A-Za-z0-9]{2,8})?|done@\d{6}|blocked@\d{6})$/
const DOC_ST = /^(open|ready|converted)@\d{6}$/ // ideation · review
const FINDING_LINE = /^-\s+F(\d+)\s+\[(o|x|\?)\]\s+P[123]\s+\S/
const LEVELS = new Set(['expert', 'mid', 'novice', '?'])
const SSOT_SECTIONS = ['decisions', 'flow', 'constraints', 'chg']
const SSOT_REQUIRED = ['decisions', 'chg']

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function listIfExists(dirPath) {
  try {
    return await readdir(dirPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function sections(markdown) {
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

function tableRows(lines = []) {
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

function quoteLine(markdown) {
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('> ')) return line.slice(2).trim()
  }
  return null
}

function quoteFields(quote) {
  const fields = new Map()
  for (const part of quote.split('|')) {
    const trimmed = part.trim()
    const colon = trimmed.indexOf(':')
    if (colon > 0) fields.set(trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim())
  }
  return fields
}

function cfgValues(lines = []) {
  const map = new Map()
  for (const line of lines) {
    const match = line.match(/^-\s+([\w-]+):\s*([^#]*)/)
    if (match) map.set(match[1], match[2].trim())
  }
  return map
}

function splitRefs(cell) {
  return (cell ?? '').split(/[\s,]+/).filter((ref) => ref && ref !== '-')
}

export async function lintSpec({ targetRoot } = {}) {
  const specRoot = path.join(path.resolve(targetRoot ?? process.cwd()), 'spec')
  const errors = []
  const warnings = []
  const counts = { ssot: 0, tasks: 0, done: 0 }

  const state = await readIfExists(path.join(specRoot, 'STATE.md'))
  if (state === null) {
    errors.push('spec/STATE.md가 없습니다 — create-architecture로 부트스트랩하세요.')
    return { ok: false, errors, warnings, counts }
  }
  if ((await readIfExists(path.join(specRoot, 'FORMAT.md'))) === null) {
    errors.push('spec/FORMAT.md가 없습니다.')
  }

  const stateSections = sections(state)
  for (const name of ['cfg', 'ssot', 'tasks', 'next', 'log']) {
    if (!stateSections.has(name)) errors.push(`STATE.md에 ## ${name} 섹션이 없습니다.`)
  }

  const cfg = cfgValues(stateSections.get('cfg'))
  const level = cfg.get('level')
  if (!level) errors.push('STATE cfg에 level이 없습니다.')
  else if (!LEVELS.has(level)) errors.push(`cfg level 값이 잘못됐습니다: ${level} (expert|mid|novice|?)`)
  else if (level === '?') warnings.push('cfg level이 ?입니다 — create-architecture 캘리브레이션 미완.')

  // ssot
  const ssotRows = tableRows(stateSections.get('ssot'))
  const ssotIds = new Set(ssotRows.map((row) => row[0]))
  const ssotInfo = new Map()
  for (const row of ssotRows) {
    const [id, revText, taskedText, pending, openText] = row
    if (!DOMAIN_ID.test(id ?? '')) {
      errors.push(`ssot id 형식 오류: ${id} (대문자 2-6자)`)
      continue
    }
    const rev = Number(revText)
    const tasked = Number(taskedText)
    if (!Number.isInteger(rev) || rev < 1) errors.push(`${id}: rev가 올바르지 않습니다: ${revText}`)
    if (!Number.isInteger(tasked) || tasked < 0) errors.push(`${id}: tasked가 올바르지 않습니다: ${taskedText}`)
    if (Number.isInteger(rev) && Number.isInteger(tasked)) {
      if (tasked > rev) errors.push(`${id}: tasked(${tasked}) > rev(${rev}) — 있을 수 없는 상태입니다.`)
      else if (tasked === 0 && pending !== 'all') warnings.push(`${id}: tasked=0이면 pending은 all이어야 합니다 (현재: ${pending || '(빈 칸)'})`)
      else if (tasked === rev && tasked > 0 && pending !== '-') warnings.push(`${id}: tasked=rev인데 pending이 '-'가 아닙니다: ${pending}`)
      else if (tasked > 0 && tasked < rev && (!pending || pending === '-')) warnings.push(`${id}: tasked<rev인데 pending 요약이 없습니다.`)
    }
    if (row.length < 5) warnings.push(`${id}: ssot 행에 [?] 열이 없습니다.`)

    const content = await readIfExists(path.join(specRoot, 'ssot', `${id}.md`))
    if (content === null) {
      errors.push(`ssot/${id}.md 파일이 없습니다.`)
      continue
    }
    const quote = quoteLine(content)
    const revMatch = quote?.match(/^r(\d+)\b/)
    if (!revMatch) errors.push(`ssot/${id}.md 인용줄이 'rN | 목적' 형식이 아닙니다.`)
    else if (Number.isInteger(rev) && Number(revMatch[1]) !== rev) {
      errors.push(`ssot/${id}.md의 rev(r${revMatch[1]})와 STATE rev(${rev})가 다릅니다.`)
    }

    // skeleton: fixed sections only, in order, bullets only (FORMAT principle 6)
    const ssotSections = sections(content)
    for (const name of SSOT_REQUIRED) {
      if (!ssotSections.has(name)) errors.push(`ssot/${id}.md에 ## ${name} 섹션이 없습니다.`)
    }
    let lastIndex = -1
    for (const [name, lines] of ssotSections) {
      const index = SSOT_SECTIONS.indexOf(name)
      if (index === -1) {
        errors.push(`ssot/${id}.md에 FORMAT 골격 밖 섹션이 있습니다: ## ${name} — 결정이면 decisions로 흡수하고, 아니면 삭제하세요.`)
        continue
      }
      if (index < lastIndex) warnings.push(`ssot/${id}.md 섹션 순서가 골격과 다릅니다: ## ${name}`)
      lastIndex = index
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '' || trimmed.startsWith('- ')) continue
        warnings.push(`ssot/${id}.md ${name}에 불릿이 아닌 산문 줄이 있습니다: "${trimmed.slice(0, 60)}"`)
      }
    }

    const decisions = new Set()
    let openCount = 0
    const decisionLines = (ssotSections.get('decisions') ?? []).filter((line) => line.trim().startsWith('- '))
    if (decisionLines.length === 0) warnings.push(`ssot/${id}.md의 decisions 섹션이 비어 있습니다.`)
    for (const line of decisionLines) {
      const trimmed = line.trim()
      const decision = trimmed.match(/^-\s+([A-Z]{2,6})-(\d+)\s+\[(o|x|\?)\]\s+\S/)
      if (!decision) {
        errors.push(`ssot/${id}.md 결정 라인 형식 오류: "${trimmed.slice(0, 60)}"`)
        continue
      }
      if (decision[1] !== id) errors.push(`ssot/${id}.md에 다른 도메인의 결정이 있습니다: ${decision[1]}-${decision[2]}`)
      const number = Number(decision[2])
      if (decisions.has(number)) errors.push(`ssot/${id}.md 결정 번호 중복: ${id}-${number}`)
      decisions.add(number)
      if (decision[3] === '?') openCount += 1
    }
    if (row.length >= 5 && openText !== '' && Number(openText) !== openCount) {
      warnings.push(`${id}: STATE [?] 열(${openText})과 실제 미정 결정 수(${openCount})가 다릅니다.`)
    }
    if (Number.isInteger(rev) && !new RegExp(`^\\s*-\\s+r${rev}\\b`, 'm').test(content)) {
      warnings.push(`ssot/${id}.md chg에 현재 rev(r${rev}) 항목이 없습니다.`)
    }
    for (const chgLine of ssotSections.get('chg') ?? []) {
      const trimmed = chgLine.trim()
      if (!trimmed.startsWith('- r')) continue
      if (/[A-Z]{2,6}-\d+✎/.test(trimmed) && !trimmed.includes('→')) {
        warnings.push(`ssot/${id}.md chg: ✎ 항목에 이전 값(old→new)이 없습니다: "${trimmed.slice(0, 60)}"`)
      }
    }
    ssotInfo.set(id, { rev, decisions })
  }
  for (const file of (await listIfExists(path.join(specRoot, 'ssot'))).filter((f) => f.endsWith('.md'))) {
    const id = file.replace(/\.md$/, '')
    if (!ssotIds.has(id)) errors.push(`ssot/${file}이 STATE ssot 표에 없습니다.`)
  }
  counts.ssot = ssotIds.size

  // tasks
  const taskRows = tableRows(stateSections.get('tasks'))
  const taskIds = new Set(taskRows.map((row) => row[0]))
  const fileByTaskId = new Map()
  for (const file of (await listIfExists(path.join(specRoot, 'tasks'))).filter((f) => f.endsWith('.md'))) {
    const named = file.match(/^(T\d{3,})\./)
    if (!named) {
      warnings.push(`tasks/${file}: T###.<slug>.md 형식이 아닙니다.`)
      continue
    }
    if (fileByTaskId.has(named[1])) errors.push(`태스크 파일 중복: ${named[1]} (${fileByTaskId.get(named[1])}, ${file})`)
    fileByTaskId.set(named[1], file)
  }
  // tasks/done/ 아카이브: 표에 없어야 하고, 파일 st는 done@여야 한다
  const doneIds = new Set()
  for (const file of (await listIfExists(path.join(specRoot, 'tasks', 'done'))).filter((f) => f.endsWith('.md'))) {
    const named = file.match(/^(T\d{3,})\./)
    if (!named) {
      warnings.push(`tasks/done/${file}: T###.<slug>.md 형식이 아닙니다.`)
      continue
    }
    doneIds.add(named[1])
    if (taskIds.has(named[1])) errors.push(`${named[1]}: tasks/done/ 아카이브와 STATE tasks 표에 동시에 있습니다 — done 행은 삭제하세요.`)
    if (fileByTaskId.has(named[1])) errors.push(`${named[1]}: tasks/와 tasks/done/에 파일이 모두 있습니다.`)
    const content = await readIfExists(path.join(specRoot, 'tasks', 'done', file))
    const archivedSt = quoteFields(quoteLine(content ?? '') ?? '').get('st')
    if (!archivedSt?.startsWith('done@')) {
      errors.push(`tasks/done/${file}: 아카이브된 태스크의 st가 done@가 아닙니다: ${archivedSt ?? '(없음)'}`)
    }
  }
  for (const row of taskRows) {
    const [id, , ssotCell, depCell, st] = row
    if (!TASK_ID.test(id ?? '')) {
      errors.push(`task id 형식 오류: ${id}`)
      continue
    }
    if (!TASK_ST.test(st ?? '')) errors.push(`${id}: st 형식 오류: ${st} (todo|doing@날짜.tag|done@날짜|blocked@날짜)`)
    else if (st.startsWith('doing@') && !st.includes('.')) warnings.push(`${id}: doing에 세션 tag가 없습니다 (doing@날짜.tag).`)
    else if (st.startsWith('done@')) warnings.push(`${id}: done 태스크는 표에서 삭제하고 tasks/done/으로 아카이브하세요.`)
    for (const dep of splitRefs(depCell)) {
      if (!taskIds.has(dep) && !doneIds.has(dep)) errors.push(`${id}: dep ${dep}가 tasks 표에도 tasks/done/에도 없습니다.`)
    }
    for (const domain of splitRefs(ssotCell)) {
      if (!ssotIds.has(domain)) errors.push(`${id}: ssot ${domain}이 STATE ssot 표에 없습니다.`)
    }

    const file = fileByTaskId.get(id)
    if (!file) {
      errors.push(`${id}: tasks/에 파일이 없습니다.`)
      continue
    }
    const content = await readIfExists(path.join(specRoot, 'tasks', file))
    const quote = quoteLine(content ?? '')
    if (!quote) {
      errors.push(`tasks/${file}: 인용줄이 없습니다.`)
      continue
    }
    const fields = quoteFields(quote)
    for (const key of ['st', 'ssot', 'base', 'dep']) {
      if (!fields.has(key)) errors.push(`tasks/${file}: 인용줄에 ${key}: 필드가 없습니다.`)
    }
    if (fields.get('st') && fields.get('st') !== st) {
      warnings.push(`${id}: 파일 st(${fields.get('st')})와 STATE st(${st})가 다릅니다 — 진행 상태의 진실은 STATE.`)
    }
    for (const ref of splitRefs(fields.get('ssot'))) {
      const parsed = ref.match(/^([A-Z]{2,6})-(\d+)$/)
      if (!parsed) {
        errors.push(`tasks/${file}: ssot 참조 형식 오류: ${ref}`)
        continue
      }
      const info = ssotInfo.get(parsed[1])
      if (!info) errors.push(`tasks/${file}: 참조 도메인 ${parsed[1]}이 없습니다.`)
      else if (!info.decisions.has(Number(parsed[2]))) errors.push(`tasks/${file}: 존재하지 않는 결정 참조: ${ref}`)
    }
    for (const base of splitRefs(fields.get('base'))) {
      const parsed = base.match(/^([A-Z]{2,6})@(\d+)$/)
      if (!parsed) {
        errors.push(`tasks/${file}: base 형식 오류: ${base}`)
        continue
      }
      const info = ssotInfo.get(parsed[1])
      if (!info) {
        errors.push(`tasks/${file}: base 도메인 ${parsed[1]}이 없습니다.`)
        continue
      }
      const baseRev = Number(parsed[2])
      if (baseRev > info.rev) errors.push(`tasks/${file}: base ${base}가 현재 rev(r${info.rev})보다 큽니다.`)
      else if (baseRev < info.rev && !(st ?? '').startsWith('done')) {
        warnings.push(`${id}: base ${base} < 현재 r${info.rev} — implement 전 신선도 확인 필요.`)
      }
    }
  }
  for (const [id, file] of fileByTaskId) {
    if (!taskIds.has(id)) errors.push(`tasks/${file}이 STATE tasks 표에 없습니다.`)
  }
  counts.tasks = taskIds.size
  counts.done = doneIds.size

  // ideation (optional)
  const ideationRows = stateSections.has('ideation') ? tableRows(stateSections.get('ideation')) : []
  const ideationIds = new Set(ideationRows.map((row) => row[0]))
  const ideationFiles = (await listIfExists(path.join(specRoot, 'ideation'))).filter((f) => f.endsWith('.md'))
  for (const row of ideationRows) {
    const [id, st] = row
    if (!DOC_ST.test(st ?? '')) errors.push(`ideation ${id}: st 형식 오류: ${st} (open|ready|converted@날짜)`)
    if (!ideationFiles.includes(`${id}.md`)) errors.push(`ideation/${id}.md 파일이 없습니다.`)
  }
  for (const file of ideationFiles) {
    const id = file.replace(/\.md$/, '')
    if (!ideationIds.has(id)) {
      const target = stateSections.has('ideation') ? errors : warnings
      target.push(`ideation/${file}이 STATE ideation 표에 없습니다.`)
    }
  }

  // review (optional)
  const reviewRows = stateSections.has('review') ? tableRows(stateSections.get('review')) : []
  const reviewIds = new Set(reviewRows.map((row) => row[0]))
  const reviewFiles = (await listIfExists(path.join(specRoot, 'review'))).filter((f) => f.endsWith('.md'))
  for (const row of reviewRows) {
    const [id, st] = row
    if (!DOC_ST.test(st ?? '')) errors.push(`review ${id}: st 형식 오류: ${st} (open|ready|converted@날짜)`)
    const content = await readIfExists(path.join(specRoot, 'review', `${id}.md`))
    if (content === null) {
      errors.push(`review/${id}.md 파일이 없습니다.`)
      continue
    }
    const fields = quoteFields(quoteLine(content) ?? '')
    for (const key of ['st', 'scope', 'at', 'base']) {
      if (!fields.has(key)) errors.push(`review/${id}.md: 인용줄에 ${key}: 필드가 없습니다.`)
    }
    if (fields.get('st') && fields.get('st') !== st) {
      warnings.push(`review ${id}: 파일 st(${fields.get('st')})와 STATE st(${st})가 다릅니다 — 진행 상태의 진실은 STATE.`)
    }
    const base = fields.get('base')?.match(/^([A-Z]{2,6})@(\d+)$/)
    if (fields.has('base') && !base) errors.push(`review/${id}.md: base 형식 오류: ${fields.get('base')} (ARCH@rev)`)
    else if (base) {
      const info = ssotInfo.get(base[1])
      if (!info) errors.push(`review/${id}.md: base 도메인 ${base[1]}이 없습니다.`)
      else if (Number(base[2]) < info.rev && !(st ?? '').startsWith('converted@')) {
        warnings.push(`review ${id}: base ${base[0]} < 현재 r${info.rev} — ARCH가 바뀐 뒤의 리뷰가 아닙니다.`)
      }
    }
    const seen = new Set()
    let untasked = 0
    for (const line of (sections(content).get('findings') ?? []).filter((l) => l.trim().startsWith('- '))) {
      const trimmed = line.trim()
      const finding = trimmed.match(FINDING_LINE)
      if (!finding) {
        errors.push(`review/${id}.md finding 형식 오류: "${trimmed.slice(0, 60)}" (- Fn [?|o|x] P1|P2|P3 where: what)`)
        continue
      }
      if (seen.has(finding[1])) errors.push(`review/${id}.md finding 번호 중복: F${finding[1]}`)
      seen.add(finding[1])
      const taskRef = trimmed.match(/→(T\d{3,})\b/)
      if (taskRef && !taskIds.has(taskRef[1]) && !doneIds.has(taskRef[1])) {
        errors.push(`review/${id}.md F${finding[1]}: →${taskRef[1]}가 tasks 표에도 tasks/done/에도 없습니다.`)
      }
      if (finding[2] === 'o' && !taskRef) untasked += 1
    }
    if ((st ?? '').startsWith('converted@') && untasked > 0) {
      errors.push(`review ${id}: converted인데 →T### 없는 [o] finding이 ${untasked}개 있습니다.`)
    }
  }
  for (const file of reviewFiles) {
    const id = file.replace(/\.md$/, '')
    if (!reviewIds.has(id)) {
      const target = stateSections.has('review') ? errors : warnings
      target.push(`review/${file}이 STATE review 표에 없습니다.`)
    }
  }

  // next / log
  const logLines = (stateSections.get('log') ?? []).filter((line) => line.trim().startsWith('- '))
  if (logLines.length > 20) warnings.push(`STATE log가 ${logLines.length}줄입니다 — 20줄 초과분은 삭제 (FORMAT).`)
  const nextLines = (stateSections.get('next') ?? []).filter((line) => line.trim().startsWith('- '))
  if (stateSections.has('next') && nextLines.length === 0) warnings.push('STATE next가 비어 있습니다 — 다음 할 일을 남기세요.')

  return { ok: errors.length === 0, errors, warnings, counts }
}

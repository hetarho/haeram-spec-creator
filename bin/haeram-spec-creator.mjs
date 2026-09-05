#!/usr/bin/env node

import { checkSkills, discoverSkills, installSkills, lintSpec, SkillPackageError } from '../src/index.mjs'
import { getPackageInfo } from '../src/package-info.mjs'

const HELP = `haeram-spec-creator

사용법:
  haeram-spec-creator list
  haeram-spec-creator validate [--allow-empty]
  haeram-spec-creator install [--target <path>] [--agent both|claude|codex] [--dry-run] [--force]
  haeram-spec-creator check [--target <path>] [--agent both|claude|codex]
  haeram-spec-creator lint [--target <path>]

옵션:
  --target <path>  스킬을 설치하거나 검사할 프로젝트 (기본값: 현재 폴더)
  --agent <name>   claude, codex 또는 both (기본값: both)
  --dry-run        파일을 바꾸지 않고 설치 계획만 출력
  --force          충돌한 로컬 파일을 패키지 버전으로 교체
  --allow-empty    validate에서 빈 skills/ 폴더 허용
  -h, --help       도움말
  -v, --version    버전
`

function takeValue(args, index, option) {
  const argument = args[index]
  if (argument.includes('=')) return { value: argument.slice(argument.indexOf('=') + 1), consumed: 0 }
  const value = args[index + 1]
  if (!value || value.startsWith('-')) throw new SkillPackageError(`${option} 값이 필요합니다.`)
  return { value, consumed: 1 }
}

function parseOptions(args) {
  const options = { agents: ['claude', 'codex'] }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '-h' || argument === '--help') options.help = true
    else if (argument === '-v' || argument === '--version') options.version = true
    else if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--force') options.force = true
    else if (argument === '--allow-empty') options.allowEmpty = true
    else if (argument === '--target' || argument.startsWith('--target=')) {
      const { value, consumed } = takeValue(args, index, '--target')
      options.targetRoot = value
      index += consumed
    } else if (argument === '--agent' || argument.startsWith('--agent=')) {
      const { value, consumed } = takeValue(args, index, '--agent')
      if (!['both', 'claude', 'codex'].includes(value)) {
        throw new SkillPackageError(`--agent는 both, claude, codex 중 하나여야 합니다: ${value}`)
      }
      options.agents = value === 'both' ? ['claude', 'codex'] : [value]
      index += consumed
    } else {
      throw new SkillPackageError(`알 수 없는 옵션입니다: ${argument}`)
    }
  }

  return options
}

function printCounts(result) {
  const label = result.dryRun ? '설치 계획' : '설치 완료'
  process.stdout.write(
    `${label}: 생성 ${result.counts.create}, 갱신 ${result.counts.update}, 제거 ${result.counts.remove}, 동일 ${result.counts.unchanged}\n`,
  )
  process.stdout.write(`대상: ${result.targetRoot}\n`)
  process.stdout.write(`에이전트: ${result.agents.join(', ')}\n`)
  process.stdout.write(`스킬: ${result.skillNames.join(', ')}\n`)
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const command = rawArgs[0] && !rawArgs[0].startsWith('-') ? rawArgs.shift() : undefined
  const options = parseOptions(rawArgs)

  if (options.version || command === 'version') {
    const info = await getPackageInfo()
    process.stdout.write(`${info.version}\n`)
    return
  }
  if (options.help || !command || command === 'help') {
    process.stdout.write(HELP)
    return
  }

  if (command === 'list') {
    const skills = await discoverSkills({ allowEmpty: true })
    if (skills.length === 0) process.stdout.write('등록된 스킬이 없습니다.\n')
    else {
      for (const skill of skills) {
        process.stdout.write(`${skill.name}\t${skill.metadata.description}\n`)
      }
    }
    return
  }

  if (command === 'validate') {
    const skills = await discoverSkills({ allowEmpty: options.allowEmpty })
    process.stdout.write(`스킬 검증 완료: ${skills.length}개\n`)
    return
  }

  if (command === 'install') {
    const result = await installSkills(options)
    printCounts(result)
    return
  }

  if (command === 'check') {
    const result = await checkSkills(options)
    if (!result.ok) {
      throw new SkillPackageError(
        '설치된 스킬이 패키지와 일치하지 않습니다.',
        result.mismatches.map(({ type, relativePath }) => `${type}: ${relativePath}`),
      )
    }
    process.stdout.write(
      `스킬 동기화 상태 정상: ${result.skillNames.length}개 (${result.agents.join(', ')})\n`,
    )
    return
  }

  if (command === 'lint') {
    const result = await lintSpec(options)
    for (const warning of result.warnings) process.stdout.write(`경고: ${warning}\n`)
    if (!result.ok) throw new SkillPackageError('spec/ 문서가 FORMAT 불변식을 위반합니다.', result.errors)
    const warningNote = result.warnings.length > 0 ? ` (경고 ${result.warnings.length}건)` : ''
    process.stdout.write(`spec 정합성 정상: ssot ${result.counts.ssot}개, 남은 task ${result.counts.tasks}개, 완료 ${result.counts.done}개${warningNote}\n`)
    return
  }

  throw new SkillPackageError(`알 수 없는 명령입니다: ${command}`)
}

main().catch((error) => {
  if (error instanceof SkillPackageError) {
    process.stderr.write(`오류: ${error.message}\n`)
    for (const detail of error.details) process.stderr.write(`  - ${detail}\n`)
  } else {
    process.stderr.write(`${error.stack ?? error.message}\n`)
  }
  process.exitCode = 1
})


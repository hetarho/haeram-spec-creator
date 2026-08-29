import { readdir, readFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SkillPackageError } from './errors.mjs'

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const bundledSkillsRoot = fileURLToPath(new URL('../skills/', import.meta.url))

function unquote(value) {
  if (value.length >= 2) {
    const first = value.at(0)
    const last = value.at(-1)
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).trim()
    }
  }
  return value.trim()
}

function frontmatterValue(frontmatter, key) {
  const lines = frontmatter.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^${key}:\\s*(.*)$`))
    if (!match) continue

    const value = match[1].trim()
    if (!['|', '|-', '|+', '>', '>-', '>+'].includes(value)) return unquote(value)

    const block = []
    for (let next = index + 1; next < lines.length; next += 1) {
      if (!/^\s+/.test(lines[next])) break
      block.push(lines[next].trim())
    }
    return block.join(' ').trim()
  }

  return undefined
}

function parseSkillFrontmatter(contents, skillName) {
  const withoutBom = contents.replace(/^\uFEFF/, '')
  const match = withoutBom.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) {
    throw new SkillPackageError(`${skillName}/SKILL.md에 YAML frontmatter가 없습니다.`)
  }

  const name = frontmatterValue(match[1], 'name')
  const description = frontmatterValue(match[1], 'description')

  if (!name) throw new SkillPackageError(`${skillName}/SKILL.md의 frontmatter에 name이 필요합니다.`)
  if (name !== skillName) {
    throw new SkillPackageError(
      `${skillName}/SKILL.md의 name(${name})이 폴더명과 일치하지 않습니다.`,
    )
  }
  if (!description) {
    throw new SkillPackageError(`${skillName}/SKILL.md의 frontmatter에 description이 필요합니다.`)
  }

  return { name, description }
}

function toPortablePath(relativePath) {
  return relativePath.split(path.sep).join('/')
}

async function walkFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === '.DS_Store') continue

    const absolutePath = path.join(directory, entry.name)
    const relativePath = toPortablePath(path.relative(root, absolutePath))

    if (entry.isSymbolicLink()) {
      throw new SkillPackageError(`심볼릭 링크는 배포할 수 없습니다: ${relativePath}`)
    }
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath, root)))
      continue
    }
    if (!entry.isFile()) {
      throw new SkillPackageError(`일반 파일이 아닌 항목은 배포할 수 없습니다: ${relativePath}`)
    }

    const stats = await lstat(absolutePath)
    files.push({
      absolutePath,
      relativePath,
      executable: Boolean(stats.mode & 0o111),
    })
  }

  return files
}

async function readRootEntries(skillsRoot) {
  try {
    return await readdir(skillsRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function discoverSkills({ skillsRoot = bundledSkillsRoot, allowEmpty = false } = {}) {
  const rootEntries = await readRootEntries(skillsRoot)
  const visibleEntries = rootEntries.filter((entry) => !entry.name.startsWith('.'))
  const unexpectedFiles = visibleEntries.filter((entry) => !entry.isDirectory())

  if (unexpectedFiles.length > 0) {
    throw new SkillPackageError(
      'skills/ 바로 아래에는 스킬 폴더만 둘 수 있습니다.',
      unexpectedFiles.map((entry) => entry.name),
    )
  }

  const skills = []
  for (const entry of visibleEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!SKILL_NAME_PATTERN.test(entry.name) || entry.name.length > 63) {
      throw new SkillPackageError(
        `잘못된 스킬 폴더명입니다: ${entry.name} (소문자, 숫자, 하이픈만 사용; 최대 63자)`,
      )
    }

    const skillRoot = path.join(skillsRoot, entry.name)
    const skillMdPath = path.join(skillRoot, 'SKILL.md')
    let skillMd
    try {
      skillMd = await readFile(skillMdPath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new SkillPackageError(`${entry.name}/SKILL.md가 없습니다.`)
      }
      throw error
    }

    const metadata = parseSkillFrontmatter(skillMd, entry.name)
    const files = await walkFiles(skillRoot)
    skills.push({ name: entry.name, root: skillRoot, metadata, files })
  }

  if (!allowEmpty && skills.length === 0) {
    throw new SkillPackageError(
      '배포할 스킬이 없습니다. skills/<skill-name>/SKILL.md를 추가한 뒤 다시 실행하세요.',
    )
  }

  return skills
}


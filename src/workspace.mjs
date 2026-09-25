import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export async function git(cwd, args, allowedCodes = []) {
  try {
    const { stdout } = await execute('git', ['-C', cwd, ...args], {
      encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
    })
    return stdout
  } catch (error) {
    if (allowedCodes.includes(error.code)) return null
    throw error
  }
}

function parseWorktrees(output) {
  return output.split('\0\0').filter(Boolean).map((record) => {
    const fields = new Map(record.split('\0').filter(Boolean).map((field) => {
      const split = field.indexOf(' ')
      return split < 0 ? [field, true] : [field.slice(0, split), field.slice(split + 1)]
    }))
    const head = fields.get('HEAD')
    return {
      path: fields.get('worktree'),
      head: head && !/^0+$/.test(head) ? head : null,
      branch: fields.get('branch')?.replace(/^refs\/heads\//, '') ?? null,
      detached: fields.has('detached'),
      bare: fields.has('bare'),
      locked: fields.get('locked') ?? false,
      prunable: fields.get('prunable') ?? false,
    }
  })
}

// Discovery only: neither branch names nor environment-specific hints grant ownership.
export async function inspectWorkspace({ targetRoot } = {}) {
  const target = await realpath(path.resolve(targetRoot ?? process.cwd()))
  let inside
  try {
    inside = await git(target, ['rev-parse', '--is-inside-work-tree'])
  } catch (error) {
    if (error.code === 'ENOENT' || /not a git repository/.test(error.stderr ?? '')) {
      return {
        schemaVersion: 1, targetRoot: target, git: null,
        warnings: [error.code === 'ENOENT' ? 'Git을 찾을 수 없습니다.' : 'Git 저장소가 아닙니다.'],
      }
    }
    throw error
  }
  if (inside.trim() !== 'true') {
    return { schemaVersion: 1, targetRoot: target, git: null, warnings: ['작업 checkout이 아닙니다 (bare 저장소 또는 Git 메타데이터 경로).'] }
  }
  const [root, gitDir, commonDir, branch, head, worktrees] = await Promise.all([
    git(target, ['rev-parse', '--show-toplevel']),
    git(target, ['rev-parse', '--absolute-git-dir']),
    git(target, ['rev-parse', '--git-common-dir']),
    git(target, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [1]),
    git(target, ['rev-parse', '--verify', '--quiet', 'HEAD'], [1]),
    git(target, ['worktree', 'list', '--porcelain', '-z']),
  ])
  // Remove the output delimiter only; whitespace may be part of a valid path.
  const line = (value) => value?.replace(/\r?\n$/, '') ?? null
  const common = await realpath(path.resolve(target, line(commonDir)))
  const directory = await realpath(line(gitDir))
  return {
    schemaVersion: 1,
    targetRoot: target,
    git: {
      root: await realpath(line(root)), gitDir: directory, commonDir: common,
      isLinkedWorktree: directory !== common,
      branch: line(branch), head: line(head), detached: branch === null,
      worktrees: parseWorktrees(worktrees),
    },
    warnings: [],
  }
}

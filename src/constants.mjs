export const PACKAGE_NAME = 'haeram-spec-creator'
export const LOCK_FILE = '.haeram-spec-creator-lock.json'

export const AGENT_CONFIG = Object.freeze({
  claude: {
    root: '.claude/skills',
    include(relativePath) {
      return relativePath !== 'agents' && !relativePath.startsWith('agents/')
    },
  },
  codex: {
    root: '.codex/skills',
    include() {
      return true
    },
  },
})


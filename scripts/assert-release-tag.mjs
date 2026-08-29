import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const expectedTag = `v${packageJson.version}`
const actualTag = process.env.GITHUB_REF_NAME

if (actualTag !== expectedTag) {
  process.stderr.write(`릴리스 태그(${actualTag})와 package.json 버전(${expectedTag})이 다릅니다.\n`)
  process.exit(1)
}

process.stdout.write(`릴리스 태그 확인: ${actualTag}\n`)


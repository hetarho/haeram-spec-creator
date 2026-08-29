import { readFile } from 'node:fs/promises'

const packageJsonUrl = new URL('../package.json', import.meta.url)

export async function getPackageInfo() {
  return JSON.parse(await readFile(packageJsonUrl, 'utf8'))
}


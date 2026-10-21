// Copies shared/ (the activity panel and the styles) into every example's public/, so each example
// stays self-contained when copied on its own. `--check` fails when a copy is out of date (CI).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const shared = fileURLToPath(new URL('./shared', import.meta.url))
const check = process.argv.includes('--check')
const examples = readdirSync(root).filter((d) => existsSync(join(root, d, 'public')))
let stale = 0
for (const example of examples) {
  for (const file of readdirSync(shared)) {
    const to = join(root, example, 'public', file)
    const body = readFileSync(join(shared, file), 'utf8')
    if (existsSync(to) && readFileSync(to, 'utf8') === body) continue
    if (check) {
      console.error(`${example}/public/${file} is out of date: run npm run sync in tools/`)
      stale++
    } else {
      writeFileSync(to, body)
      console.log(`${example}/public/${file}`)
    }
  }
}
process.exit(stale ? 1 : 0)

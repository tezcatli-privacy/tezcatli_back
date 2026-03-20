const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(process.cwd(), 'src', 'services', 'connectors')
const FETCH_REGEX = /\bfetch\s*\(/g

const files = fs
  .readdirSync(ROOT)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(ROOT, f))

const offenders = []

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  if (FETCH_REGEX.test(source)) {
    offenders.push(path.relative(process.cwd(), file))
  }
}

if (offenders.length > 0) {
  console.error(
    [
      'Direct fetch() detected in connectors.',
      'Use `nymFetch` from `src/plugins/nym_client.ts` to enforce privacy layer.',
      ...offenders.map((f) => ` - ${f}`),
    ].join('\n')
  )
  process.exit(1)
}

console.log('Privacy guard OK: no direct fetch() in connectors.')


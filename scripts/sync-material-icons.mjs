import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
await mkdir('.wrangler/test-results/phase-01.2', { recursive: true })
const commit = '10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7'
const mapping = {
  eye: 'visibility',
  eyeOff: 'visibility_off',
  spark: 'auto_awesome',
  devices: 'devices',
  code: 'code',
  clock: 'schedule',
  chart: 'monitoring',
  book: 'menu_book',
  link: 'link',
  server: 'dns',
  home: 'home',
  person: 'person',
  tune: 'tune',
  close: 'close',
  arrow: 'arrow_forward',
  battery: 'battery_full',
  bolt: 'bolt',
  alert: 'warning',
  moon: 'dark_mode',
  sun: 'light_mode',
  check: 'check',
  menu: 'menu',
  save: 'save',
  more: 'more_vert',
  logout: 'logout',
  undo: 'undo',
}
await mkdir('app/assets/icons', { recursive: true })
const records = await Promise.all(
  Object.entries(mapping).map(async ([name, symbol]) => {
    const variants = {}
    const sources = []
    for (const filled of ['eye', 'eyeOff'].includes(name) ? [false, true] : [false]) {
      const filename = `${symbol}${filled ? '_fill1' : ''}_24px.svg`
      const url = `https://raw.githubusercontent.com/google/material-design-icons/${commit}/symbols/web/${symbol}/materialsymbolsrounded/${filename}`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      const svg = await response.text()
      const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24'
      if (!['0 -960 960 960', '0 0 24 24'].includes(viewBox))
        throw new Error('Unexpected viewbox ' + filename)
      if (variants.viewBox && variants.viewBox !== viewBox)
        throw new Error('Variant coordinates differ')
      variants.viewBox = viewBox
      await writeFile('app/assets/icons/' + filename, svg)
      variants[filled ? 'filled' : 'outline'] = [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map(
        (m) => m[1],
      )
      sources.push({
        filename,
        url,
        bytes: Buffer.byteLength(svg),
        sha256: createHash('sha256').update(svg).digest('hex'),
      })
    }
    return [name, { symbol, ...variants, sources }]
  }),
)
await writeFile(
  'app/assets/icons/symbols.json',
  JSON.stringify(
    Object.fromEntries(records.map(([name, { sources, ...data }]) => [name, data])),
    null,
    2,
  ) + '\n',
)
await writeFile(
  process.argv[2] ?? '.wrangler/test-results/phase-01.2/material-icons-sources.json',
  JSON.stringify(
    {
      commit,
      axes: { fill: 0, weight: 400, grade: 0, opticalSize: 24 },
      records: Object.fromEntries(records),
    },
    null,
    2,
  ),
)
const license = await fetch(
  `https://raw.githubusercontent.com/google/material-design-icons/${commit}/LICENSE`,
)
if (!license.ok) throw new Error('License unavailable')
await writeFile('public/licenses/material-symbols.txt', await license.text())
console.log(
  'Material Symbols Rounded:',
  records.length,
  'semantic icons,',
  records.reduce((n, [, { sources }]) => n + sources.reduce((a, b) => a + b.bytes, 0), 0),
  'SVG bytes',
)

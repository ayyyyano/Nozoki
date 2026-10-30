import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { MATERIAL_ALIASES } from '../shared/icons/material.ts'
const require = createRequire(import.meta.url)
const root = dirname(require.resolve('@vicons/material/package.json'))
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (pkg.version !== '0.13.0') throw new Error('Review catalog before changing xicons version')
const names = (await readdir(resolve(root, 'es')))
  .filter((f) => /^[A-Z][A-Za-z0-9]*\.js$/.test(f))
  .map((f) => f.slice(0, -3))
  .sort()
await mkdir('shared/icons', { recursive: true })
await mkdir('app/icons/material-groups', { recursive: true })
await writeFile('shared/icons/material-names.json', JSON.stringify(names, null, 2) + '\n')
const groups = Array.from({ length: 16 }, () => [])
for (const name of names) {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  groups[hash % 16].push(name)
}
for (let i = 0; i < 16; i++)
  await writeFile(
    `app/icons/material-groups/g${i}.ts`,
    groups[i]
      .map((name) => `export { default as ${name} } from '@vicons/material/es/${name}.js'`)
      .join('\n') + '\n',
  )
await writeFile(
  'app/icons/material-loader.client.ts',
  `import type { Component } from 'vue'\nconst groups = [\n${groups.map((_, i) => `  () => import('./material-groups/g${i}')`).join(',\n')}\n]\nexport async function loadMaterialIcon(name: string): Promise<Component> {\n let hash=0\n for (const c of name) hash=(hash*31+c.charCodeAt(0))>>>0\n const icons = await groups[hash % groups.length]!()\n return (icons as Record<string, Component>)[name]!\n}\n`,
)
const semantics = {
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
const components = [...new Set([...Object.values(MATERIAL_ALIASES), 'PersonRound'])]
await writeFile(
  'app/icons/core.ts',
  `import type { Component } from 'vue'\n${components.map((name) => `import ${name} from '@vicons/material/es/${name}.js'`).join('\n')}\nexport const coreIcons: Record<string,{ component: Component; name:string; symbol:string; filled?:Component }> = {\n${Object.entries(
    MATERIAL_ALIASES,
  )
    .map(
      ([key, name]) =>
        ` ${key}: {component:${name},name:'${name}',symbol:'${semantics[key]}'${key === 'person' ? ',filled:PersonRound' : ''}}`,
    )
    .join(',\n')}\n}\n`,
)
console.log(`xicons Material ${pkg.version}: ${names.length} components; 16 lazy client groups`)

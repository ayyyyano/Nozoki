import { build } from 'esbuild'
import { copyFile, stat, readFile, writeFile } from 'node:fs/promises'
import { format, resolveConfig } from 'prettier'
await build({
  entryPoints: ['scripts/theme-init-entry.ts'],
  outfile: 'public/theme-init.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'eof',
  banner: {
    js: '/*! Nozoki theme prepaint; Material Color Utilities 0.3.0, Copyright Google LLC, Apache-2.0; /licenses/material-color-utilities.txt */',
  },
})
await copyFile(
  'node_modules/@material/material-color-utilities/LICENSE',
  'public/licenses/material-color-utilities.txt',
)
await writeFile(
  'public/theme-init.js',
  await format(await readFile('public/theme-init.js', 'utf8'), {
    ...(await resolveConfig('.prettierrc.json')),
    parser: 'babel',
  }),
)
console.log('theme-init.js bytes:', (await stat('public/theme-init.js')).size)

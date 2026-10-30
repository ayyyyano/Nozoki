import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { format, resolveConfig } from 'prettier'
await build({
  entryPoints: ['scripts/dx-init-entry.ts'],
  outfile: 'public/dx-init.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'eof',
  banner: {
    js: '/*! Nozoki early transition lifecycle. Original artwork: /vendor/maimai-transition/NOTICE.txt */',
  },
})
await writeFile(
  'public/dx-init.js',
  await format(await readFile('public/dx-init.js', 'utf8'), {
    ...(await resolveConfig('.prettierrc.json')),
    parser: 'babel',
  }),
)

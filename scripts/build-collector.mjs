import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('.output/collector', { recursive: true })
const result = await build({
  entryPoints: ['workers/collector/index.ts'],
  outfile: '.output/collector/index.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  metafile: true,
  minify: false,
})
const forbidden = Object.keys(result.metafile.inputs).filter(
  (p) => p.startsWith('app/') || p.includes('@varlet') || /node_modules\/.*\bvue\b/.test(p),
)
if (forbidden.length) throw new Error('Collector imports UI dependencies')
await writeFile('.output/collector/metafile.json', JSON.stringify(result.metafile, null, 2))
console.log(
  JSON.stringify({
    collectorBytes: result.metafile.outputs['.output/collector/index.mjs'].bytes,
    uiImports: forbidden,
  }),
)

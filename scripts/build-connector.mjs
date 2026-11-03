import { build } from 'esbuild'
await build({
  entryPoints: ['platform/node/connector-server.mjs'],
  outfile: '.output-connector/server.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
})
console.log('Source connector built in .output-connector/server.mjs')

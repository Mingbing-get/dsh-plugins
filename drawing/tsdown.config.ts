import type { UserConfig } from 'tsdown'

const host: UserConfig = {
  name: '@meing/dsh-drawing-plugin',
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  clean: false,
  external: [/^@deepseek-ai\//],
}

const ID = '@meing/dsh-drawing-plugin'
const externals = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-runtime/client'] as const
const client: UserConfig = {
  name: `${ID}/client`, entry: { client: 'src/client/index.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2022', dts: false, sourcemap: true, clean: false,
  external: [...externals], noExternal: (id: string) => externals.includes(id as typeof externals[number]) ? undefined : true,
  outputOptions: { entryFileNames: 'client.js', banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`, footer: 'return module.exports; } });', intro: 'var module = { exports: {} }; var exports = module.exports;' },
}
export default [host, client]

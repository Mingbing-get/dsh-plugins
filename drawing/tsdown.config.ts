import type { UserConfig } from 'tsdown'

const config: UserConfig = {
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

export default config

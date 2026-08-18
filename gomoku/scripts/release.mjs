import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(resolve(pluginRoot, 'package.json'), 'utf8'))
const { name, version } = packageJson
const tag = `gomoku-v${version}`
const archive = resolve(pluginRoot, 'dist', `${name}-${version}.tgz`)

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? pluginRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'inherit'],
  })
}

function succeeds(command, args) {
  try {
    run(command, args)
    return true
  } catch {
    return false
  }
}

if (run('git', ['status', '--porcelain']).trim()) {
  throw new Error('工作区有未提交的改动。请先提交后再发布。')
}

const existingTags = [tag, `v${version}`].filter((candidate) =>
  succeeds('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${candidate}`]),
)

if (existingTags.length) {
  throw new Error(
    `版本 ${version} 已发布（标签：${existingTags.join(', ')}）。请先升级 package.json 中的版本号。`,
  )
}

if (!succeeds('gh', ['auth', 'status'])) {
  throw new Error('未登录 GitHub CLI。请先执行 gh auth login。')
}

console.log(`打包 ${name}@${version}…`)
run('pnpm', ['pack', '--pack-destination', 'dist'], { cwd: pluginRoot, stdio: 'inherit' })

if (!existsSync(archive)) {
  throw new Error(`未找到打包产物：${archive}`)
}

console.log(`创建并推送标签 ${tag}…`)
run('git', ['tag', '-a', tag, '-m', `Release ${name} ${version}`], { stdio: 'inherit' })
run('git', ['push', 'origin', tag], { stdio: 'inherit' })

console.log('创建 GitHub Release 并上传安装包…')
run(
  'gh',
  [
    'release',
    'create',
    tag,
    archive,
    '--title',
    `五子棋 v${version}`,
    '--generate-notes',
  ],
  { stdio: 'inherit' },
)

console.log(`发布完成：${tag}`)

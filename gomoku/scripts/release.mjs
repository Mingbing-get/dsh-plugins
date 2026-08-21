import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(resolve(pluginRoot, 'package.json'), 'utf8'))
const { name, version } = packageJson
const tag = `gomoku-v${version}`
const archiveName = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
const archive = resolve(pluginRoot, 'dist', archiveName)
const repositoryRoot = resolve(pluginRoot, '..')
const releaseUrl = `https://github.com/Mingbing-get/dsh-plugins/releases/download/${tag}/${archiveName}`

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

function replaceOrThrow(contents, pattern, replacement, file) {
  if (!pattern.test(contents)) {
    throw new Error(`未能在 ${file} 中找到要更新的发布信息。`)
  }

  return contents.replace(pattern, replacement)
}

function updateReleaseDocs() {
  const pluginReadme = resolve(pluginRoot, 'README.md')
  const rootReadme = resolve(repositoryRoot, 'README.md')
  const installationCommand = `pnpm dsh plugin --profile web add ${releaseUrl}`

  let pluginContents = readFileSync(pluginReadme, 'utf8')
  pluginContents = replaceOrThrow(
    pluginContents,
    /pnpm dsh plugin --profile web add \S+/,
    installationCommand,
    pluginReadme,
  )
  writeFileSync(pluginReadme, pluginContents)

  let rootContents = readFileSync(rootReadme, 'utf8')
  rootContents = replaceOrThrow(
    rootContents,
    /(<!-- latest-release:gomoku -->[\s\S]*?\| --- \|\n)\| `[^`]+` \| \[查看 Release\]\([^\n]+\) \|/,
    `$1| \`${version}\` | [查看 Release](https://github.com/Mingbing-get/dsh-plugins/releases/tag/${tag}) |`,
    rootReadme,
  )
  rootContents = replaceOrThrow(
    rootContents,
    /(<!-- latest-install:gomoku -->\n```sh\n)(?:dsh|pnpm dsh) plugin add \S+/,
    `$1dsh plugin add ${releaseUrl}`,
    rootReadme,
  )
  writeFileSync(rootReadme, rootContents)
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
  ['release', 'create', tag, archive, '--title', `五子棋 v${version}`, '--generate-notes'],
  { stdio: 'inherit' },
)

console.log('更新 README 中的最新安装包地址…')
updateReleaseDocs()

console.log(`发布完成：${tag}`)

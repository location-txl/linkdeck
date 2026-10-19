import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '..')
const distributionDirectory = resolve(projectDirectory, 'dist')
const releaseDirectory = resolve(projectDirectory, 'release')
const privateKeyPath = resolve(projectDirectory, 'dist.pem')
const manifestPath = resolve(distributionDirectory, 'manifest.json')

if (!existsSync(manifestPath)) {
  throw new Error('未找到 dist/manifest.json，请先运行 pnpm build')
}

if (!existsSync(privateKeyPath)) {
  throw new Error('未找到项目根目录的 dist.pem，无法生成 CRX')
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const crxPath = resolve(releaseDirectory, `linkdeck-v${manifest.version}.crx`)
const crx3Executable = resolve(
  projectDirectory,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'crx3.cmd' : 'crx3',
)

if (!existsSync(crx3Executable)) {
  throw new Error('未找到 crx3 命令，请先运行 pnpm install')
}

mkdirSync(releaseDirectory, { recursive: true })

// CRX3 直接从 dist 目录创建压缩包，私钥只用于签名，不会写入发布产物。
execFileSync(
  crx3Executable,
  [
    distributionDirectory,
    '--keyPath',
    privateKeyPath,
    '--crxPath',
    crxPath,
  ],
  {
    cwd: projectDirectory,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

console.log(`CRX 已生成：${crxPath}`)

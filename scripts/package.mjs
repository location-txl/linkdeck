import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '..')
const distributionDirectory = resolve(projectDirectory, 'dist')
const releaseDirectory = resolve(projectDirectory, 'release')

mkdirSync(releaseDirectory, { recursive: true })

const bestzipExecutable = resolve(
  projectDirectory,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'bestzip.cmd' : 'bestzip',
)
execFileSync(
  bestzipExecutable,
  [
    resolve(releaseDirectory, 'linkdeck-v1.0.1.zip'),
    '_locales',
    'assets',
    'icons',
    'index.html',
    'manifest.json',
  ],
  {
    cwd: distributionDirectory,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

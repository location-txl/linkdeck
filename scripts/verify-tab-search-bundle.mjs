import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'

const overlayPath = new URL('../dist/assets/tab-search-overlay.js', import.meta.url)
const overlaySource = await readFile(overlayPath, 'utf8')

if (/^\s*(?:import|export)\b/m.test(overlaySource)) {
  throw new Error('tab-search-overlay.js 不能包含顶层 import/export，注入脚本必须是自包含普通脚本。')
}

new Script(overlaySource, { filename: overlayPath.pathname })
console.log('tab-search-overlay.js classic script 校验通过')

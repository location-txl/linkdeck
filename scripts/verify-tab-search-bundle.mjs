import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'

for (const name of ['tab-search-overlay', 'same-tab-main', 'same-tab-content']) {
  const scriptPath = new URL(`../dist/assets/${name}.js`, import.meta.url)
  const source = await readFile(scriptPath, 'utf8')
  if (/^\s*(?:import|export)\b/m.test(source)) {
    throw new Error(`${name}.js 不能包含顶层 import/export，注入脚本必须是自包含普通脚本。`)
  }
  new Script(source, { filename: scriptPath.pathname })
  console.log(`${name}.js classic script 校验通过`)
}

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type Manifest = {
  name: string
  private: boolean
  exports?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const root = process.cwd()
const readManifest = (directory: string): Manifest => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
const packages = readdirSync(join(root, 'packages')).map((name) => {
  const directory = join(root, 'packages', name)
  return { directory, manifest: readManifest(directory) }
})

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.(tsx?|css)$/.test(path) ? [path] : []
  })
}

function imports(file: string) {
  const source = readFileSync(file, 'utf8')
  const result: { specifier: string; runtime: boolean }[] = []
  if (file.endsWith('.css')) {
    return [...source.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((match) => ({ specifier: match[1], runtime: true }))
  }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings
      const typesOnly = node.importClause?.isTypeOnly || (!node.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every((element) => element.isTypeOnly))
      result.push({ specifier: node.moduleSpecifier.text, runtime: !typesOnly })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      result.push({ specifier: node.moduleSpecifier.text, runtime: !node.isTypeOnly })
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      result.push({ specifier: node.arguments[0].text, runtime: true })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return result
}

function resolveInternal(specifier: string) {
  const name = specifier.split('/').slice(0, 2).join('/')
  const target = packages.find((pkg) => pkg.manifest.name === name)
  expect(target, specifier).toBeDefined()
  const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`
  const entry = target!.manifest.exports?.[subpath]
  expect(entry, `${specifier} 必须通过明确的 exports 导出`).toBeDefined()
  return resolve(target!.directory, entry!)
}

describe('workspace boundaries', () => {
  it('declares dependencies and keeps imports inside public package boundaries', () => {
    const projects = [...packages, { directory: root, manifest: readManifest(root) }]
    for (const { directory, manifest } of projects) {
      const declarations = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }
      for (const file of sourceFiles(join(directory, 'src'))) {
        for (const { specifier } of imports(file)) {
          if (specifier.startsWith('.')) {
            const target = relative(join(directory, 'src'), resolve(dirname(file), specifier))
            expect(target.startsWith('..'), `${file}: ${specifier}`).toBe(false)
          } else if (!specifier.startsWith('node:')) {
            const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
            expect(name in declarations, `${file}: ${name} 未声明依赖`).toBe(true)
            if (specifier.startsWith('@linkdeck/')) {
              expect(declarations[name]).toBe('workspace:*')
              resolveInternal(specifier)
              if (!file.includes('.test.') && manifest.name !== '@linkdeck/test-utils') expect(name).not.toBe('@linkdeck/test-utils')
            }
          }
        }
      }
    }
  })

  it('keeps private workspace packages free of dependency cycles', () => {
    const visit = (name: string, ancestors: string[]) => {
      expect(ancestors, `循环依赖: ${[...ancestors, name].join(' -> ')}`).not.toContain(name)
      const pkg = packages.find(({ manifest }) => manifest.name === name)!
      expect(pkg.manifest.private).toBe(true)
      for (const dependency of Object.keys({ ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies, ...pkg.manifest.peerDependencies })) {
        if (dependency.startsWith('@linkdeck/')) visit(dependency, [...ancestors, name])
      }
    }
    for (const { manifest } of packages) visit(manifest.name, [])
  })

  it('keeps worker and injected script dependencies free of React UI and test utilities', () => {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      expect(file.endsWith('.tsx'), file).toBe(false)
      for (const { specifier, runtime } of imports(file)) {
        if (!runtime) continue
        expect(specifier, file).not.toMatch(/^(?:react(?:-dom)?(?:\/|$)|@linkdeck\/(?:ui|test-utils)(?:\/|$))/)
        if (specifier.startsWith('@linkdeck/')) visit(resolveInternal(specifier))
        else if (specifier.startsWith('.')) visit(resolve(dirname(file), `${specifier}.ts`))
      }
    }
    visit(join(root, 'src/service-worker.ts'))
    for (const specifier of ['@linkdeck/tab-search/content', '@linkdeck/same-tab-navigation/main', '@linkdeck/same-tab-navigation/content']) visit(resolveInternal(specifier))
  })
})

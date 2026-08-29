import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import manifest from './public/manifest.json' with { type: 'json' }

function resolveManifest(development: boolean): typeof manifest {
  if (!development) return manifest
  return {
    ...manifest,
    name: '__MSG_extensionNameDev__',
    short_name: 'LinkDeck dev',
    action: {
      ...manifest.action,
      default_title: '__MSG_extensionNameDev__',
    },
  }
}

/** 根据 Vite 模式提供对应的扩展清单，避免开发版与正式版名称混淆。 */
function extensionManifest(): Plugin {
  let development = false
  const source = () => `${JSON.stringify(resolveManifest(development), null, 2)}\n`
  return {
    name: 'linkdeck-extension-manifest',
    configResolved(config) {
      development = config.mode === 'development'
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if ((request as { url?: string }).url?.split('?')[0] !== '/manifest.json') {
          next()
          return
        }
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(source())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: source() })
    },
  }
}

export default defineConfig({
  plugins: [react(), extensionManifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: 'index.html',
        'service-worker': 'src/service-worker.ts',
        'tab-search-overlay': 'src/tab-search/content.ts',
      },
      output: {
        entryFileNames: 'assets/[name].js',
      },
    },
  },
})

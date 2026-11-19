import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync } from 'node:fs';
import path from 'path';
import type { Plugin } from 'vite';

const SAMPLE_RULEBOOKS_MODULE = 'virtual:sample-rulebooks';
const RESOLVED_SAMPLE_RULEBOOKS_MODULE = `\0${SAMPLE_RULEBOOKS_MODULE}`;
const SAMPLE_RULEBOOK_EXTENSIONS = new Set(['.pdf', '.md', '.markdown', '.txt']);

function sampleRulebooksPlugin(): Plugin {
  let sampleDirectory = '';
  let sampleNames = new Set<string>();

  const getSampleFiles = () => readdirSync(sampleDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && SAMPLE_RULEBOOK_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return {
    name: 'sample-rulebooks',
    configResolved(config) {
      sampleDirectory = path.resolve(config.root, 'public', 'sample-rulebooks');
      sampleNames = new Set(getSampleFiles());
    },
    resolveId(id) {
      if (id === SAMPLE_RULEBOOKS_MODULE) return RESOLVED_SAMPLE_RULEBOOKS_MODULE;
    },
    load(id) {
      if (id !== RESOLVED_SAMPLE_RULEBOOKS_MODULE) return;
      const samples = getSampleFiles().map(name => ({
        name,
        url: `/sample-rulebooks/${encodeURIComponent(name)}`
      }));
      return `export default ${JSON.stringify(samples)};`;
    },
    configureServer(server) {
      server.watcher.add(sampleDirectory);
      const reloadWhenSampleListChanges = (filePath: string) => {
        if (path.dirname(path.resolve(filePath)) === sampleDirectory) {
          const nextNames = new Set(getSampleFiles());
          if (nextNames.size !== sampleNames.size || [...nextNames].some(name => !sampleNames.has(name))) {
            sampleNames = nextNames;
            const module = server.moduleGraph.getModuleById(RESOLVED_SAMPLE_RULEBOOKS_MODULE);
            if (module) server.moduleGraph.invalidateModule(module);
            server.ws.send({ type: 'full-reload' });
          }
        }
      };
      server.watcher.on('add', reloadWhenSampleListChanges);
      server.watcher.on('unlink', reloadWhenSampleListChanges);
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), sampleRulebooksPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});

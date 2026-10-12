import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Compile real application modules and replace only native APIs and file IO.
export async function loadModule(entry, { persisted = null, imported = null } = {}) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const mocks = {
        '@tauri-apps/api/window': 'export const getCurrentWindow = () => ({ label: "main" });',
        '@tauri-apps/api/event': 'export const emit = async () => {}; export const listen = async () => () => {};',
        '@tauri-apps/api/core': 'export const invoke = async () => {};',
        '@tauri-apps/plugin-os': 'export const platform = () => "macos";',
        '@tauri-apps/plugin-fs': `export const readTextFile = async () => ${JSON.stringify(JSON.stringify(imported))}; export const writeTextFile = async () => {};`,
        '@tauri-apps/plugin-dialog': 'export const open = async () => "test-settings.json"; export const save = async () => null;',
        'sonner': 'export const toast = { warning() {}, success() {}, error() {} };',
        'storage': `export const tauriStorage = { getItem: name => name === "key_style_store" ? ${JSON.stringify(persisted ? JSON.stringify(persisted) : null)} : null, setItem() {}, removeItem() {} };`,
    };
    const bundle = await build({
        root, configFile: false, logLevel: 'error',
        resolve: { alias: { '@': `${root}src` } },
        plugins: [{
            name: 'mock-native-apis', enforce: 'pre',
            resolveId(source, importer) {
                if (source in mocks) return `\0test:${source}`;
                if (source === './storage' && importer?.includes('/stores/')) return '\0test:storage';
            },
            load(id) { if (id.startsWith('\0test:')) return mocks[id.slice(6)]; },
        }],
        build: {
            write: false, minify: false,
            lib: { entry: `${root}${entry}`, formats: ['cjs'], fileName: 'test-module' },
            rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'] },
        },
    });
    const outputs = Array.isArray(bundle) ? bundle : [bundle];
    const chunk = outputs.flatMap(output => output.output).find(output => output.type === 'chunk' && output.isEntry);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', chunk.code)(createRequire(import.meta.url), module, module.exports);
    return module.exports;
}

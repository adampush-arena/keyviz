import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'vite';

// Run the actual TypeScript store with its real Zustand middleware. Only the
// native window/event APIs and disk storage are replaced for this Node process.
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
    root,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    plugins: [{
        name: 'mock-native-store-apis',
        enforce: 'pre',
        resolveId(source, importer) {
            if (source === '@tauri-apps/api/window') return '\0test:window';
            if (source === '@tauri-apps/api/event') return '\0test:event';
            if (source === './storage' && importer?.endsWith('/stores/key_event.ts')) {
                return '\0test:storage';
            }
        },
        load(id) {
            switch (id) {
                case '\0test:window':
                    return 'export const getCurrentWindow = () => ({ label: "main" });';
                case '\0test:event':
                    return 'export const emit = async () => {}; export const listen = async () => () => {};';
                case '\0test:storage':
                    return 'export const tauriStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };';
            }
        },
    }],
    build: {
        write: false,
        minify: false,
        lib: { entry: `${root}src/stores/key_event.ts`, formats: ['cjs'], fileName: 'key-event' },
    },
});
const module = { exports: {} };
const outputs = Array.isArray(bundle) ? bundle : [bundle];
const chunk = outputs.flatMap(output => output.output).find(entry => entry.type === 'chunk' && entry.isEntry);
new Function('require', 'module', 'exports', chunk.code)(createRequire(import.meta.url), module, module.exports);
const store = module.exports.useKeyEvent;

function setup(t, options = {}) {
    store.setState({ ...store.getInitialState(), ...options }, true);
    let now = 100_000;
    t.mock.method(Date, 'now', () => now);
    return {
        press(name) { store.getState().onEvent({ type: 'KeyEvent', name, pressed: true }); },
        release(name) { store.getState().onEvent({ type: 'KeyEvent', name, pressed: false }); },
        advance(ms) { now += ms; store.getState().tick(); },
        groups() { return store.getState().groups.map(group => group.keys.map(key => key.name)); },
    };
}

test('a single key gets the full timeout after a long hold', t => {
    const input = setup(t, { filter: 'none' });
    input.press('KeyA');
    input.advance(10_000);
    assert.deepEqual(input.groups(), [['KeyA']]);
    input.release('KeyA');
    input.advance(4_999);
    assert.deepEqual(input.groups(), [['KeyA']]);
    input.advance(1);
    assert.deepEqual(input.groups(), []);
});

for (const releaseOrder of [['KeyC', 'MetaLeft'], ['MetaLeft', 'KeyC']]) {
    test(`Cmd+C expires together after release order ${releaseOrder.join(', ')}`, t => {
        const input = setup(t);
        input.press('MetaLeft');
        input.advance(6_000);
        input.press('KeyC');
        input.release(releaseOrder[0]);
        input.advance(10_000);
        assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC']]);
        input.release(releaseOrder[1]);
        input.advance(4_999);
        assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC']]);
        input.advance(1);
        assert.deepEqual(input.groups(), []);
    });
}

test('repeating C while holding Cmd keeps one complete combination', t => {
    const input = setup(t);
    input.press('MetaLeft');
    input.press('KeyC');
    input.release('KeyC');
    input.advance(6_000);
    input.press('KeyC');
    input.release('KeyC');
    assert.equal(store.getState().groups[0].keys[1].pressedCount, 2);
    input.advance(6_000);
    assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC']]);
    input.release('MetaLeft');
    input.advance(4_999);
    assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC']]);
    input.advance(1);
    assert.deepEqual(input.groups(), []);
});

test('pressing a completed single key again restarts its release timeout', t => {
    const input = setup(t, { filter: 'none' });
    input.press('KeyA');
    input.release('KeyA');
    input.advance(4_000);
    input.press('KeyA');
    input.advance(6_000);
    assert.deepEqual(input.groups(), [['KeyA']]);
    input.release('KeyA');
    input.advance(4_999);
    assert.deepEqual(input.groups(), [['KeyA']]);
    input.advance(1);
    assert.deepEqual(input.groups(), []);
});

test('completed history entries expire independently of the same shortcut being held again', t => {
    const input = setup(t, { showEventHistory: true });
    input.press('MetaLeft');
    input.press('KeyC');
    input.release('KeyC');
    input.release('MetaLeft');
    input.advance(1_000);
    input.press('MetaLeft');
    input.press('KeyC');
    assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC'], ['MetaLeft', 'KeyC']]);
    input.advance(4_000);
    assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC']]);
    input.release('KeyC');
    input.release('MetaLeft');
    input.advance(4_999);
    assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC']]);
    input.advance(1);
    assert.deepEqual(input.groups(), []);
});

test('history combinations sharing a held modifier remain whole until its release', t => {
    const input = setup(t, { showEventHistory: true });
    input.press('MetaLeft');
    input.press('KeyC');
    input.release('KeyC');
    input.advance(100);
    input.press('KeyV');
    input.release('KeyV');
    input.advance(10_000);
    assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC'], ['MetaLeft', 'KeyV']]);
    input.release('MetaLeft');
    input.advance(4_999);
    assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC'], ['MetaLeft', 'KeyV']]);
    input.advance(1);
    assert.deepEqual(input.groups(), []);
});

test('an unrelated released key does not extend a completed combination', t => {
    const input = setup(t);
    input.press('MetaLeft');
    input.press('KeyC');
    input.release('KeyC');
    input.release('MetaLeft');
    input.advance(4_000);
    input.press('KeyA'); // Filtered out: no modifier is held.
    input.release('KeyA');
    input.release('MetaLeft'); // Duplicate release must also leave the deadline alone.
    input.advance(1_000);
    assert.deepEqual(input.groups(), []);
});

test('a zero timeout still preserves a whole combination while any key is held', t => {
    const input = setup(t, { lingerDurationMs: 0 });
    input.press('MetaLeft');
    input.press('KeyC');
    input.release('KeyC');
    input.advance(1_000);
    assert.deepEqual(input.groups(), [['MetaLeft', 'KeyC']]);
    input.release('MetaLeft');
    input.advance(0);
    assert.deepEqual(input.groups(), []);
});

test('settings preview continues to pause expiry', t => {
    const input = setup(t, { filter: 'none', settingsOpen: true });
    input.press('KeyA');
    input.release('KeyA');
    input.advance(6_000);
    assert.deepEqual(input.groups(), [['KeyA']]);
    store.setState({ settingsOpen: false });
    input.advance(0);
    assert.deepEqual(input.groups(), []);
});

test('a mouse button gets the full timeout after release', t => {
    const input = setup(t, { filter: 'none' });
    store.getState().onEvent({ type: 'MouseButtonEvent', button: 'Left', pressed: true });
    input.advance(6_000);
    store.getState().onEvent({ type: 'MouseButtonEvent', button: 'Left', pressed: false });
    input.advance(4_999);
    assert.deepEqual(input.groups(), [['Left']]);
    input.advance(1);
    assert.deepEqual(input.groups(), []);
});

test('converting a click to a drag finishes earlier history combinations', t => {
    const input = setup(t, { filter: 'none', showEventHistory: true });
    store.getState().onEvent({ type: 'MouseButtonEvent', button: 'Left', pressed: true });
    input.press('KeyA');
    input.release('KeyA');
    input.advance(100);
    input.press('KeyB');
    input.release('KeyB');
    store.getState().onEvent({ type: 'MouseMoveEvent', x: 100, y: 0 });
    assert.deepEqual(store.getState().pressedKeys, ['Drag']);
    input.advance(4_999);
    assert.deepEqual(input.groups(), [['Left', 'KeyA'], ['KeyB'], ['Drag']]);
    input.advance(1);
    assert.deepEqual(input.groups(), [['Drag']]);
    store.getState().onEvent({ type: 'MouseButtonEvent', button: 'Left', pressed: false });
    input.advance(4_999);
    assert.deepEqual(input.groups(), [['Drag']]);
    input.advance(1);
    assert.deepEqual(input.groups(), []);
});

test('automatic scroll release starts a shared timeout without losing other cleanup', t => {
    const input = setup(t, { filter: 'none', showEventHistory: true });
    input.press('KeyA');
    input.release('KeyA');
    input.advance(4_800);
    store.getState().onEvent({ type: 'MouseWheelEvent', delta_x: 0, delta_y: 1 });
    input.advance(301); // Expires KeyA and releases ScrollUp in the same tick.
    assert.equal(store.getState().mouse.wheel, 0);
    assert.deepEqual(store.getState().pressedKeys, []);
    assert.deepEqual(input.groups(), [['ScrollUp']]);
    input.advance(4_999);
    assert.deepEqual(input.groups(), [['ScrollUp']]);
    input.advance(1);
    assert.deepEqual(input.groups(), []);
});

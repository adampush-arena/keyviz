import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-module.mjs';

const { inputAccessState } = await loadModule('src/lib/input-access.ts');
const ready = {
    supported: true, inputMonitoring: true, accessibility: true,
    restartRequired: false, listenerError: null, appPath: '/Applications/keyviz.app',
};

test('missing or invalidated Input Monitoring approval needs attention', () => {
    assert.equal(inputAccessState({ ...ready, inputMonitoring: false }), 'blocked');
});

test('restored permission does not claim the failed listener has recovered', () => {
    assert.equal(inputAccessState({ ...ready, listenerError: 'EventTapError' }), 'restart');
    assert.equal(inputAccessState({ ...ready, restartRequired: true }), 'restart');
});

test('Input Monitoring alone is sufficient for the listen-only input tap', () => {
    assert.equal(inputAccessState({ ...ready, accessibility: false }), 'ready');
});

test('other platforms do not display macOS recovery controls', () => {
    assert.equal(inputAccessState({ ...ready, supported: false, inputMonitoring: false }), 'unsupported');
});

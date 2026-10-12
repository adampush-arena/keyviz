import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-module.mjs';

test('old saved styles keep their left color and get a distinct right-click default', async () => {
    const { useKeyStyle } = await loadModule('src/stores/key_style.ts', {
        persisted: { state: { mouse: { color: '#123456', size: 70, showClicks: true } }, version: 0 },
    });
    const mouse = useKeyStyle.getState().mouse;
    assert.equal(mouse.color, '#123456');
    assert.equal(mouse.size, 70);
    assert.equal(mouse.rightClickColor, '#ff5b45');
    assert.equal(mouse.showClicks, true);
    assert.equal(mouse.indicatorSize, 50);
});

test('saved custom colors remain independent across hydration and edits', async () => {
    const { useKeyStyle } = await loadModule('src/stores/key_style.ts', {
        persisted: { state: { mouse: { color: '#112233', rightClickColor: '#aabbcc' } }, version: 0 },
    });
    useKeyStyle.getState().setMouse({ rightClickColor: '#ef1234' });
    assert.equal(useKeyStyle.getState().mouse.color, '#112233');
    assert.equal(useKeyStyle.getState().mouse.rightClickColor, '#ef1234');
});

test('importing an old settings file preserves the new right-click setting', async () => {
    const { useKeyStyle } = await loadModule('src/stores/key_style.ts', {
        imported: {
            appearance: {}, layout: {}, color: {}, modifier: {}, text: {}, border: {}, background: {},
            mouse: { color: '#234567', size: 90 },
        },
    });
    useKeyStyle.getState().setMouse({ rightClickColor: '#fedcba' });
    await useKeyStyle.getState().import();
    assert.equal(useKeyStyle.getState().mouse.color, '#234567');
    assert.equal(useKeyStyle.getState().mouse.rightClickColor, '#fedcba');
    assert.equal(useKeyStyle.getState().mouse.indicatorSize, 50);
});

test('right-click identity survives release for the ring animation', async () => {
    const { useKeyEvent } = await loadModule('src/stores/key_event.ts');
    useKeyEvent.getState().onMouseButtonPress({ type: 'MouseButtonEvent', button: 'Right', pressed: true });
    useKeyEvent.getState().onMouseButtonRelease({ type: 'MouseButtonEvent', button: 'Right', pressed: false });
    assert.equal(useKeyEvent.getState().pressedMouseButton, null);
    assert.equal(useKeyEvent.getState().mouse.lastButton, 'Right');
    useKeyEvent.getState().onMouseButtonPress({ type: 'MouseButtonEvent', button: 'Left', pressed: true });
    assert.equal(useKeyEvent.getState().mouse.lastButton, 'Left');
});

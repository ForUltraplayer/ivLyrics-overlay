// @file desktopControls.test.tsx
// @author: ForUltraplayer
// @brief Verify desktop pairing validation, explicit command transport and real control component wiring.
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parsePlaybackState, sendPlaybackCommand, validConfig, type PlaybackAction } from '../src/desktopControlTransport';

const token = 'x'.repeat(43);
const config = () => ({ bridgeUrl: 'http://127.0.0.1:19643', token, expiresAt: Date.now() + 900000 });
test('only a live bounded pairing to the fixed helper endpoint is accepted', () => {
  assert.equal(validConfig(config()), true);
  for (const value of [null, {}, { ...config(), bridgeUrl: 'https://unrelated.example' },
    { ...config(), bridgeUrl: 'http://127.0.0.1:15000' }, { ...config(), token: 'short' },
    { ...config(), expiresAt: NaN }, { ...config(), expiresAt: Date.now() - 1 },
    { ...config(), expiresAt: Date.now() + 86400001 }]) assert.equal(validConfig(value), false);
});

test('real settings panel exposes controls and window position without replacing user settings', async () => {
  const folder = dirname(fileURLToPath(import.meta.url));
  const temporary = await mkdtemp(resolve(folder, '.desktop-control-test-'));
  const output = resolve(temporary, 'Settings.mjs');
  let renderer: ReactTestRenderer | undefined;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const originalNativeCalls = Object.getOwnPropertyDescriptor(globalThis, '__overlayNativeCalls');
  const nativeCalls: { name: string; args: unknown }[] = [];
  const wheelListeners = new Set<(event: WheelEvent) => void>();
  let wheelAttachments = 0;
  const gapInput = {
    addEventListener(name: string, callback: (event: WheelEvent) => void, options: AddEventListenerOptions) {
      assert.equal(name, 'wheel'); assert.equal(options.passive, false);
      wheelAttachments++; wheelListeners.add(callback);
    },
    removeEventListener(name: string, callback: (event: WheelEvent) => void) { assert.equal(name, 'wheel'); wheelListeners.delete(callback); },
  };
  try {
    Object.defineProperty(globalThis, '__overlayNativeCalls', { value: nativeCalls, configurable: true });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true, writable: true });
    await build({ stdin: { contents: `export {default} from '../src/SettingsPanel'; export {defaultSettings} from '../src/App';`,
      resolveDir: folder, loader: 'tsx' }, outfile: output, bundle: true, format: 'esm', platform: 'node',
      jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' },
      define: { __APP_VERSION__: '"1.2.11"' }, plugins: [{ name: 'settings-native-test', setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\// }, args => ({ path: args.path, namespace: 'native' }));
        builder.onLoad({ filter: /.*/, namespace: 'native' }, () => ({ contents: `
          export const invoke = async (name,args) => { globalThis.__overlayNativeCalls.push({name,args}); return name === 'get_server_port' ? 15000 : false; };
          export const isEnabled = async () => false;
          export const enable = async () => {}; export const disable = async () => {};
          export const listen = async () => () => {}; export const check = async () => null;
          export const relaunch = async () => {}; export const openUrl = async () => {};
        ` }));
      } }] });
    const { default: Panel, defaultSettings } = await import(pathToFileURL(output).href);
    let settings = { ...defaultSettings, isLocked: true, hideWhenPaused: true, originalFontSize: 37 };
    const render = () => React.createElement(Panel, { settings, onCheckUpdates() {}, onSettingsChange(next: typeof settings) {
      settings = next; renderer!.update(render());
    } });
    await act(async () => { renderer = create(render(), { createNodeMock(element) {
      if (element.type === 'input' && element.props.type === 'range' && element.props.min === 0 && element.props.max === 48) return gapInput;
      return null;
    } }); });
    const buttons = () => renderer!.root.findAllByType('button');
    const text = (node: import('react-test-renderer').ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
    await act(async () => { buttons().find(button => text(button) === '동작')!.props.onClick(); });
    assert.equal(settings.playbackControlsVisibility, 'always');
    for (const [label, expected] of [['마우스를 올릴 때', 'hover'], ['숨김', 'hidden'], ['항상 표시', 'always']]) {
      await act(async () => { buttons().find(button => text(button) === label)!.props.onClick(); });
      assert.equal(settings.playbackControlsVisibility, expected);
    }
    const slider = renderer!.root.findAllByType('input').find(input => input.props.type === 'range' && input.props.min === 24 && input.props.max === 48)!;
    assert.ok(slider, 'the real behavior tab must expose control size');
    await act(async () => slider.props.onChange({ target: { value: '44' } }));
    assert.equal(settings.playbackControlsSize, 44);
    assert.equal(settings.isLocked, true); assert.equal(settings.hideWhenPaused, true); assert.equal(settings.originalFontSize, 37);
    await act(async () => { buttons().find(button => text(button) === '레이아웃')!.props.onClick(); });
    assert.ok(!buttons().some(button => ['↑', '↓', '←', '→'].includes(text(button))), 'dragging replaces directional arrow controls');
    assert.ok(!buttons().some(button => /마우스로 이동|위치 초기화|창 높이|기본 높이/.test(text(button))), 'layout exposes one control position slider without duplicate window controls');
    assert.ok(renderer!.root.findAllByProps({ className: 'section-title' }).some(node => text(node) === '재생 버튼'));
    const gapSlider = renderer!.root.findAllByType('input').find(input => input.props.type === 'range' && input.props.min === 0 && input.props.max === 48)!;
    assert.ok(gapSlider);
    assert.equal(settings.playbackControlsAlign, 'center', 'the horizontal position defaults to the original centered row');
    for (const [label, expected] of [['가사 정렬 따르기', 'follow'], ['왼쪽', 'left'], ['오른쪽', 'right'], ['가운데', 'center']]) {
      const option = buttons().find(button => text(button) === label && button.props['aria-pressed'] !== undefined)!;
      assert.ok(option, `layout exposes the ${label} horizontal option`);
      await act(async () => { option.props.onClick(); });
      assert.equal(settings.playbackControlsAlign, expected);
    }
    assert.equal(settings.textAlign, 'center', 'moving the controls leaves lyric alignment unchanged');
    await act(async () => gapSlider.props.onChange({ target: { value: '28' } }));
    assert.equal(settings.playbackControlsGap, 28);
    assert.equal(wheelListeners.size, 1);
    assert.equal(wheelAttachments, 1, 'only the gap range input binds a native wheel listener');
    let prevented = 0, stopped = 0;
    const wheel = async (deltaY: number, ctrlKey = false) => {
      await act(async () => { for (const callback of wheelListeners) callback({ deltaY, ctrlKey, preventDefault() { prevented++; }, stopPropagation() { stopped++; } } as WheelEvent); });
    };
    await wheel(120); assert.equal(settings.playbackControlsGap, 30);
    await wheel(-120); assert.equal(settings.playbackControlsGap, 28);
    assert.equal(prevented, 2); assert.equal(stopped, 2);
    await wheel(0); await wheel(120, true); assert.equal(prevented, 2);
    await act(async () => {
      const event = { deltaY: 120, ctrlKey: false, preventDefault() {}, stopPropagation() {} } as WheelEvent;
      for (let index = 0; index < 3; index++) for (const callback of wheelListeners) callback(event);
    });
    assert.equal(settings.playbackControlsGap, 34, 'rapid wheel events accumulate before the next React commit');
    await act(async () => gapSlider.props.onChange({ target: { value: '0' } }));
    await wheel(-120); assert.equal(settings.playbackControlsGap, 0);
    await act(async () => gapSlider.props.onChange({ target: { value: '48' } }));
    await wheel(120); assert.equal(settings.playbackControlsGap, 48);
    assert.equal(settings.isLocked, true, 'gap adjustment must preserve the saved lock setting');
    assert.ok(!buttons().some(button => text(button) === '마우스로 이동'), 'layout must not duplicate the behavior lock toggle');
    assert.equal(settings.isLocked, true);
    assert.equal(settings.hideWhenPaused, true); assert.equal(settings.originalFontSize, 37);
    await act(async () => { buttons().find(button => text(button) === '동작')!.props.onClick(); });
    assert.equal(wheelListeners.size, 0, 'leaving the layout tab removes the range wheel listener');
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    if (original) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', original); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    if (originalNativeCalls) Object.defineProperty(globalThis, '__overlayNativeCalls', originalNativeCalls); else Reflect.deleteProperty(globalThis, '__overlayNativeCalls');
    if (!resolve(temporary).startsWith(resolve(folder) + sep) || !temporary.includes('.desktop-control-test-')) throw Error('Unsafe test cleanup path');
    await rm(temporary, { recursive: true, force: true });
  }
});
test('all desktop buttons use the authorized command endpoint with a track guard', async () => {
  for (const action of ['previous', 'toggle', 'play', 'pause', 'next'] as PlaybackAction[]) {
    let calls = 0;
    const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
      calls++; assert.equal(url, 'http://127.0.0.1:19643/playback-command');
      assert.equal(options?.method, 'POST');
      assert.equal((options?.headers as Record<string, string>)['X-Hangul-Overlay-Token'], token);
      assert.deepEqual(JSON.parse(String(options?.body)), { action, trackUri: 'youtube:video:_-uHa5KiR90' });
      return { ok: true } as Response;
    }) as typeof fetch;
    await sendPlaybackCommand(config(), action, 'youtube:video:_-uHa5KiR90', fetcher);
    assert.equal(calls, 1);
  }
});
test('expired pairing and unknown commands cannot issue network requests', async () => {
  const fetcher = (() => { assert.fail('unexpected network call'); }) as typeof fetch;
  await assert.rejects(sendPlaybackCommand({ ...config(), expiresAt: 0 }, 'next', null, fetcher), /만료/);
  await assert.rejects(sendPlaybackCommand(config(), 'logout' as PlaybackAction, null, fetcher), /지원하지/);
});
test('stale track responses remain distinguishable from connection failure', async () => {
  await assert.rejects(sendPlaybackCommand(config(), 'pause', 'old', (async () => ({ ok: false, status: 409 })) as typeof fetch), /곡이 바뀌/);
  await assert.rejects(sendPlaybackCommand(config(), 'pause', 'old', (async () => ({ ok: false, status: 401 })) as typeof fetch), /연결/);
});
test('state parser accepts both supported response envelopes and rejects malformed state', () => {
  const state = { trackUri: 'youtube:video:_-uHa5KiR90', isPlaying: true };
  assert.deepEqual(parsePlaybackState(state), state); assert.deepEqual(parsePlaybackState({ state }), state);
  for (const value of [null, {}, { state: null }, { trackUri: 7, isPlaying: true }, { trackUri: null, isPlaying: 'false' }]) assert.equal(parsePlaybackState(value), null);
});
test('request cancellation is passed to the command transport', async () => {
  const controller = new AbortController();
  const fetcher = (async (_url: string | URL | Request, options?: RequestInit) => {
    assert.equal(options?.signal, controller.signal); return { ok: true } as Response;
  }) as typeof fetch;
  await sendPlaybackCommand(config(), 'next', null, fetcher, controller.signal);
});

test('actual desktop controls render paired actions and route pause without dragging the window', async () => {
  const folder = dirname(fileURLToPath(import.meta.url));
  const temporary = await mkdtemp(resolve(folder, '.desktop-control-test-'));
  const output = resolve(temporary, 'Controls.mjs');
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const setGlobal = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  let renderer: ReactTestRenderer | undefined;
  try {
    await build({ entryPoints: [resolve(folder, '../src/DesktopPlaybackControls.tsx')], outfile: output,
      bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' },
      plugins: [{ name: 'desktop-native-test', setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\// }, args => ({ path: args.path, namespace: 'native' }));
        builder.onLoad({ filter: /.*/, namespace: 'native' }, () => ({ contents: `
          export const invoke = (name, args) => {
            if (name === 'set_playback_control_bounds') globalThis.__desktopBoundsCalls.push(args.bounds);
            return Promise.resolve(name === 'get_playback_control_config' ? globalThis.__desktopPairing : null);
          };
          export const listen = (_event, callback) => {
            globalThis.__desktopConfigEvent = callback;
            return Promise.resolve(() => { globalThis.__desktopConfigEvent = undefined; });
          };
        ` }));
      } }] });
    setGlobal('IS_REACT_ACT_ENVIRONMENT', true); setGlobal('__desktopPairing', config());
    setGlobal('__desktopConfigEvent', undefined);
    const boundsCalls: unknown[] = []; setGlobal('__desktopBoundsCalls', boundsCalls);
    let computedOpacity = '1'; let computedDisplay = 'flex';
    setGlobal('getComputedStyle', () => ({ display: computedDisplay, opacity: computedOpacity, visibility: 'visible', pointerEvents: 'auto' }));
    const workers: { onmessage: ((event: { data: unknown }) => void) | null; onerror: ((event: { preventDefault(): void }) => void) | null;
      onmessageerror: (() => void) | null; terminated: boolean }[] = [];
    let failWorkerCreation = false;
    setGlobal('Worker', class {
      onmessage = null; onerror = null; onmessageerror = null; terminated = false;
      constructor(url: URL, options: { type: string }) {
        if (failWorkerCreation) throw Error('worker blocked');
        assert.ok(url.pathname.endsWith('/desktopControlTicker.worker.ts')); assert.equal(options.type, 'module'); workers.push(this);
      }
      terminate() { this.terminated = true; }
    });
    let nextTimer = 0; const timers = new Map<number, () => void>();
    setGlobal('window', { setInterval: (fn: () => void) => { timers.set(++nextTimer, fn); return nextTimer; },
      clearInterval: (id: number) => timers.delete(id), setTimeout: (fn: () => void) => { timers.set(++nextTimer, fn); return nextTimer; },
      clearTimeout: (id: number) => timers.delete(id), addEventListener() {}, removeEventListener() {} });
    const commands: unknown[] = []; let stateRequests = 0; let holdState = false; let staleStates = 0;
    setGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url.endsWith('/playback-command')) commands.push(JSON.parse(String(options?.body)));
      else {
        stateRequests++;
        if (holdState) await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
      }
      if (!url.endsWith('/playback-command') && staleStates > 0) { staleStates--; return { ok: true, json: async () => ({ state: null }) }; }
      return { ok: true, json: async () => ({ state: { trackUri: 'youtube:video:_-uHa5KiR90', isPlaying: true } }) };
    });
    const Component = (await import(pathToFileURL(output).href)).default;
    await act(async () => { renderer = create(React.createElement(Component, { enabled: true, isPlaying: false, trackUri: 'native', language: 'ko' }), {
      createNodeMock: element => element.props['data-testid'] === 'desktop-playback-controls'
        ? { getBoundingClientRect: () => ({ left: 180, top: 146, width: 140, height: 46 }) } : null,
    }); });
    const buttons = renderer!.root.findAllByType('button');
    assert.deepEqual(buttons.map(button => button.props['aria-label']), ['이전 곡', '일시정지', '다음 곡']);
    assert.ok(buttons.every(button => button.props.disabled === false));
    assert.deepEqual(boundsCalls.at(-1), { left: 180, top: 146, width: 140, height: 46 });
    assert.equal(workers.length, 1, 'bounds, state and expiry share one static worker');
    assert.equal(timers.size, 0, 'normal worker operation needs no window interval');
    const workerTick = workers[0].onmessage!;
    const requestCount = stateRequests; const boundsCount = boundsCalls.length;
    await act(async () => { workerTick({ data: 'tick' }); });
    assert.equal(stateRequests, requestCount + 1); assert.equal(boundsCalls.length, boundsCount + 1);
    assert.equal(workers.length, 1, 'worker ticks must not recreate the poll effect or clock');
    const realNow = Date.now;
    try {
      const expiredAt = realNow() + 900001; Date.now = () => expiredAt;
      await act(async () => { workerTick({ data: 'tick' }); });
      assert.ok(renderer!.root.findAllByType('button').every(button => button.props.disabled === true), 'the shared worker updates the expiry clock');
      assert.equal(boundsCalls.at(-1), null);
    } finally { Date.now = realNow; }
    await act(async () => { workerTick({ data: 'tick' }); });
    assert.ok(renderer!.root.findAllByType('button').every(button => button.props.disabled === false));
    // One or two missed polls (a track change) keep the controls; a third in a row shows the waiting label.
    const enabledNow = () => renderer!.root.findAllByType('button').every(button => button.props.disabled === false);
    const waiting = () => renderer!.root.findAll(node => node.props.role === 'status').length > 0;
    staleStates = 3;
    for (const expected of [true, true, false]) {
      await act(async () => { workerTick({ data: 'tick' }); });
      assert.equal(enabledNow(), expected); assert.equal(waiting(), !expected);
    }
    await act(async () => { workerTick({ data: 'tick' }); });
    assert.ok(enabledNow() && !waiting(), 'the next good poll restores the controls');
    const showControls = async (opacity: number) => {
      await act(async () => { renderer!.update(React.createElement(Component, { enabled: true, opacity,
        background: 'rgba(12, 34, 56, 0.4)', color: '#abcdef', isPlaying: false, trackUri: 'native', language: 'ko' })); });
    };
    await showControls(0);
    assert.equal(boundsCalls.at(-1), null, 'transparent hover must not leave an invisible native click region');
    assert.equal(renderer!.root.findByProps({ 'data-testid': 'desktop-playback-controls' }).props.style.pointerEvents, 'none');
    await showControls(0.2);
    const appearance = renderer!.root.findByProps({ 'data-testid': 'desktop-playback-controls' }).props.style;
    assert.equal(appearance.opacity, 0.2); assert.equal(appearance.background, 'rgba(12, 34, 56, 0.4)'); assert.equal(appearance.color, '#abcdef');
    assert.notEqual(boundsCalls.at(-1), null);
    computedOpacity = '0';
    await act(async () => workerTick({ data: 'tick' }));
    assert.equal(boundsCalls.at(-1), null, 'custom CSS opacity zero must release native interception');
    computedOpacity = '1'; computedDisplay = 'none';
    await act(async () => workerTick({ data: 'tick' }));
    assert.equal(boundsCalls.at(-1), null, 'custom CSS display none must release native interception');
    computedDisplay = 'flex';
    await showControls(1);
    assert.notEqual(boundsCalls.at(-1), null);
    const global = globalThis as typeof globalThis & {
      __desktopPairing: ReturnType<typeof config>;
      __desktopConfigEvent: (event: { payload: ReturnType<typeof config> | null }) => void;
    };
    const activeTimers = [...timers.keys()]; const requestsBefore = stateRequests;
    await act(async () => { global.__desktopConfigEvent({ payload: { ...global.__desktopPairing } }); });
    assert.equal(stateRequests, requestsBefore, 'duplicate config must preserve the polling effect');
    assert.deepEqual([...timers.keys()], activeTimers);
    assert.ok(renderer!.root.findAllByType('button').every(button => button.props.disabled === false));
    const failWorker = workers[0].onerror!;
    await act(async () => { failWorker({ preventDefault() {} }); failWorker({ preventDefault() {} }); });
    assert.equal(workers[0].terminated, true); assert.equal(timers.size, 1, 'worker errors create just one fallback clock');
    await act(async () => { await buttons[1].props.onClick(); });
    assert.deepEqual(commands, [{ action: 'pause', trackUri: 'youtube:video:_-uHa5KiR90' }]);
    const toolbar = renderer!.root.findByProps({ 'data-testid': 'desktop-playback-controls' });
    let stopped = false; toolbar.props.onMouseDown({ stopPropagation() { stopped = true; } }); assert.equal(stopped, true);
    await act(async () => { renderer!.update(React.createElement(Component, { enabled: true, visible: false, size: 48, isPlaying: false, trackUri: 'native', language: 'ko' })); });
    assert.equal(renderer!.toJSON(), null); assert.equal(boundsCalls.at(-1), null, 'hidden controls must release the native hit region');
    await act(async () => { renderer!.update(React.createElement(Component, { enabled: true, visible: true, size: 48, isPlaying: false, trackUri: 'native', language: 'ko' })); });
    assert.equal(renderer!.root.findByProps({ 'data-testid': 'desktop-playback-controls' }).props.style['--playback-button-size'], '48px');
    assert.deepEqual(boundsCalls.at(-1), { left: 180, top: 146, width: 140, height: 46 });
    holdState = true;
    await act(async () => { global.__desktopConfigEvent({ payload: { ...global.__desktopPairing, expiresAt: Date.now() + 1200000 } }); });
    assert.ok(renderer!.root.findAllByType('button').every(button => button.props.disabled === false), 'renewing expiry in the same session must preserve live state');
    const pendingRequestCount = stateRequests;
    await act(async () => { workerTick({ data: 'tick' }); workerTick({ data: 'tick' }); });
    assert.equal(stateRequests, pendingRequestCount, 'ticks cannot restart or overlap an in-flight state request');
    await act(async () => { global.__desktopConfigEvent({ payload: { ...global.__desktopPairing, token: 'y'.repeat(43) } }); });
    assert.ok(renderer!.root.findAllByType('button').every(button => button.props.disabled === true), 'a different session must await its own playback state');
    assert.equal(boundsCalls.at(-1), null, 'disconnected controls must not intercept clicks');
    await act(async () => { renderer!.update(React.createElement(Component, { enabled: false, isPlaying: false, trackUri: null, language: 'ko' })); });
    assert.equal(renderer!.toJSON(), null); assert.equal(timers.size, 0);
    const requestsAtDispose = stateRequests;
    await act(async () => { workerTick({ data: 'tick' }); });
    assert.equal(stateRequests, requestsAtDispose, 'disposed worker callbacks cannot restart networking');
    failWorkerCreation = true; holdState = false;
    await act(async () => { renderer!.update(React.createElement(Component, { enabled: true, isPlaying: false, trackUri: 'native', language: 'ko' })); });
    assert.equal(timers.size, 1, 'constructor failure uses one fallback interval');
    await act(async () => { renderer!.update(React.createElement(Component, { enabled: false, isPlaying: false, trackUri: null, language: 'ko' })); });
    assert.equal(timers.size, 0);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    if (!resolve(temporary).startsWith(resolve(folder) + sep) || !temporary.includes('.desktop-control-test-')) throw Error('Unsafe test cleanup path');
    await rm(temporary, { recursive: true, force: true });
  }
});

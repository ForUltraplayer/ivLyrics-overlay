// @file DesktopPlaybackControls.tsx
// @author: ForUltraplayer
// @brief Provide authenticated playback controls in the actual desktop lyric window while preserving click-through locking.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { parsePlaybackState, sendPlaybackCommand, validConfig, type PlaybackAction,
  type PlaybackControlConfig, type PlaybackControlState } from './desktopControlTransport';
import './DesktopPlaybackControls.css';

interface Props { enabled: boolean; visible?: boolean; size?: number; opacity?: number; background?: string; color?: string; cssRevision?: string;
  isPlaying: boolean; trackUri: string | null; language: 'ko' | 'en' }

export default function DesktopPlaybackControls({ enabled, visible = true, size = 32, opacity = 1,
  background = 'transparent', color = '#ffffff', cssRevision = '', isPlaying, trackUri, language }: Props) {
  const [config, setConfig] = useState<PlaybackControlConfig | null>(null);
  const [live, setLive] = useState<PlaybackControlState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null);
  const configured = useRef<PlaybackControlConfig | null>(null);
  const toolbar = useRef<HTMLDivElement | null>(null);
  const clockTasks = useRef<{ bounds: (() => void) | null; state: (() => void) | null; expiry: () => void }>({
    bounds: null, state: null, expiry: () => setNow(Date.now()),
  });
  const ko = language === 'ko';
  const buttonSize = Number.isFinite(size) ? Math.min(48, Math.max(24, size)) : 32;
  const paired = validConfig(config, now) && live !== null;
  const appearanceOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let worker: Worker | null = null;
    let fallback: number | null = null;
    const tick = () => {
      if (!alive) return;
      clockTasks.current.expiry(); clockTasks.current.bounds?.(); clockTasks.current.state?.();
    };
    const useFallback = () => {
      if (!alive || fallback !== null) return;
      if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); worker = null; }
      fallback = window.setInterval(tick, 500);
    };
    try {
      if (typeof Worker === 'undefined') useFallback();
      else {
        worker = new Worker(new URL('./desktopControlTicker.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = event => { if (event.data === 'tick') tick(); };
        worker.onerror = event => { event.preventDefault(); useFallback(); };
        worker.onmessageerror = useFallback;
      }
    } catch { useFallback(); }
    return () => {
      alive = false;
      if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
      if (fallback !== null) window.clearInterval(fallback);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !visible || !paired || appearanceOpacity === 0 || !toolbar.current) {
      void invoke('set_playback_control_bounds', { bounds: null }).catch(() => {});
      return;
    }
    const report = () => {
      const element = toolbar.current;
      const rect = element?.getBoundingClientRect();
      let shown = !!element;
      if (typeof getComputedStyle === 'function') {
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
            || Number.parseFloat(style.opacity) <= 0 || (current === element && style.pointerEvents === 'none')) {
            shown = false; break;
          }
        }
      }
      void invoke('set_playback_control_bounds', { bounds: shown && rect && rect.width > 0 && rect.height > 0
        ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null }).catch(() => {});
    };
    report();
    clockTasks.current.bounds = report;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null;
    observer?.observe(toolbar.current);
    window.addEventListener('resize', report);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', report);
      if (clockTasks.current.bounds === report) clockTasks.current.bounds = null;
      void invoke('set_playback_control_bounds', { bounds: null }).catch(() => {});
    };
  }, [enabled, visible, buttonSize, paired, appearanceOpacity, background, color, cssRevision]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    const apply = (value: unknown) => {
      if (!alive) return;
      const next = validConfig(value) ? value : null;
      const previous = configured.current;
      if (previous?.bridgeUrl === next?.bridgeUrl && previous?.token === next?.token
        && previous?.expiresAt === next?.expiresAt) return;
      configured.current = next;
      setConfig(next);
      if (!next || previous?.bridgeUrl !== next.bridgeUrl || previous?.token !== next.token) setLive(null);
    };
    listen<PlaybackControlConfig>('playback-config', event => apply(event.payload)).then(fn => { if (alive) unsubscribe = fn; else fn(); });
    invoke<PlaybackControlConfig | null>('get_playback_control_config').then(apply).catch(() => apply(null));
    return () => { alive = false; unsubscribe?.(); request.current?.abort(); };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !validConfig(config)) return;
    // A track change or helper restart can miss a poll or two; only a sustained
    // loss (three polls, about 1.5 s) shows the waiting label, so it no longer flickers.
    let alive = true, busy = false, misses = 0;
    const miss = () => { misses += 1; if (misses >= 3) setLive(null); };
    const controller = new AbortController();
    const poll = async () => {
      if (busy || !validConfig(config)) return;
      busy = true;
      const attempt = new AbortController();
      const cancel = () => attempt.abort(); controller.signal.addEventListener('abort', cancel, { once: true });
      const timeout = window.setTimeout(() => attempt.abort(), 2500);
      try {
        const response = await fetch(config.bridgeUrl + '/playback-state', {
          headers: { 'X-Hangul-Overlay-Token': config.token }, signal: attempt.signal,
        });
        const next = response.ok ? parsePlaybackState(await response.json()) : null;
        if (alive) { if (next) { misses = 0; setLive(next); } else miss(); }
      } catch { if (alive) miss(); }
      finally { window.clearTimeout(timeout); controller.signal.removeEventListener('abort', cancel); busy = false; }
    };
    void poll(); clockTasks.current.state = poll;
    return () => { alive = false; controller.abort(); if (clockTasks.current.state === poll) clockTasks.current.state = null; };
  }, [enabled, config]);

  if (!enabled || !visible) return null;
  const playing = live?.isPlaying ?? isPlaying;
  const labels = ko ? { previous: '이전 곡', play: '재생', pause: '일시정지', next: '다음 곡', wait: 'Spotify 제어 연결 대기' }
    : { previous: 'Previous', play: 'Play', pause: 'Pause', next: 'Next', wait: 'Waiting for Spotify controls' };

  const act = async (action: PlaybackAction) => {
    if (!paired || !config || pending) return;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    setPending(true); setError('');
    try { await sendPlaybackCommand(config, action, live?.trackUri ?? trackUri, fetch, controller.signal); }
    catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '재생 조작에 실패했습니다.'); }
    finally { window.clearTimeout(timeout); if (request.current === controller) { request.current = null; setPending(false); } }
  };

  return <div ref={toolbar} className="desktop-playback-controls" data-testid="desktop-playback-controls" role="toolbar"
    style={{ '--playback-button-size': `${buttonSize}px`, opacity: appearanceOpacity, background, color,
      pointerEvents: appearanceOpacity === 0 ? 'none' : 'auto' } as CSSProperties}
    aria-label={ko ? '가사 재생 컨트롤' : 'Lyric playback controls'}
    onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); }}>
    <button type="button" disabled={!paired || pending} title={labels.previous} aria-label={labels.previous} onClick={() => void act('previous')}>⏮</button>
    <button type="button" disabled={!paired || pending} title={playing ? labels.pause : labels.play} aria-label={playing ? labels.pause : labels.play}
      onClick={() => void act(playing ? 'pause' : 'play')}>{playing ? '⏸' : '▶'}</button>
    <button type="button" disabled={!paired || pending} title={labels.next} aria-label={labels.next} onClick={() => void act('next')}>⏭</button>
    {(!paired || error) && <span className="desktop-playback-status" role="status">{error || labels.wait}</span>}
  </div>;
}

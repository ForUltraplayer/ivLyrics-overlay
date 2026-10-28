// @file desktopControlTransport.ts
// @brief Validate short-lived loopback pairing and send explicit desktop playback actions without persistent tokens.
export interface PlaybackControlConfig {
  bridgeUrl: string;
  token: string;
  expiresAt: number;
}
export type PlaybackAction = 'previous' | 'toggle' | 'play' | 'pause' | 'next';
export interface PlaybackControlState {
  trackUri: string | null;
  isPlaying: boolean;
}

export function validConfig(value: unknown, now = Date.now()): value is PlaybackControlConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as PlaybackControlConfig;
  return config.bridgeUrl === 'http://127.0.0.1:19643'
    && typeof config.token === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(config.token)
    && Number.isFinite(config.expiresAt) && config.expiresAt > now && config.expiresAt <= now + 86_400_000;
}

export async function sendPlaybackCommand(config: PlaybackControlConfig, action: PlaybackAction,
  trackUri: string | null, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<void> {
  if (!validConfig(config)) throw new Error('Spotify 제어 연결이 만료됐습니다.');
  if (!['previous', 'toggle', 'play', 'pause', 'next'].includes(action)) throw new Error('지원하지 않는 재생 동작입니다.');
  const response = await fetcher(config.bridgeUrl + '/playback-command', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hangul-Overlay-Token': config.token },
    body: JSON.stringify({ action, trackUri }), signal,
  });
  if (!response.ok) throw new Error(response.status === 409 ? '곡이 바뀌었습니다. 다시 눌러 주세요.' : 'Spotify 제어 연결을 확인해 주세요.');
}

export function parsePlaybackState(value: unknown): PlaybackControlState | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as { state?: unknown; trackUri?: unknown; isPlaying?: unknown };
  const state = (body.state && typeof body.state === 'object' ? body.state : body) as { trackUri?: unknown; isPlaying?: unknown };
  if (typeof state.isPlaying !== 'boolean') return null;
  if (state.trackUri !== null && typeof state.trackUri !== 'string') return null;
  return { isPlaying: state.isPlaying, trackUri: state.trackUri as string | null };
}

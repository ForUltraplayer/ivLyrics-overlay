// @file lyricViewport.test.tsx
// @brief Check current-phonetic scrolling for deliberately short lyric windows without moving the transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealCurrentLyric } from '../src/lyricViewport';

function fixture(current: { top: number; bottom: number; height: number }, phonetic?: { top: number; bottom: number; height: number }) {
  const row = { getBoundingClientRect: () => current, querySelector: () => phonetic ? { getBoundingClientRect: () => phonetic } : null };
  return { clientHeight: 100, clientTop: 0, scrollTop: 50,
    getBoundingClientRect: () => ({ top: 10, bottom: 110 }), querySelector: () => row } as unknown as HTMLElement;
}
test('a complete current set that already fits does not scroll', () => {
  const viewport = fixture({ top: 20, bottom: 100, height: 80 });
  revealCurrentLyric(viewport); assert.equal(viewport.scrollTop, 50);
});
test('the current set scrolls into the remaining lyric area', () => {
  const viewport = fixture({ top: 90, bottom: 170, height: 80 });
  revealCurrentLyric(viewport); assert.equal(viewport.scrollTop, 110);
});
test('oversized sets prioritize the phonetic line instead of earlier original text', () => {
  const viewport = fixture({ top: -100, bottom: 200, height: 300 }, { top: 140, bottom: 180, height: 40 });
  revealCurrentLyric(viewport); assert.equal(viewport.scrollTop, 120);
});
test('an oversized phonetic line aligns at its start and remains scrollable', () => {
  const viewport = fixture({ top: -100, bottom: 400, height: 500 }, { top: 50, bottom: 250, height: 200 });
  revealCurrentLyric(viewport); assert.equal(viewport.scrollTop, 90);
});

// @file lyricViewport.ts
// @brief Keep current phonetics inside the lyric viewport while transport controls retain separate space.
export function revealCurrentLyric(viewport: HTMLElement): void {
  const current = viewport.querySelector<HTMLElement>('[data-current-lyric="true"]');
  if (!current || viewport.clientHeight <= 0) return;
  const viewportRect = viewport.getBoundingClientRect();
  const currentRect = current.getBoundingClientRect();
  // A multi-line set can exceed a deliberately short window. Prefer its phonetic line in that case.
  const anchor = currentRect.height > viewport.clientHeight
    ? current.querySelector<HTMLElement>('.phonetic') || current : current;
  const rect = anchor.getBoundingClientRect();
  const top = viewportRect.top + viewport.clientTop;
  const bottom = top + viewport.clientHeight;
  if (rect.height > viewport.clientHeight || rect.top < top) viewport.scrollTop += rect.top - top;
  else if (rect.bottom > bottom) viewport.scrollTop += rect.bottom - bottom;
}

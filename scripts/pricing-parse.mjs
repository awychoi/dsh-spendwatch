/**
 * Pure parsing helpers for the weekly pricing watcher. Kept separate from the
 * Playwright script so they can be tested without a browser.
 */

export function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function pad(hours, minutes) {
  return `${String(Number(hours)).padStart(2, '0')}:${minutes}`
}

/**
 * Extract peak windows written as `HH:MM–HH:MM UTC` near the word "peak".
 * Cross-midnight and out-of-range ranges are dropped; duplicates are removed.
 * @param text - rendered pricing page text.
 * @returns ordered windows as `{ start, end }` strings, or [].
 */
export function parseWindows(text) {
  const source = normalizeText(text)
  const seen = new Set()
  const windows = []
  for (const match of source.matchAll(/(\d{1,2}):(\d{2})\s*[–—−-]\s*(\d{1,2}):(\d{2})/g)) {
    const context = source.slice(Math.max(0, match.index - 200), match.index + 300).toLowerCase()
    if (!context.includes('peak') || !context.includes('utc')) continue
    const startHours = Number(match[1])
    const startMinutes = Number(match[2])
    const endHours = Number(match[3])
    const endMinutes = Number(match[4])
    if (startHours > 23 || endHours > 23 || startMinutes > 59 || endMinutes > 59) continue
    const start = startHours * 60 + startMinutes
    const end = endHours * 60 + endMinutes
    if (end <= start) continue
    const key = `${start}-${end}`
    if (seen.has(key)) continue
    seen.add(key)
    windows.push({ start: pad(startHours, match[2]), end: pad(endHours, match[4]) })
  }
  windows.sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0))
  return windows
}

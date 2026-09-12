// Wallet color theme (light / dark). Colors live as CSS variables on <html data-theme>; the JS
// color constants in App.tsx reference those vars, so flipping the attribute restyles everything.
import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'fw_theme'
let current: Theme = 'light'
const subs = new Set<() => void>()

function apply(th: Theme) {
  current = th
  try { document.documentElement.dataset.theme = th } catch { /* */ }
  // Mirror to localStorage (synchronous) so the inline script in index.html can set the theme before
  // React mounts — avoids the white flash on a dark-theme launch.
  try { localStorage.setItem(KEY, th) } catch { /* */ }
  subs.forEach(f => f())
}

export function getTheme(): Theme { return current }
export function setTheme(th: Theme) { apply(th); try { chrome.storage.local.set({ [KEY]: th }) } catch { /* */ } }
export function toggleTheme() { setTheme(current === 'dark' ? 'light' : 'dark') }

// Apply the persisted theme as early as possible. localStorage is read synchronously first (instant,
// no flash); chrome.storage.local is the authoritative store and reconciles right after.
export function initTheme() {
  try { const ls = localStorage.getItem(KEY); if (ls === 'dark' || ls === 'light') current = ls } catch { /* */ }
  try { chrome.storage.local.get(KEY).then((r) => apply(r[KEY] === 'dark' ? 'dark' : 'light')).catch(() => apply(current)) } catch { apply(current) }
}

export function useTheme(): Theme {
  const [, force] = useState(0)
  useEffect(() => { const cb = () => force(n => n + 1); subs.add(cb); return () => { subs.delete(cb) } }, [])
  return current
}

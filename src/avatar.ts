// Per-account avatar images. Stored as a small (128px, cover-cropped) data URL in
// chrome.storage.local, keyed by address — kept out of the encrypted vault since they are not
// secret and can be large-ish. An in-memory cache + change event lets components render
// synchronously.

const KEY = (addr: string) => `fw_avatar_${addr}`
const cache = new Map<string, string>()   // address -> data URL
const loaded = new Set<string>()
const listeners = new Set<() => void>()

export function onAvatarsChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb) } }
function notify() { listeners.forEach(l => l()) }

export function getAvatarSync(address: string): string | null { return cache.get(address) || null }

export async function loadAvatar(address: string): Promise<void> {
  if (loaded.has(address)) return
  loaded.add(address)
  try { const r = await chrome.storage.local.get(KEY(address)); const value = r[KEY(address)] as string | undefined; if (value) { cache.set(address, value); notify() } } catch { /* */ }
}

export async function setAvatar(address: string, dataUrl: string): Promise<void> {
  cache.set(address, dataUrl); loaded.add(address)
  try { await chrome.storage.local.set({ [KEY(address)]: dataUrl }) } catch { /* */ }
  notify()
}

export async function removeAvatar(address: string): Promise<void> {
  cache.delete(address)
  try { await chrome.storage.local.remove(KEY(address)) } catch { /* */ }
  notify()
}

// Open the system image picker, cover-crop + resize to 128px, return a JPEG data URL (null if
// cancelled or unreadable).
export function pickAvatar(): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files && input.files[0]
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onerror = () => resolve(null)
      reader.onload = () => {
        const img = new Image()
        img.onerror = () => resolve(null)
        img.onload = () => {
          const S = 128
          const canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S
          const ctx = canvas.getContext('2d')
          if (!ctx) return resolve(null)
          const scale = Math.max(S / img.width, S / img.height)
          const w = img.width * scale, h = img.height * scale
          ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h)
          try { resolve(canvas.toDataURL('image/jpeg', 0.85)) } catch { resolve(null) }
        }
        img.src = String(reader.result)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  })
}

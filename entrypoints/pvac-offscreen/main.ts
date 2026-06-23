// Offscreen document: hosts the FHE wasm and decrypts the private balance off the popup thread.
// A DOM extension page (unlike a module worker) has the shared memory the threaded wasm needs,
// and being separate from the popup it never blocks the UI. The background owns its lifecycle
// and closes it on lock, which drops the seed-derived context from memory.

let modP: Promise<any> | null = null
let wasmP: Promise<any> | null = null
const ctxCache = new Map<string, any>()

function hexToBytes(hex: string): Uint8Array {
  const a = new Uint8Array(hex.length / 2)
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return a
}

async function loadMod() { if (!modP) modP = import('@0xio/pvac'); return modP }

async function loadWasm() {
  if (!wasmP) wasmP = (async () => {
    const glue: any = await import('@0xio/pvac/wasm/pvac_rs.js')
    await glue.default(chrome.runtime.getURL('pvac_rs_bg.wasm') + '?v=2540300')
    return glue
  })()
  return wasmP
}

async function getCtx(seedHex: string) {
  const hit = ctxCache.get(seedHex)
  if (hit) return hit
  const m = await loadMod()
  const wasm = await loadWasm()
  const ctx = await m.PvacContext.create(hexToBytes(seedHex), wasm)
  ctxCache.set(seedHex, ctx)
  return ctx
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.__pvac) return
  ;(async () => {
    try {
      const m = await loadMod()
      const ctx = await getCtx(msg.seedHex)
      const value: bigint = ctx.decrypt(m.decodeCipher(msg.cipher))
      sendResponse({ ok: true, value: value.toString() })
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })()
  return true
})

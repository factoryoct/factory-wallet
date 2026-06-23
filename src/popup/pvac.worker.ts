// Runs the heavy FHE read-decrypt off the popup UI thread so the interface stays responsive
// (and dapp approvals can still render) while a balance is being decrypted. Only the read path
// (PvacContext.decrypt) is offloaded; it needs no range proof and no SharedArrayBuffer.

let modP: Promise<any> | null = null
let wasmP: Promise<any> | null = null
const ctxCache = new Map<string, any>()

function hexToBytes(hex: string): Uint8Array {
  const a = new Uint8Array(hex.length / 2)
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return a
}

async function loadMod() { if (!modP) modP = import('@0xio/pvac'); return modP }

async function loadWasm(url: string) {
  if (!wasmP) {
    wasmP = (async () => {
      const glue: any = await import('@0xio/pvac/wasm/pvac_rs.js')
      await glue.default(url)
      return glue
    })()
  }
  return wasmP
}

async function getCtx(seedHex: string) {
  const hit = ctxCache.get(seedHex)
  if (hit) return hit
  const m = await loadMod()
  const wasm = await wasmP
  const ctx = await m.PvacContext.create(hexToBytes(seedHex), wasm)
  ctxCache.set(seedHex, ctx)
  return ctx
}

self.onmessage = async (e: MessageEvent) => {
  const { id, seedHex, cipher, wasmUrl } = e.data || {}
  try {
    await loadWasm(wasmUrl)
    const m = await loadMod()
    const ctx = await getCtx(seedHex)
    const value: bigint = ctx.decrypt(m.decodeCipher(cipher))
    ;(self as any).postMessage({ id, ok: true, value: value.toString() })
  } catch (err) {
    ;(self as any).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

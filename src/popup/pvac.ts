// Private (FHE) balance via @0xio/pvac, lazily loaded so the wasm only downloads on demand.
// The public balance is read from `balance_raw`; the encrypted balance is decrypted directly.

import { keypairFromSeed, sign } from '../core/keys'
import { hexToBytes, bytesToBase64 } from '../core/encoding'
import { OctraRpc } from '../core/rpc'
import { api } from './api'

let modP: Promise<any> | null = null
let wasmP: Promise<any> | null = null
const cache = new Map<string, { ctx: any; kp: { privateKey: Uint8Array; publicKey: Uint8Array } }>()

async function loadMod() { if (!modP) modP = import('@0xio/pvac'); return modP }

// Init the wasm-bindgen glue with an explicit extension-resource URL; the wasm is shipped in public/.
async function loadWasm() {
  if (!wasmP) {
    wasmP = (async () => {
      const glue: any = await import('@0xio/pvac/wasm/pvac_rs.js')
      // cache-bust: extension resource fetches are cached by URL, so bump this tag when the wasm changes.
      await glue.default(chrome.runtime.getURL('pvac_rs_bg.wasm') + '?v=2540300')
      return glue
    })()
  }
  return wasmP
}

// Decrypt context (wasm + PvacContext), cached in memory per address so a session decrypts at most once.
async function getDecryptCtx(address: string, seed: Uint8Array) {
  const c = cache.get(address)
  if (c) return c
  const m = await loadMod()
  const wasm = await loadWasm()
  const ctx = await m.PvacContext.create(seed, wasm)
  const kp = keypairFromSeed(seed)
  const entry = { ctx, kp }
  cache.set(address, entry)
  return entry
}

// Cache the decrypted value keyed by cipher and network. Backed by chrome.storage.session
// (memory-backed, never written to disk) so it survives a popup reopen without re-running the
// decrypt. Cleared on lock. The in-memory Map is an L1 for same-session network switches.
const valCache = new Map<string, { cipher: string; value: string }>()
const vkey = (a: string, net: string) => `fw_ppriv_${a}_${net}`
async function readCache(k: string): Promise<{ cipher: string; value: string } | null> {
  const mem = valCache.get(k)
  if (mem) return mem
  try { const r = await chrome.storage.session.get(k); const s = r[k]; if (s) { valCache.set(k, s); return s } } catch { /* */ }
  return null
}
async function writeCache(k: string, cipher: string, value: string) {
  const v = { cipher, value }
  valCache.set(k, v)
  try { await chrome.storage.session.set({ [k]: v }) } catch { /* */ }
}

export interface PrivSnap { public: bigint; private: bigint | null }

/** Read public + encrypted (private) balance. Decrypts (heavy) only when the cipher changed. */
export async function readPrivateBalance(address: string, rpcUrl: string): Promise<PrivSnap> {
  const rpc = new OctraRpc(rpcUrl)
  const { seedHex } = await api.getSeed(address)
  const seed = hexToBytes(seedHex)
  const kp = keypairFromSeed(seed)

  // public balance from the micro-OCT integer field (not the OCT-decimal `balance`)
  const acct: any = await rpc.call('octra_balance', [address]).catch(() => null)
  const publicBal = BigInt(acct?.balance_raw ?? Math.round(Number(acct?.balance ?? 0) * 1e6))

  // encrypted cipher: authenticated read (no wasm). The node verifies an ed25519 signature
  // over the exact string `octra_encryptedBalance|<address>`.
  let priv: bigint | null = 0n
  try {
    const sig = bytesToBase64(sign(new TextEncoder().encode(`octra_encryptedBalance|${address}`), kp.privateKey))
    const pub = bytesToBase64(kp.publicKey)
    const res: any = await rpc.call('octra_encryptedBalance', [address, sig, pub])
    const cipher: string | undefined = res?.cipher
    if (!cipher || cipher === '0') {
      priv = 0n
    } else {
      const k = vkey(address, rpcUrl)
      const hit = await readCache(k)
      if (hit && hit.cipher === cipher) {
        priv = BigInt(hit.value)                     // unchanged -> instant, no wasm
      } else {
        const m = await loadMod()                    // changed -> decrypt once (heavy)
        const { ctx } = await getDecryptCtx(address, seed)
        priv = ctx.decrypt(m.decodeCipher(cipher))
        await writeCache(k, cipher, priv.toString())
      }
    }
  } catch {
    priv = null   // unexpected node error — show public only
  }

  return { public: publicBal, private: priv }
}

async function loadSeed(address: string) {
  const { seedHex } = await api.getSeed(address)
  const seed = hexToBytes(seedHex)
  return { seed, kp: keypairFromSeed(seed) }
}

// Build the encrypt payload: the cipher comes from ctx.encrypt(amount) (no seed) so the
// randomness stays on the ctx where makeBoundProof reads it; encryptSeeded would not thread
// the seed into the bound proof and the zero proof would fail to verify.
function buildEncryptData(m: any, ctx: any, amount: bigint): string {
  const blinding = crypto.getRandomValues(new Uint8Array(32))
  const cipher = ctx.encrypt(amount)
  const { proof, commitment } = ctx.makeBoundProof(cipher, amount, blinding)
  // Keys in alphabetical order (Rust serde/BTreeMap): amount_commitment, blinding, cipher, zero_proof.
  return JSON.stringify({
    amount_commitment: m.uint8ToBase64(commitment),
    blinding: m.uint8ToBase64(blinding),
    cipher: ctx.encodeCipher(cipher),
    zero_proof: ctx.encodeZeroProof(proof),
  })
}

/** Encrypt `amountMicro` micro-OCT from the public into the private balance (fast, no proof).
 * The pvac payload is built here (browser-only wasm); the background signs + submits. */
export async function shield(address: string, amountMicro: bigint, ou?: string): Promise<string> {
  const m = await loadMod()
  const { seed } = await loadSeed(address)
  const { ctx } = await getDecryptCtx(address, seed)
  const encryptedData = buildEncryptData(m, ctx, amountMicro)
  const { hash } = await api.encryptOp(address, amountMicro.toString(), encryptedData, 'encrypt', ou)
  return hash
}

/** Decrypt (unshield) `amountMicro` micro-OCT from the private balance back to public.
 * SLOW: builds a range proof (~30-60s) proving the remaining private balance stays >= 0. */
export async function unshield(address: string, amountMicro: bigint, rpcUrl: string, ou?: string): Promise<string> {
  const m = await loadMod()
  const { seed, kp } = await loadSeed(address)
  const rpc = new OctraRpc(rpcUrl)
  const sig = bytesToBase64(sign(new TextEncoder().encode(`octra_encryptedBalance|${address}`), kp.privateKey))
  const pub = bytesToBase64(kp.publicKey)
  const res: any = await rpc.call('octra_encryptedBalance', [address, sig, pub])
  const cipher: string | undefined = res?.cipher
  if (!cipher || cipher === '0') throw new Error('no private balance to decrypt')
  const { ctx } = await getDecryptCtx(address, seed)
  const rawCipher = m.decodeCipher(cipher)
  const currentBalance: bigint = ctx.decrypt(rawCipher)
  if (amountMicro > currentBalance) throw new Error('amount exceeds private balance')
  const encryptedData: string = m.buildDecryptPayload(ctx, amountMicro, rawCipher, currentBalance)
  const { hash } = await api.encryptOp(address, amountMicro.toString(), encryptedData, 'decrypt', ou)
  return hash
}

// Wipe all seed-derived material the popup holds (pvac context + raw seed) and the decrypted-value
// cache. Called on lock / autolock / popup hide so no secret is left in popup memory. Zeroing is
// best-effort (JS gives no guarantee).
export function clearPvac(address?: string) {
  const wipe = (e: { kp?: { privateKey?: Uint8Array } }) => { try { e.kp?.privateKey?.fill?.(0) } catch { /* */ } }
  if (address) { const e = cache.get(address); if (e) wipe(e); cache.delete(address) }
  else { for (const e of cache.values()) wipe(e); cache.clear() }
  valCache.clear()
  // drop the memory-backed session cache of decrypted balances too
  chrome.storage.session.get(null)
    .then(all => { const keys = Object.keys(all).filter(x => x.startsWith('fw_ppriv_')); if (keys.length) return chrome.storage.session.remove(keys) })
    .catch(() => { /* */ })
}

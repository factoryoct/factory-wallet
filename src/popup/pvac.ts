// Private (FHE) balance via @0xio/pvac, lazily loaded so the wasm only downloads on demand.
// The public balance is read from `balance_raw`; the encrypted balance is decrypted directly.

import { keypairFromSeed, sign } from '../core/keys'
import { hexToBytes, bytesToBase64, base64ToBytes } from '../core/encoding'
import { deriveViewPriv, deriveViewPub, viewPubFromSigningPub, deriveStealthParams, encryptMemo, scanNotes } from '../core/stealth'
import { OctraRpc } from '../core/rpc'
import { api } from './api'
import PvacWorker from './pvac.worker.ts?worker'

let modP: Promise<any> | null = null
let wasmP: Promise<any> | null = null
const cache = new Map<string, { ctx: any; kp: { privateKey: Uint8Array; publicKey: Uint8Array } }>()

const WASM_URL = () => chrome.runtime.getURL('pvac_rs_bg.wasm') + '?v=2540300'

// Read-decrypt is delegated to a worker so it never blocks the popup. Falls back to the main
// thread if the worker is unavailable.
let worker: Worker | null = null
let workerBroken = false   // disable the worker for the session after a failure; fall back in-thread
let seq = 0
const waiting = new Map<number, { resolve: (v: bigint) => void; reject: (e: unknown) => void }>()
function dropWorker() {
  // Do NOT permanently disable the worker — a fresh one is created on the next decrypt, so a
  // one-off failure doesn't force every later read onto the main thread (which froze the UI).
  for (const [, w] of waiting) w.reject(new Error('worker unavailable'))
  waiting.clear()
  try { worker?.terminate() } catch { /* */ }
  worker = null
}
function getWorker(): Worker {
  if (!worker) {
    worker = new PvacWorker()
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, value, error } = e.data || {}
      const w = waiting.get(id); if (!w) return
      waiting.delete(id)
      if (ok) w.resolve(BigInt(value))
      else { w.reject(new Error(error || 'decrypt failed')); dropWorker() }
    }
    worker.onerror = () => dropWorker()
  }
  return worker
}
function decryptInWorker(seedHex: string, cipher: string): Promise<bigint> {
  if (workerBroken) return Promise.reject(new Error('worker disabled'))
  return new Promise((resolve, reject) => {
    const id = ++seq
    waiting.set(id, { resolve, reject })
    try { getWorker().postMessage({ id, seedHex, cipher, wasmUrl: WASM_URL() }) }
    catch (e) { waiting.delete(id); reject(e) }
  })
}

async function loadMod() { if (!modP) modP = import('@0xio/pvac'); return modP }

// Init the wasm-bindgen glue with an explicit extension-resource URL; the wasm is shipped in public/.
async function loadWasm() {
  if (!wasmP) {
    wasmP = (async () => {
      const glue: any = await import('@0xio/pvac/wasm/pvac_rs.js')
      // cache-bust: extension resource fetches are cached by URL, so bump this tag when the wasm changes.
      await glue.default({ module_or_path: WASM_URL() })
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

// Cache the decrypted value keyed by cipher and network. Three layers: an in-memory Map, a
// memory-backed chrome.storage.session entry (survives a popup reopen, cleared on lock), and an
// encrypted chrome.storage.local entry (survives a browser restart). The disk layer holds only
// ciphertext, sealed with an AES key derived from the account seed, so the cleartext balance is
// never written to disk and is readable only once the wallet is unlocked.
const valCache = new Map<string, { cipher: string; value: string }>()
const vkey = (a: string, net: string) => `fw_ppriv_${a}_${net}`
const dkey = (a: string, net: string) => `fw_pdisk_${a}_${net}`

async function aesKeyFromSeed(seed: Uint8Array): Promise<CryptoKey> {
  const h = await crypto.subtle.digest('SHA-256', seed)
  return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function readCache(k: string, address: string, net: string, key: CryptoKey | null): Promise<{ cipher: string; value: string } | null> {
  const mem = valCache.get(k)
  if (mem) return mem
  try { const r = await chrome.storage.session.get(k); const s = r[k]; if (s) { valCache.set(k, s); return s } } catch { /* */ }
  if (key) {
    try {
      const dk = dkey(address, net)
      const blob = (await chrome.storage.local.get(dk))[dk] as { cipher: string; iv: string; ct: string } | undefined
      if (blob) {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(blob.iv) }, key, base64ToBytes(blob.ct))
        const v = { cipher: blob.cipher, value: new TextDecoder().decode(pt) }
        valCache.set(k, v)
        chrome.storage.session.set({ [k]: v }).catch(() => { /* */ })
        return v
      }
    } catch { /* */ }
  }
  return null
}

async function writeCache(k: string, address: string, net: string, cipher: string, value: string, key: CryptoKey | null) {
  const v = { cipher, value }
  valCache.set(k, v)
  try { await chrome.storage.session.set({ [k]: v }) } catch { /* */ }
  if (key) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value))
      await chrome.storage.local.set({ [dkey(address, net)]: { cipher, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) } })
    } catch { /* */ }
  }
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
      const aes = await aesKeyFromSeed(seed).catch(() => null)
      const hit = await readCache(k, address, rpcUrl, aes)
      if (hit && hit.cipher === cipher) {
        priv = BigInt(hit.value)                     // unchanged -> instant, no wasm
      } else {
        // changed -> decrypt once (heavy). ALWAYS off the UI thread (worker). If the worker
        // fails, show the private balance as unavailable (null) instead of decrypting on the
        // MAIN thread — running the FHE wasm on the popup thread blocked the whole wallet for
        // seconds (incl. the lock button) and was the freeze. The worker is retried next load.
        try {
          priv = await decryptInWorker(seedHex, cipher)
          await writeCache(k, address, rpcUrl, cipher, priv.toString(), aes)
        } catch {
          priv = null
        }
      }
    }
  } catch {
    priv = null   // unexpected node error — show public only
  }

  return { public: publicBal, private: priv }
}

/** Decrypt a confidential TOKEN's shielded balance (private_balance_of ciphertext) off the UI thread
 * via the worker, so the token list can show public + shielded on one row. Returns null on failure. */
const tokValCache = new Map<string, { cipher: string; value: string }>()
const tkey = (account: string, token: string) => `fw_tokpriv_${account}_${token}`

export async function decryptTokenShielded(account: string, token: string, cipher: string): Promise<bigint | null> {
  if (!cipher) return 0n
  const k = tkey(account, token)
  // fast path: unchanged cipher -> return the cached plaintext, no wasm. Two layers: in-memory (same
  // popup session) and chrome.storage.session (survives a popup reopen; cleared on lock). This is why
  // the shielded balance no longer flashes a dash on every open.
  const mem = tokValCache.get(k)
  if (mem && mem.cipher === cipher) return BigInt(mem.value)
  try {
    const sess = (await chrome.storage.session.get(k))[k] as { cipher: string; value: string } | undefined
    if (sess && sess.cipher === cipher) { tokValCache.set(k, sess); return BigInt(sess.value) }
  } catch { /* */ }
  try {
    const { seedHex } = await api.getSeed(account)   // the cipher is under the ACCOUNT's FHE key
    const norm = cipher.indexOf('|') >= 0 ? cipher : 'hfhe_v1|' + cipher
    const v = await decryptInWorker(seedHex, norm)
    const rec = { cipher, value: v.toString() }
    tokValCache.set(k, rec)
    chrome.storage.session.set({ [k]: rec }).catch(() => { /* */ })
    return v
  } catch { return null }
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

/** Build bound-proof triples for a list of plain integer values, using the connected account's
 * FHE key. Returns [{cipher, proof, commit}] as raw base64 (envelope prefix stripped), ready to
 * pass as confidential-AMM contract-call params. SECURITY: the seed/key never leaves the wallet;
 * the returned ciphertext + proof reveal nothing about the value or the key. Used by the site via
 * the approval-gated `octra_fheProve` provider method (the site never sees the key, only proofs). */
export async function proveValues(address: string, values: string[], blindings?: string[]): Promise<{ cipher: string; proof: string; commit: string; blinding: string }[]> {
  if (!Array.isArray(values) || values.length === 0 || values.length > 8) throw new Error('fheProve: expected 1..8 values')
  const m = await loadMod()
  const { seed } = await loadSeed(address)
  const { ctx } = await getDecryptCtx(address, seed)
  const strip = (s: string) => { const i = s.indexOf('|'); return i >= 0 ? s.slice(i + 1) : s }
  return values.map((v, i) => {
    if (!/^\d{1,20}$/.test(String(v))) throw new Error('fheProve: value must be a non-negative integer')
    const amount = BigInt(v)
    // reuse an explicit blinding when given (stealth claim: sender + recipient must share it), else random
    const blinding = (blindings && blindings[i]) ? base64ToBytes(blindings[i]) : crypto.getRandomValues(new Uint8Array(32))
    const cipher = ctx.encrypt(amount)
    const { proof, commitment } = ctx.makeBoundProof(cipher, amount, blinding)
    return { cipher: strip(ctx.encodeCipher(cipher)), proof: strip(ctx.encodeZeroProof(proof)), commit: m.uint8ToBase64(commitment), blinding: bytesToBase64(blinding) }
  })
}

/** Decrypt a confidential-AMM ciphertext (e.g. a token's private_balance_of) with the connected
 * account's FHE key and return the plaintext integer as a string. SECURITY: the seed/key never
 * leaves the wallet; only the resulting number is returned. A ciphertext that is not under this
 * account's key decrypts to garbage rather than revealing anything, so nothing else can leak.
 * Used by the site via the approval-gated `octra_fheDecrypt` provider method (reveal-on-demand). */
export async function decryptCipher(address: string, cipher: string): Promise<string> {
  if (typeof cipher !== 'string' || cipher.length === 0) throw new Error('fheDecrypt: empty cipher')
  const m = await loadMod()
  const { seed } = await loadSeed(address)
  const { ctx } = await getDecryptCtx(address, seed)
  // The cipher may arrive raw (bare base64, as a contract stores it) or enveloped (`hfhe_v1|…`,
  // as encodeCipher emits). decodeCipher expects the envelope, so try both forms.
  const forms = cipher.indexOf('|') >= 0 ? [cipher] : ['hfhe_v1|' + cipher, cipher]
  let lastErr: unknown
  for (const f of forms) {
    try { const raw = m.decodeCipher(f); const val: bigint = ctx.decrypt(raw); return val.toString() }
    catch (e) { lastErr = e }
  }
  throw new Error('fheDecrypt: could not decode cipher' + (lastErr instanceof Error ? ' (' + lastErr.message + ')' : ''))
}

/** Build confidential-DEPOSIT proofs for spending hidden amounts out of the connected account's
 * shielded token balances into a private pool. For each item {cipher, amount}: `cipher` is the
 * token's current private_balance_of (raw or enveloped), `amount` (dx) is the hidden deposit. The
 * wallet decrypts the balance, checks dx <= balance, and returns, per item:
 *   - cipher:    dx encrypted (goes to the pool reserve + the token's spend_private as `amt`)
 *   - amtProof/amtCommit: bound proof that dx >= 0
 *   - remProof/remCommit: bound proof that (balance - dx) >= 0, on the SAME ciphertext the chain
 *     computes via fhe_sub(priv_bal, dx) — so it verifies the depositor is solvent without ever
 *     revealing an amount. SECURITY: the key never leaves the wallet; only ciphertext + proofs (which
 *     reveal nothing) are returned. A wrong `cipher` just makes the on-chain proof fail (safe). */
export async function depositProofs(address: string, items: { cipher: string; amount: string }[], amtBlindings?: string[]) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 4) throw new Error('fheDeposit: expected 1..4 items')
  const m = await loadMod()
  const { seed } = await loadSeed(address)
  const { ctx } = await getDecryptCtx(address, seed)
  const strip = (s: string) => { const i = s.indexOf('|'); return i >= 0 ? s.slice(i + 1) : s }
  const norm = (c: string) => c.indexOf('|') >= 0 ? c : 'hfhe_v1|' + c
  return items.map((it, i) => {
    if (!/^\d{1,20}$/.test(String(it.amount))) throw new Error('fheDeposit: amount must be a non-negative integer')
    if (typeof it.cipher !== 'string' || !it.cipher) throw new Error('fheDeposit: missing balance cipher')
    const dx = BigInt(it.amount)
    const pbRaw = m.decodeCipher(norm(it.cipher))          // current shielded balance ciphertext
    const current: bigint = ctx.decrypt(pbRaw)
    if (dx > current) throw new Error('deposit exceeds your shielded balance')
    const rem = current - dx
    const dxCipher = ctx.encrypt(dx)
    const remCipher = ctx.ctSub(pbRaw, dxCipher)           // must equal on-chain fhe_sub(priv_bal, dx)
    // amount blinding: reuse an explicit one when given (a stealth SEND shares it with the recipient
    // so they can rebuild the same commitment on claim), else random. Remaining blinding stays random.
    const bl1 = (amtBlindings && amtBlindings[i]) ? base64ToBytes(amtBlindings[i]) : crypto.getRandomValues(new Uint8Array(32))
    const bl2 = crypto.getRandomValues(new Uint8Array(32))
    const p1 = ctx.makeBoundProof(dxCipher, dx, bl1)
    const p2 = ctx.makeBoundProof(remCipher, rem, bl2)
    return {
      cipher: strip(ctx.encodeCipher(dxCipher)),
      amtProof: strip(ctx.encodeZeroProof(p1.proof)),
      amtCommit: m.uint8ToBase64(p1.commitment),
      remProof: strip(ctx.encodeZeroProof(p2.proof)),
      remCommit: m.uint8ToBase64(p2.commitment),
      amtBlinding: bytesToBase64(bl1),
    }
  })
}

/** This account's stealth VIEW pubkey (safe to share; a sender derives the same from the account's
 * on-chain signing pubkey, so notes can be addressed without any prior contact). */
export async function stealthViewPub(address: string): Promise<string> {
  const { seed } = await loadSeed(address)
  return deriveViewPub(bytesToBase64(seed))
}

/** Prepare a STEALTH SEND of a hidden `amount` to `recipientSigningPubB64` out of the sender's shielded
 * `tokenCipher` (private_balance_of). Returns everything the ConfStealthToken.send needs, with the
 * amount hidden: debit proofs (amount cipher/proof/commit + remaining proof), the ephemeral pubkey,
 * and an ECDH-encrypted memo carrying (amount, blinding) that ONLY the recipient can open. */
export async function stealthSend(address: string, recipientSigningPubB64: string, tokenCipher: string, amount: string) {
  const recipientViewPub = viewPubFromSigningPub(recipientSigningPubB64)   // self-service: derive from octra_publicKey
  const sp = deriveStealthParams(recipientViewPub)                    // {ephem_pub, tag, enc_key}
  const [dp] = await depositProofs(address, [{ cipher: tokenCipher, amount }])   // random blinding, returned
  const payload = encryptMemo({ a: amount, b: dp.amtBlinding }, sp.enc_key)      // recipient-only memo
  return {
    cipher: dp.cipher, amtProof: dp.amtProof, amtCommit: dp.amtCommit,
    remProof: dp.remProof, remCommit: dp.remCommit,
    ephem: sp.ephem_pub, payload,
  }
}

/** Scan on-chain stealth notes (id, ephem, payload) for ones addressed to this account and return the
 * hidden (amount, blinding) for each — so the recipient can build a claim WITHOUT any out-of-band data. */
export async function stealthScan(address: string, notes: Array<{ id: number; ephem: string; payload: string }>) {
  const { seed } = await loadSeed(address)
  const viewPriv = deriveViewPriv(bytesToBase64(seed))
  return scanNotes(notes, viewPriv).map(r => ({ id: r.id, amount: String(r.memo.a), blinding: String(r.memo.b) }))
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
  tokValCache.clear()
  // terminate the decrypt worker so its seed-derived context is dropped from memory
  try { worker?.terminate() } catch { /* */ }
  worker = null
  for (const [, w] of waiting) w.reject(new Error('locked'))
  waiting.clear()
  // drop the memory-backed session cache of decrypted balances (the encrypted disk cache
  // survives lock: it is ciphertext, readable only after the next unlock)
  chrome.storage.session.get(null)
    .then(all => { const keys = Object.keys(all).filter(x => x.startsWith('fw_ppriv_') || x.startsWith('fw_tokpriv_')); if (keys.length) return chrome.storage.session.remove(keys) })
    .catch(() => { /* */ })
}

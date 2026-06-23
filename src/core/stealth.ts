// Stealth / private-transfer crypto: X25519 ECDH + SHA256 KDF + AES-256-GCM.
//
//   sender:    ephemeral_priv -> ephemeral_pub (published as out_ephem)
//   shared:    X25519(ephemeral_priv, recipient_view_pub)
//   tag:       SHA256("tag"||shared)   (recipient scans for this)
//   claim_key: SHA256("claim"||shared) (presented at stealth_claim)
//   enc_key:   SHA256("enc"||shared)   (AES-GCM key for the memo)

import { x25519, ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { sha512 } from '@noble/hashes/sha512'
import { gcm } from '@noble/ciphers/aes'
import { randomBytes } from '@noble/hashes/utils'

// Edwards point class name varies across @noble versions (ExtendedPoint -> Point).
const EdPoint: any = (ed25519 as any).Point ?? (ed25519 as any).ExtendedPoint

// curve25519 clamp of a 32-byte scalar (in place).
function clamp(v: Uint8Array): Uint8Array {
  v[0] = v[0]! & 248
  v[31] = v[31]! & 127
  v[31] = v[31]! | 64
  return v
}

export function sha256Hex(input: string): string {
  return Array.from(sha256(new TextEncoder().encode(input))).map(b => b.toString(16).padStart(2, '0')).join('')
}

// view private key (x25519) from an ed25519 signing seed: sha512(seed)[:32] -> clamp.
export function deriveViewPriv(signingPrivB64: string): string {
  const seed = b64ToBytes(signingPrivB64)
  const seedPart = seed.length === 64 ? seed.slice(0, 32) : seed
  const v = clamp(sha512(seedPart).slice(0, 32))
  return bytesToB64(v)
}

export function deriveViewPub(signingPrivB64: string): string {
  return bytesToB64(x25519.getPublicKey(b64ToBytes(deriveViewPriv(signingPrivB64))))
}

export function viewPubFromPriv(viewPrivB64: string): string {
  return bytesToB64(x25519.getPublicKey(b64ToBytes(viewPrivB64)))
}

// Seedless path: derive the scanning key from a deterministic ed25519 signature.
export function viewKeyFromSignature(sigB64: string): { priv: string; pub: string } {
  const priv = clamp(sha512(b64ToBytes(sigB64)).slice(0, 32))
  return { priv: bytesToB64(priv), pub: bytesToB64(x25519.getPublicKey(priv)) }
}

// view pub (x25519) from a recipient's ed25519 SIGNING pub (Edwards->Montgomery).
const ED_P = (2n ** 255n) - 19n
function _modpow(b: bigint, e: bigint, m: bigint): bigint {
  b %= m; let r = 1n
  while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n }
  return r
}
function _bytesToHex(u: Uint8Array): string { let s = ''; for (const b of u) s += b.toString(16).padStart(2, '0'); return s }
export function viewPubFromSigningPub(signingPubB64: string): string {
  const P = EdPoint.fromHex(_bytesToHex(b64ToBytes(signingPubB64)))
  const y = P.toAffine().y
  const num = (1n + y) % ED_P
  const den = ((1n - y) % ED_P + ED_P) % ED_P
  let u = num * _modpow(den, ED_P - 2n, ED_P) % ED_P
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) { out[i] = Number(u & 255n); u >>= 8n }
  return bytesToB64(out)
}

// ── helpers ──
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}
function bytesToB64(bytes: Uint8Array): string {
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin)
}
function concat(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((s, a) => s + a.length, 0))
  let off = 0; for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}
const label = (s: string) => new TextEncoder().encode(s)

// ── main API ──
export interface StealthParams {
  ephem_pub: string
  tag: string
  claim_data: string   // hex sha256(base64(claim_key)) — on-chain commitment
  enc_key: Uint8Array
}

export function deriveStealthParams(recipientViewPubB64: string): StealthParams {
  const recipientPub = b64ToBytes(recipientViewPubB64)
  const ephemPriv = randomBytes(32)
  const ephemPub = x25519.getPublicKey(ephemPriv)
  const shared = x25519.getSharedSecret(ephemPriv, recipientPub)
  return {
    ephem_pub: bytesToB64(ephemPub),
    tag: bytesToB64(sha256(concat(label('tag'), shared))),
    claim_data: sha256Hex(bytesToB64(sha256(concat(label('claim'), shared)))),
    enc_key: sha256(concat(label('enc'), shared)),
  }
}

export function encryptMemo(memo: object, enc_key: Uint8Array): string {
  const nonce = randomBytes(12)
  const ct = gcm(enc_key, nonce).encrypt(new TextEncoder().encode(JSON.stringify(memo)))
  return bytesToB64(concat(nonce, ct))
}

export function decryptMemo(payloadB64: string, enc_key: Uint8Array): object | null {
  try {
    const raw = b64ToBytes(payloadB64)
    const pt = gcm(enc_key, raw.slice(0, 12)).decrypt(raw.slice(12))
    return JSON.parse(new TextDecoder().decode(pt))
  } catch { return null }
}

export function buildPayload(amountRaw: number, memo: object, enc_key: Uint8Array): string {
  return btoa(amountRaw.toString(16).padStart(16, '0') + ':' + encryptMemo(memo, enc_key))
}

export interface FoundOutput {
  id: number; amount: number; claimed: boolean; memo: object | null; claim_key: string
}

/** Scan outputs for ours using a view private key (auto-derives from a signing seed if needed). */
export function findMyOutputs(
  outputs: Array<{ id: number; tag: string; ephem: string; payload: string; amount: number; claimed: number }>,
  myViewPrivB64: string,
): FoundOutput[] {
  const tryKey = (key: string): FoundOutput[] => {
    const result: FoundOutput[] = []
    for (const o of outputs) {
      try {
        const myPriv = b64ToBytes(key)
        if (myPriv.length !== 32) continue
        const shared = x25519.getSharedSecret(myPriv, b64ToBytes(o.ephem))
        if (bytesToB64(sha256(concat(label('tag'), shared))) !== o.tag) continue
        const claimKey = sha256(concat(label('claim'), shared))
        const encKey = sha256(concat(label('enc'), shared))
        let memo: object | null = null
        try {
          const raw = b64ToBytes(o.payload)
          memo = JSON.parse(new TextDecoder().decode(gcm(encKey, raw.slice(0, 12)).decrypt(raw.slice(12))))
        } catch { /* payload not decryptable */ }
        result.push({ id: o.id, amount: o.amount, claimed: o.claimed === 1, memo, claim_key: bytesToB64(claimKey) })
      } catch { /* skip */ }
    }
    return result
  }
  const res = tryKey(myViewPrivB64)
  if (res.length > 0) return res
  try { return tryKey(deriveViewPriv(myViewPrivB64)) } catch { return [] }
}

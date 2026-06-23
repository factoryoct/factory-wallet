// Encrypted vault: password -> KDF -> AES-GCM-256. Uses WebCrypto `crypto.subtle` for AEAD and
// @noble/hashes scrypt for the KDF. New vaults use scrypt; legacy PBKDF2-SHA256 vaults open via
// their stored `keyMetadata` and are re-wrapped to scrypt on the next unlock.

import { bytesToBase64, base64ToBytes } from './encoding'
import { scrypt } from '@noble/hashes/scrypt'

const ITERATIONS = 600_000          // legacy PBKDF2 work factor
// scrypt for new vaults: N=2^16 (~64 MB), r=8, p=1.
const SCRYPT_N = 1 << 16, SCRYPT_R = 8, SCRYPT_P = 1

export type KdfMeta =
  | { kdf: 'pbkdf2'; iterations: number; hash: 'sha256' }
  | { kdf: 'scrypt'; N: number; r: number; p: number }

export interface Vault {
  data: string        // base64 AES-GCM ciphertext
  iv: string          // base64 12-byte IV
  salt: string        // base64 32-byte salt
  keyMetadata: KdfMeta
}

/** The KDF new vaults are created with. */
export const defaultKdfMeta = (): KdfMeta => ({ kdf: 'scrypt', N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })

/** Read a vault's stored KDF params, defaulting to legacy PBKDF2 for pre-migration vaults. */
export function vaultMeta(v: Vault): KdfMeta {
  const m = v.keyMetadata as Partial<KdfMeta> & { kdf?: string; N?: number; r?: number; p?: number; iterations?: number }
  if (m && m.kdf === 'scrypt') return { kdf: 'scrypt', N: m.N!, r: m.r!, p: m.p! }
  return { kdf: 'pbkdf2', iterations: m?.iterations ?? ITERATIONS, hash: 'sha256' }
}

function importAes(raw: Uint8Array, extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', extractable, ['encrypt', 'decrypt'])
}

/** Derive the AES-256 vault key from the password using the given KDF metadata. Extractable so
 *  it can be cached in chrome.storage.session across service-worker suspension. */
export async function deriveVaultKey(password: string, salt: Uint8Array, meta: KdfMeta, extractable = true): Promise<CryptoKey> {
  if (meta.kdf === 'scrypt') {
    const raw = scrypt(new TextEncoder().encode(password), salt, { N: meta.N, r: meta.r, p: meta.p, dkLen: 32 })
    return importAes(raw, extractable)
  }
  // legacy PBKDF2-SHA256 path
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: meta.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt'],
  )
}

export function importVaultKey(raw: Uint8Array): Promise<CryptoKey> { return importAes(raw, true) }
export async function exportVaultKey(key: CryptoKey): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.exportKey('raw', key)) }

/** Encrypt with an already-derived key, its salt, and the KDF meta that produced the key. */
export async function encryptWithKey(plaintext: string, key: CryptoKey, salt: Uint8Array, meta: KdfMeta): Promise<Vault> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return { data: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv), salt: bytesToBase64(salt), keyMetadata: meta }
}

/** Decrypt with an already-derived key. Throws on a wrong key (AES-GCM auth tag fails). */
export async function decryptWithKey(v: Vault, key: CryptoKey): Promise<string> {
  let pt: ArrayBuffer
  try {
    pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(v.iv) }, key, base64ToBytes(v.data))
  } catch {
    throw new Error('wrong password')
  }
  return new TextDecoder().decode(pt)
}

/** One-shot encrypt from a password (new vault, scrypt). */
export async function encryptVault(plaintext: string, password: string): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const meta = defaultKdfMeta()
  const key = await deriveVaultKey(password, salt, meta)
  return encryptWithKey(plaintext, key, salt, meta)
}

/** One-shot decrypt from a password, using the vault's OWN stored KDF params. */
export async function decryptVault(v: Vault, password: string): Promise<string> {
  const key = await deriveVaultKey(password, base64ToBytes(v.salt), vaultMeta(v))
  return decryptWithKey(v, key)
}

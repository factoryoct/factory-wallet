// ed25519 keypair handling for Octra accounts. Public-key-to-address mapping lives in address.ts.

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
import { randomBytes } from '@noble/hashes/utils'

// @noble/ed25519 v2 needs sha512 wired in explicitly for the sync path.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))

export interface Keypair {
  /** 32-byte ed25519 seed / private scalar source. */
  privateKey: Uint8Array
  /** 32-byte ed25519 public key. */
  publicKey: Uint8Array
}

/** Fresh random account. */
export function generateKeypair(): Keypair {
  const privateKey = randomBytes(32)
  return { privateKey, publicKey: ed.getPublicKey(privateKey) }
}

/** Deterministic account from a 32-byte seed (e.g. derived from a mnemonic). */
export function keypairFromSeed(seed32: Uint8Array): Keypair {
  if (seed32.length !== 32) throw new Error('seed must be 32 bytes')
  return { privateKey: seed32, publicKey: ed.getPublicKey(seed32) }
}

/** Raw ed25519 signature over `message` (no extra hashing — ed25519 hashes internally). */
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed.sign(message, privateKey)
}

export function verify(sig: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  return ed.verify(sig, message, publicKey)
}

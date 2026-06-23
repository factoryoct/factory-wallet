// Octra address derivation from an ed25519 public key.
//   addr = "oct" + base58( SHA256(pubkey32) )      // no checksum, no version byte

import { sha256 } from '@noble/hashes/sha256'
import { base58Encode } from './encoding'

export function publicKeyToAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('publicKey must be 32 bytes')
  return 'oct' + base58Encode(sha256(publicKey))
}

export function isValidAddress(addr: string): boolean {
  return /^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(addr)
}

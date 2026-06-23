// Byte <-> string codecs used across the wallet core. Works in Node, the extension
// background, and tests.

import bs58 from 'bs58'

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  if (h.length % 2 !== 0) throw new Error('hex: odd length')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

export function bytesToBase64(b: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(b).toString('base64')
  let bin = ''
  for (const x of b) bin += String.fromCharCode(x)
  return btoa(bin)
}

export function base64ToBytes(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'))
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function base58Encode(b: Uint8Array): string {
  return bs58.encode(b)
}

export function base58Decode(s: string): Uint8Array {
  return bs58.decode(s)
}

export const utf8 = {
  encode: (s: string): Uint8Array => new TextEncoder().encode(s),
  decode: (b: Uint8Array): string => new TextDecoder().decode(b),
}

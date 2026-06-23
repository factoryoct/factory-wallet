// Octra native-OCT transfer: build + sign + broadcast.
//
//   preimage = compact JSON, this exact field order, no spaces:
//     {"from":..,"to_":..,"amount":"<micro-OCT-int>","nonce":<int>,"ou":"<1|3>",
//      "timestamp":<float>,"op_type":"standard"}
//   notes: amount is a micro-OCT integer string ("1000000" for 1 OCT); a decimal is
//          rejected as malformed. timestamp must be a float (integer-valued is rejected).
//          encrypted_data/message are omitted for a plain transfer.
//   sig    = ed25519(preimage_bytes, seed32), no pre-hash
//   body   = preimage object + signature(b64) + public_key(b64)
//   submit = JSON-RPC octra_submit [body]

import { OctraRpc } from './rpc'
import { sign } from './keys'
import { publicKeyToAddress } from './address'
import { bytesToBase64 } from './encoding'
import type { Keypair } from './keys'

const MICRO = 1_000_000n

/** micro-OCT -> canonical OCT decimal string ("1", "1.5", "0.000001"). */
export function microToOct(micro: bigint): string {
  const neg = micro < 0n
  const m = neg ? -micro : micro
  const int = m / MICRO
  const frac = m % MICRO
  let s = int.toString()
  if (frac > 0n) s += '.' + frac.toString().padStart(6, '0').replace(/0+$/, '')
  return (neg ? '-' : '') + s
}

/** OCT amount -> micro-OCT bigint, exactly (no lossy float multiply). Accepts a number or a
 * decimal string; parses the decimal form with integer math (≤6 fractional digits). Rejects
 * negatives and non-finite input. Falls back to a rounded multiply only for exponential notation. */
export function toMicro(oct: number | string): bigint {
  if (typeof oct === 'number' && (!Number.isFinite(oct) || oct < 0)) throw new Error('invalid amount')
  const s = String(oct).trim()
  if (/[eE]/.test(s)) return BigInt(Math.round(Number(s) * Number(MICRO)))   // rare exp form
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') throw new Error('invalid amount')
  const [whole, frac = ''] = s.split('.')
  const fracMicro = (frac + '000000').slice(0, 6)
  return BigInt(whole || '0') * MICRO + BigInt(fracMicro || '0')
}

/** Float seconds, guaranteed non-integer (the node rejects an integer-formatted timestamp). */
export function nowTimestamp(): number {
  let ts = Date.now() / 1000
  if (Number.isInteger(ts)) ts += 0.000001
  return ts
}

export interface TransferIntent {
  from: string
  to: string
  amount: bigint        // micro-OCT
  nonce: number
  timestamp: number     // float seconds
}

/** Ordered canonical object — key order is load-bearing (signed + submitted in this order). */
function txObject(i: TransferIntent): Record<string, unknown> {
  const octAmount = Number(i.amount) / Number(MICRO)
  const ou = octAmount < 1000 ? '1' : '3'
  return {
    from: i.from,
    to_: i.to,
    amount: i.amount.toString(),   // micro-OCT integer string
    nonce: i.nonce,
    ou,
    timestamp: i.timestamp,
    op_type: 'standard',
  }
}

export function serializeForSigning(i: TransferIntent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(txObject(i)))
}

export interface SignedTx {
  body: Record<string, unknown>
  preimage: string
}

export function buildSignedTransfer(i: TransferIntent, kp: Keypair): SignedTx {
  const obj = txObject(i)
  const preimage = JSON.stringify(obj)
  const sig = sign(new TextEncoder().encode(preimage), kp.privateKey)
  const body = { ...obj, signature: bytesToBase64(sig), public_key: bytesToBase64(kp.publicKey) }
  return { body, preimage }
}

/** Fetch nonce, build, sign, broadcast. Returns the node-assigned tx hash. */
export async function sendTransfer(
  rpc: OctraRpc,
  kp: Keypair,
  to: string,
  amount: bigint,
  timestamp = nowTimestamp(),
): Promise<string> {
  const from = publicKeyToAddress(kp.publicKey)
  const acct = await rpc.account(from)
  const intent: TransferIntent = { from, to, amount, nonce: acct.nonce + 1, timestamp }
  const { body } = buildSignedTransfer(intent, kp)
  return rpc.sendRawTransaction(body)
}

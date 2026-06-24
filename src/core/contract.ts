// Octra contract interaction: state-changing CALL and multi_exec batch.
// Call preimage is the 9-field canonical object (op_type "call"), signed ed25519,
// then body = preimage + signature(b64) + public_key(b64) -> octra_submit.
// `amount` is the micro-OCT value sent with the call ("0" if none); `message` is
// JSON.stringify(params).

import { OctraRpc } from './rpc'
import { sign } from './keys'
import { publicKeyToAddress } from './address'
import { bytesToBase64 } from './encoding'
import { nowTimestamp } from './tx'
import type { Keypair } from './keys'

export interface CallIntent {
  contract: string
  method: string
  params: (string | number)[]
  value?: bigint        // micro-OCT attached (default 0)
  ou?: string           // gas/priority budget (default '10000')
  nonce: number
  from: string
  timestamp: number
}

function callObject(i: CallIntent): Record<string, unknown> {
  return {
    from: i.from,
    to_: i.contract,
    amount: (i.value ?? 0n).toString(),
    nonce: i.nonce,
    ou: i.ou ?? '10000',
    timestamp: i.timestamp,
    op_type: 'call',
    encrypted_data: i.method,
    message: JSON.stringify(i.params),
  }
}

export function buildSignedCall(i: CallIntent, kp: Keypair) {
  const obj = callObject(i)
  const preimage = JSON.stringify(obj)
  const sig = sign(new TextEncoder().encode(preimage), kp.privateKey)
  const body = { ...obj, signature: bytesToBase64(sig), public_key: bytesToBase64(kp.publicKey) }
  return { body, preimage }
}

// ── deploy (op_type "deploy") ───────────────────────────────────────────────
// CONFIRMED end-to-end on devnet (self-signed deploy accepted, contract live, get()=ctor arg).
// Same 9-field canonical as a call, but op_type "deploy", to_ = the deterministic contract
// address (octra_computeContractAddress(bytecode, from, nonce)), encrypted_data = the base64
// BYTECODE (not a method name), message = JSON.stringify(constructor params). All 9 signed.
// The node re-derives to_ from the submitted bytecode, so signing to_ pins the code. `to`
// depends on the nonce, so it is precomputed before signing (see service 'deploy' case).

export interface DeployIntent {
  from: string
  to: string                    // precomputed = computeContractAddress(bytecode, from, nonce)
  bytecode: string              // base64
  params: (string | number)[]
  ou?: string                   // deploys are heavy; default '200000'
  nonce: number
  timestamp: number
}

function deployObject(i: DeployIntent): Record<string, unknown> {
  return {
    from: i.from,
    to_: i.to,
    amount: '0',
    nonce: i.nonce,
    ou: i.ou ?? '200000',
    timestamp: i.timestamp,
    op_type: 'deploy',
    encrypted_data: i.bytecode,
    message: JSON.stringify(i.params),
  }
}

export function buildSignedDeploy(i: DeployIntent, kp: Keypair) {
  const obj = deployObject(i)
  const preimage = JSON.stringify(obj)
  const sig = sign(new TextEncoder().encode(preimage), kp.privateKey)
  const body = { ...obj, signature: bytesToBase64(sig), public_key: bytesToBase64(kp.publicKey) }
  return { body, preimage }
}

// ── encrypt / decrypt (shield / unshield) ───────────────────────────────────
// op_type "encrypt": to_ = self, amount = micro-OCT to shield, and the privacy payload
// {cipher,amount_commitment,zero_proof,blinding} goes JSON-stringified into encrypted_data.
// Preimage is the 8-field object below (no `message`); encrypted_data is part of the signed body.

export interface EncryptIntent {
  from: string
  to?: string             // defaults to self
  amount: bigint          // micro-OCT to shield (encrypt) / unshield (decrypt)
  encryptedData: string   // privacy payload, already JSON-stringified
  opType: 'encrypt' | 'decrypt'
  ou?: string
  nonce: number
  timestamp: number
}

function encryptObject(i: EncryptIntent): Record<string, unknown> {
  return {
    from: i.from,
    to_: i.to ?? i.from,
    amount: i.amount.toString(),
    nonce: i.nonce,
    ou: i.ou ?? '1000',
    timestamp: i.timestamp,
    op_type: i.opType,
    encrypted_data: i.encryptedData,
  }
}

export function buildSignedEncrypt(i: EncryptIntent, kp: Keypair) {
  const obj = encryptObject(i)
  const preimage = JSON.stringify(obj)
  const sig = sign(new TextEncoder().encode(preimage), kp.privateKey)
  const body = { ...obj, signature: bytesToBase64(sig), public_key: bytesToBase64(kp.publicKey) }
  return { body, preimage }
}

/** Build, sign, broadcast a shield (encrypt) / unshield (decrypt) tx. Returns the tx hash. */
export async function sendEncryptOp(
  rpc: OctraRpc,
  kp: Keypair,
  opType: 'encrypt' | 'decrypt',
  amount: bigint,
  encryptedData: string,
  opts: { ou?: string } = {},
): Promise<string> {
  const from = publicKeyToAddress(kp.publicKey)
  const acct = await rpc.account(from)
  const { body } = buildSignedEncrypt(
    { from, amount, encryptedData, opType, ou: opts.ou, nonce: acct.nonce + 1, timestamp: nowTimestamp() },
    kp,
  )
  return rpc.sendRawTransaction(body)
}

/** Fetch nonce, build, sign, broadcast a contract call. Returns the tx hash. */
export async function sendCall(
  rpc: OctraRpc,
  kp: Keypair,
  contract: string,
  method: string,
  params: (string | number)[],
  opts: { value?: bigint; ou?: string } = {},
): Promise<string> {
  const from = publicKeyToAddress(kp.publicKey)
  const acct = await rpc.account(from)
  const { body } = buildSignedCall(
    { contract, method, params, value: opts.value, ou: opts.ou, nonce: acct.nonce + 1, from, timestamp: nowTimestamp() },
    kp,
  )
  return rpc.sendRawTransaction(body)
}

// ── multi_exec (atomic batch, ≤8 calls) ─────────────────────────────────────
// Form: to_="multi_exec", amount="0", op_type="multi_exec",
//   message = JSON {"calls":[{amount,method,params,to}, ...]}. Inner keys must be in
//   sorted order (amount,method,params,to); `to` is the per-call target, `amount` its
//   micro-OCT value. The whole 8-field object is signed.

export interface MultiCall {
  to: string
  method: string
  params: (string | number)[]
  value?: bigint        // micro-OCT attached to this sub-call (default 0)
}

export interface MultiExecIntent {
  from: string
  nonce: number
  timestamp: number
  ou?: string
  calls: MultiCall[]
}

function multiExecObject(i: MultiExecIntent): Record<string, unknown> {
  // inner call objects: keys in the exact sorted order the node uses (amount,method,params,to)
  const calls = i.calls.map(c => ({
    amount: (c.value ?? 0n).toString(),
    method: c.method,
    params: c.params,
    to: c.to,
  }))
  return {
    from: i.from,
    to_: 'multi_exec',
    amount: '0',
    nonce: i.nonce,
    ou: i.ou ?? '5000',
    timestamp: i.timestamp,
    op_type: 'multi_exec',
    message: JSON.stringify({ calls }),
  }
}

export function buildSignedMultiExec(i: MultiExecIntent, kp: Keypair) {
  const obj = multiExecObject(i)
  const preimage = JSON.stringify(obj)
  const sig = sign(new TextEncoder().encode(preimage), kp.privateKey)
  const body = { ...obj, signature: bytesToBase64(sig), public_key: bytesToBase64(kp.publicKey) }
  return { body, preimage }
}

/** Fetch nonce, build, sign, broadcast an atomic multi_exec batch. Returns the tx hash. */
export async function sendMultiExec(
  rpc: OctraRpc,
  kp: Keypair,
  calls: MultiCall[],
  opts: { ou?: string } = {},
): Promise<string> {
  if (calls.length === 0 || calls.length > 8) throw new Error('multi_exec: 1..8 calls')
  const from = publicKeyToAddress(kp.publicKey)
  const acct = await rpc.account(from)
  const { body } = buildSignedMultiExec(
    { from, nonce: acct.nonce + 1, timestamp: nowTimestamp(), ou: opts.ou, calls },
    kp,
  )
  return rpc.sendRawTransaction(body)
}

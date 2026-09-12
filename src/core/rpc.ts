// JSON-RPC client for the Octra node.

export const DEFAULT_RPC = 'https://devnet.octrascan.io/rpc'
const REQUEST_TIMEOUT_MS = 15_000

export interface AccountInfo {
  address: string
  balance: string       // decimal OCT, e.g. "3477.070126"
  balance_raw: string   // micro-OCT integer
  nonce: number
  has_public_key: boolean
}

// A rejection returned by the node (vs a transport failure); never retried or failed over.
class RpcError extends Error {}

export class OctraRpc {
  private id = 1
  private endpoints: string[]
  constructor(url: string = DEFAULT_RPC) { this.endpoints = [url] }

  get url() { return this.endpoints[0] }
  set url(u: string) { this.setEndpoints([u]) }

  // Active endpoint plus any fallbacks; tried in order, the first that answers is promoted.
  setEndpoints(urls: string[]) {
    const list = [...new Set(urls.filter(Boolean))]
    this.endpoints = list.length ? list : [DEFAULT_RPC]
  }

  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: this.id++, method, params })
    let lastErr: unknown
    for (let pass = 0; pass < 2; pass++) {
      for (const url of this.endpoints) {
        try {
          const j = await this.fetchRpc(url, body)
          if (j.error) throw new RpcError(`RPC[${method}]: ${JSON.stringify(j.error)}`)
          if (url !== this.endpoints[0]) this.endpoints = [url, ...this.endpoints.filter(e => e !== url)]
          return j.result as T
        } catch (e) {
          if (e instanceof RpcError) throw e
          lastErr = e
        }
      }
      if (pass === 0) await sleep(300)
    }
    throw lastErr instanceof Error ? lastErr : new Error(`RPC[${method}]: all endpoints failed`)
  }

  private async fetchRpc(url: string, body: string): Promise<any> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } finally { clearTimeout(timer) }
  }

  /** Account balance + nonce. */
  account(address: string): Promise<AccountInfo> {
    return this.call<AccountInfo>('octra_account', [address])
  }

  /** Confirmed AND pending nonce. `octra_account` only reports the confirmed one, so a second
   * tx signed while the first is still queued reuses its nonce and the node rejects it with
   * "duplicate nonce (fee rate bump < 10%)". `octra_balance` reports both. */
  async nonces(address: string): Promise<{ nonce: number; pending: number }> {
    const r = await this.call<{ nonce?: number; pending_nonce?: number }>('octra_balance', [address])
    const nonce = Number(r?.nonce ?? 0)
    const pending = Number(r?.pending_nonce ?? nonce)
    return { nonce, pending: Math.max(nonce, pending) }
  }

  /** Deterministic deployment address for (bytecode, deployer, nonce). The deploy tx's
   * to_ MUST equal this (it is signed), so the node accepts the bytecode that derives it.
   * nonce MUST be a number (a string yields nonce=0). Confirmed against a live deploy. */
  async computeContractAddress(bytecodeB64: string, deployer: string, nonce: number): Promise<string> {
    const r = await this.call<{ address?: string } | string>('octra_computeContractAddress', [bytecodeB64, deployer, nonce])
    const addr = typeof r === 'string' ? r : r?.address
    if (!addr) throw new Error('computeContractAddress: no address')
    return addr
  }

  /** Raw single storage key of a contract (some tokens keep the public balance under
   * `pub_balances:<addr>` and their balance_of view is unreliable). Returns '0' if unset. */
  async contractStorage(addr: string, key: string): Promise<string> {
    const r = await this.call<{ value?: string } | string>('octra_contractStorage', [addr, key])
    return (typeof r === 'string' ? r : r?.value) ?? '0'
  }

  /** Read-only contract view. Unwraps the { result, storage } envelope when present. */
  async view<T = unknown>(addr: string, method: string, params: unknown[] = []): Promise<T> {
    const raw = await this.call<any>('contract_call', [addr, method, params, null])
    return (raw && typeof raw === 'object' && 'result' in raw ? raw.result : raw) as T
  }

  /** Read-only view that returns a multi-value tuple (node encodes it as "<len>#<val>…"). */
  async viewTuple(addr: string, method: string, params: unknown[] = []): Promise<string[]> {
    const raw = await this.call<any>('contract_call', [addr, method, params, ''])
    const r = raw && typeof raw === 'object' && 'result' in raw ? raw.result : raw
    return parseTuple(String(r ?? ''))
  }

  /** Compile AML source -> base64 bytecode. */
  async compile(source: string): Promise<string> {
    const r = await this.call<{ bytecode?: string }>('octra_compileAml', [source])
    if (!r?.bytecode) throw new Error('compile returned no bytecode')
    return r.bytecode
  }

  /** Tx receipt. */
  receipt(hash: string): Promise<any> {
    return this.call('contract_receipt', [hash])
  }

  transaction(hash: string): Promise<any> {
    return this.call('octra_transaction', [hash])
  }

  /** Registered ed25519 public key for an address (base64), or null if none on-chain. */
  async publicKey(address: string): Promise<string | null> {
    try {
      const r = await this.call<any>('octra_publicKey', [address])
      if (!r) return null
      return typeof r === 'string' ? r : (r.public_key ?? r.publicKey ?? null)
    } catch { return null }
  }

  /**
   * Broadcast a fully-built, self-signed transaction body via JSON-RPC `octra_submit`.
   * Returns the node-assigned tx hash. Throws the node's error verbatim on rejection.
   */
  async sendRawTransaction(signedTx: unknown): Promise<string> {
    const r = await this.call<any>('octra_submit', [signedTx])
    const hash = typeof r === 'string' ? r : (r?.tx_hash ?? r?.hash ?? r?.txhash)
    // A non-hash response must surface as an error, not a false success.
    if (typeof hash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error('octra_submit: no valid tx hash in response: ' + JSON.stringify(r).slice(0, 200))
    }
    return hash
  }
}

// Node encodes multi-value returns as concatenated "<len>#<value>" items.
export function parseTuple(encoded: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < encoded.length) {
    let lenStr = ''
    while (i < encoded.length && encoded[i] !== '#') lenStr += encoded[i++]
    i++ // skip '#'
    const len = parseInt(lenStr, 10)
    if (!Number.isFinite(len)) break
    out.push(encoded.slice(i, i + len))
    i += len
  }
  return out
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Poll a tx to confirmation. Returns { success, error, tx }. */
export async function waitForTx(rpc: OctraRpc, hash: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(2500)
    let tx: any = null
    try { tx = await rpc.transaction(hash) } catch { /* retry */ }
    if (!tx) continue
    const st = tx.status ?? ''
    if (st === 'confirmed' || tx.success === true) return { success: true, tx }
    if (st === 'rejected' || st === 'failed' || st === 'dropped') {
      return { success: false, error: JSON.stringify(tx.error ?? st), tx }
    }
  }
  return { success: false, error: 'timeout' }
}

// Background wallet service. Holds the decrypted keyring and a derived AES key only while
// unlocked; persists just the encrypted vault to chrome.storage.local. The popup/provider
// talk to it via runtime messages.

import { Keyring } from '../core/keyring'
import { sign } from '../core/keys'
import { deriveVaultKey, encryptWithKey, decryptWithKey, importVaultKey, exportVaultKey, defaultKdfMeta, vaultMeta, type Vault, type KdfMeta } from '../core/vault'
import { OctraRpc } from '../core/rpc'
import { buildSignedTransfer, toMicro, nowTimestamp } from '../core/tx'
import { buildSignedCall, buildSignedMultiExec, buildSignedEncrypt, buildSignedDeploy, type MultiCall } from '../core/contract'
import { positionAmounts } from '../core/amm'
import { isValidAddress } from '../core/address'
import { base64ToBytes, bytesToBase64, bytesToHex } from '../core/encoding'

const SESSION_KEY = 'fw_session'

const VAULT_KEY = 'factory_vault'
const RPC_KEY = 'fw_rpc'
const TOKENS_KEY = 'fw_tokens'
const DEFAULT_ITERS = 600_000
// Pool-indexer holding a wallet's LP positions (pool + tick range). Overridable via fw_indexer.
const DEFAULT_INDEXER = 'https://138.124.52.16.sslip.io'

// Factory AMM stack (live octGmgc deploy). Overridable via chrome.storage.local
// (fw_factory / fw_router / fw_quoter / fw_swaphelper / fw_woct).
const FACTORY_ADDR    = 'octGmgcYUCJ1LMyKNihRLRKWTbmyfyDzkTSNxjet9fpyZKM'
const WOCT_ADDR       = 'oct7Nt4BBbh6UCmuRjDLmQceew6TxkcYzmo5wcX9iEetY95'
const ROUTER_ADDR     = 'octGt3GGL5AyvYtkkiqoKabr4nhydEq7hFDLX1vPhNvyJaC'
const QUOTER_ADDR     = 'oct8PHLE4VdZ5bpFjatTraM8J84RoqYT9qgSV4w2z8cQo8n'
const SWAPHELPER_ADDR = 'octGHsM8GaHfbHtyf7wHa4ZE5ZzHCtrc8YD4Kiy3jfLCTzz'
const Q96 = 2n ** 96n

interface PoolMeta { address: string; token0: string; token1: string; liquidity: number; sqrtPrice: string; router: string; fee: number }
let _poolCache: PoolMeta[] | null = null
let _poolCacheAt = 0
async function fetchPools(rpc: OctraRpc, factory: string): Promise<PoolMeta[]> {
  if (_poolCache && Date.now() - _poolCacheAt < 30_000) return _poolCache
  if (!factory) return []
  const out: PoolMeta[] = []
  try {
    const count = Number(await rpc.view(factory, 'get_pool_count', []))
    const metas = await Promise.all(Array.from({ length: count }, (_, i) => i).map(async (i) => {
      try {
        const addr = String(await rpc.view(factory, 'get_pool_at', [i]))
        const [tokens, slot0, liq, router, config] = await Promise.all([
          rpc.viewTuple(addr, 'get_tokens', []),
          rpc.viewTuple(addr, 'get_slot0', []),
          rpc.view(addr, 'get_liquidity', []).catch(() => '0'),
          rpc.view(addr, 'get_router', []).catch(() => ''),
          rpc.viewTuple(addr, 'get_config', []).catch(() => [] as string[]),
        ])
        return { address: addr, token0: tokens[0], token1: tokens[1], liquidity: Number(liq) || 0, sqrtPrice: slot0[0] || '0', router: String(router || ''), fee: Number(config[0]) || 0 } as PoolMeta
      } catch { return null }
    }))
    for (const m of metas) if (m) out.push(m)
    if (out.length) { _poolCache = out; _poolCacheAt = Date.now() }
  } catch { /* factory unreachable */ }
  return out
}
// OCT value of 1 unit of the non-WOCT token in a WOCT pool (0 if bricked / no price).
function tokenOctPrice(p: PoolMeta, woct: string): number {
  if (!p.sqrtPrice || p.sqrtPrice === '0') return 0
  const s = BigInt(p.sqrtPrice)
  const price = Number((s * s * (10n ** 6n)) / (Q96 * Q96)) / 1e6
  if (!(price > 0) || price < 1e-15 || price > 1e15) return 0
  return p.token0 === woct ? 1 / price : price
}
// Deepest pool (max liquidity) for an unordered token pair on the current router, or null.
function bestPoolForPair(pools: PoolMeta[], a: string, b: string, router: string): PoolMeta | null {
  const cands = pools.filter(p =>
    p.liquidity > 0 &&
    (!router || !p.router || p.router === router) &&
    ((p.token0 === a && p.token1 === b) || (p.token0 === b && p.token1 === a)))
  if (!cands.length) return null
  return cands.reduce((best, p) => (p.liquidity > best.liquidity ? p : best))
}

// Enforce the vault password policy in the background, not just the popup UI.
function assertPasswordPolicy(pw: unknown): asserts pw is string {
  if (typeof pw !== 'string' || pw.length < 12) throw new Error('password must be at least 12 characters')
  if (/^(?:password|12345678|qwerty|letmein|111111|000000|abc123)/i.test(pw) || /^(\d)\1+$/.test(pw)) throw new Error('password is too common')
}

export const NETWORKS = [
  { name: 'Octra devnet',  url: 'https://devnet.octrascan.io/rpc' },
  { name: 'Octra mainnet', url: 'https://octra.network/rpc' },
]

// Default token list used to seed the wallet on first run; user-managed after that.
const KNOWN_TOKENS = [
  { symbol: 'FACT', address: 'octCNJqKig9nXd78YiB64dLAaH1y6NJ9RVyhVTmoZfpbR4T' },
]

function requireAddress(a: string): string {
  if (!isValidAddress(a)) throw new Error('invalid address: ' + a)
  return a
}

const isNonceError = (e: unknown) => /nonce/i.test(String((e as { message?: unknown })?.message ?? ''))

// fetch JSON with a couple of retries.
async function fetchJson(url: string, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json() } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 400 * (i + 1)))
  }
  return null
}

type Msg =
  | { type: 'status' }
  | { type: 'create'; password: string }
  | { type: 'importWallet'; password: string; mode?: 'seed' | 'mnemonic' | 'private'; value: string }
  | { type: 'unlock'; password: string }
  | { type: 'lock' }
  | { type: 'accounts' }
  | { type: 'addAccount'; mode?: 'new' | 'private' | 'mnemonic'; value?: string }
  | { type: 'removeAccount'; address: string }
  | { type: 'balance'; address: string }
  | { type: 'tokens'; address: string }
  | { type: 'lpPositions'; address: string }
  | { type: 'addToken'; address: string }
  | { type: 'removeToken'; address: string }
  | { type: 'activity'; address: string }
  | { type: 'octPrice' }
  | { type: 'octChart' }
  | { type: 'getSelected' }
  | { type: 'setSelected'; address: string }
  | { type: 'getNetwork' }
  | { type: 'setNetwork'; url: string }
  | { type: 'getAutoLock' }
  | { type: 'setAutoLock'; minutes: number }
  | { type: 'renameAccount'; address: string; label: string }
  | { type: 'changePassword'; oldPassword: string; newPassword: string }
  | { type: 'exportPrivateKey'; address: string; password: string }
  | { type: 'reset' }
  | { type: 'getSeed'; address: string }
  | { type: 'getSecrets'; address: string }
  | { type: 'privateBalanceCached'; address: string }
  | { type: 'encryptOp'; address: string; amountMicro: string; encryptedData: string; opType: 'encrypt' | 'decrypt'; ou?: string }
  | { type: 'send'; address: string; to: string; oct: number }
  | { type: 'sendToken'; address: string; token: string; to: string; amountMicro: string }
  | { type: 'call'; address: string; contract: string; method: string; params: (string | number)[]; valueOct?: number }
  | { type: 'multiExec'; address: string; calls: MultiCall[]; ou?: string }
  | { type: 'deploy'; address: string; bytecode: string; params?: (string | number)[]; ou?: string }
  | { type: 'signMessage'; address: string; message: string }
  | { type: 'txReceipt'; hash: string }
  | { type: 'tokenSupply'; token: string }
  | { type: 'swapQuote'; tokenIn: string; tokenOut: string; amountInMicro: string }
  | { type: 'swap'; address: string; tokenIn: string; tokenOut: string; amountInMicro: string; minOutMicro: string; fee: number }
  | { type: 'prices' }
  | { type: 'priceSeries'; token: string }

export class WalletService {
  private keyring: Keyring | null = null
  private vkey: CryptoKey | null = null         // derived AES key, held only while unlocked
  private vsalt: Uint8Array | null = null
  private vmeta: KdfMeta = { kdf: 'pbkdf2', iterations: DEFAULT_ITERS, hash: 'sha256' }   // overwritten on unlock/create
  private rpc = new OctraRpc()

  // Serialize signing and track a local pending nonce so two overlapping txs don't both
  // sign nonce N+1 (one would be silently dropped).
  private signingQueue: Promise<unknown> = Promise.resolve()
  private pendingNonce: Record<string, number> = {}

  constructor() {
    // apply the user's chosen RPC endpoint on startup
    chrome.storage.local.get(RPC_KEY).then(r => { if (r[RPC_KEY]) this.rpc.url = r[RPC_KEY] as string })
  }

  private async loadVault(): Promise<Vault | null> {
    const r = await chrome.storage.local.get(VAULT_KEY)
    return (r[VAULT_KEY] as Vault) ?? null
  }
  private async loadTokens(): Promise<{ symbol: string; address: string }[]> {
    const r = await chrome.storage.local.get(TOKENS_KEY)
    return (r[TOKENS_KEY] as { symbol: string; address: string }[]) ?? KNOWN_TOKENS.slice()
  }
  private async saveVault(): Promise<void> {
    if (!this.keyring || !this.vkey || !this.vsalt) throw new Error('locked')
    const vault = await encryptWithKey(this.keyring.serialize(), this.vkey, this.vsalt, this.vmeta)
    await chrome.storage.local.set({ [VAULT_KEY]: vault })
  }
  private requireUnlocked(): Keyring {
    if (!this.keyring) throw new Error('locked')
    return this.keyring
  }
  private async setUnlocked(password: string, salt: Uint8Array, meta: KdfMeta) {
    this.vsalt = salt
    this.vmeta = meta
    this.vkey = await deriveVaultKey(password, salt, meta)
    await this.cacheSession()
  }

  // Cache the derived key in chrome.storage.session (memory-only, survives SW suspension) so
  // reopening the popup within the auto-lock window does not re-prompt for the password.
  private async cacheSession() {
    if (!this.vkey || !this.vsalt) return
    try {
      const raw = await exportVaultKey(this.vkey)
      await chrome.storage.session.set({ [SESSION_KEY]: { keyB64: bytesToBase64(raw), salt: bytesToBase64(this.vsalt), meta: this.vmeta } })
    } catch { /* session unavailable */ }
  }
  private async clearSession() { try { await chrome.storage.session.remove(SESSION_KEY) } catch { /* */ } }

  // Rehydrate the unlocked state from the session cache after an SW restart.
  private async ensureUnlocked() {
    if (this.keyring) return
    try {
      const r = await chrome.storage.session.get(SESSION_KEY)
      const s = r[SESSION_KEY] as { keyB64: string; salt: string; meta: KdfMeta } | undefined
      if (!s) return
      const vault = await this.loadVault()
      if (!vault) return
      const key = await importVaultKey(base64ToBytes(s.keyB64))
      this.keyring = Keyring.deserialize(await decryptWithKey(vault, key))
      this.vkey = key; this.vsalt = base64ToBytes(s.salt); this.vmeta = s.meta
    } catch { /* corrupt session -> stay locked */ }
  }

  /** Serialize a signing op and assign a non-colliding nonce; on a nonce rejection, resync from
   * the chain and resubmit once. */
  private async signTx(address: string, build: (nonce: number) => { body: Record<string, unknown> }): Promise<{ hash: string }> {
    const attempt = async (bump: number) => {
      // The node counts a queued tx too, so take the pending nonce, not just the confirmed one.
      const { nonce, pending } = await this.rpc.nonces(address)
      if (bump > 0) this.pendingNonce[address] = 0          // resync: trust the chain again
      const next = Math.max(nonce, pending, this.pendingNonce[address] ?? 0) + 1 + bump
      const { body } = build(next)
      const hash = await this.rpc.sendRawTransaction(body)
      this.pendingNonce[address] = next
      return { hash }
    }
    const run = () => attempt(0)
      .catch(e => isNonceError(e) ? attempt(1) : Promise.reject(e))
      .catch(e => isNonceError(e) ? attempt(2) : Promise.reject(e))
    const p = this.signingQueue.then(run, run)
    this.signingQueue = p.then(() => {}, () => {})
    return p
  }

  /** Deploy variant of signTx: the contract address depends on the nonce, so it is computed
   * inside the serialized slot (after the nonce is fixed) and returned to the caller. */
  private async signDeploy(address: string, bytecode: string, params: (string | number)[], ou: string | undefined, kp: Keypair): Promise<{ hash: string; contractAddress: string }> {
    const attempt = async (bump: number) => {
      const { nonce, pending } = await this.rpc.nonces(address)
      if (bump > 0) this.pendingNonce[address] = 0
      const next = Math.max(nonce, pending, this.pendingNonce[address] ?? 0) + 1 + bump
      const to = await this.rpc.computeContractAddress(bytecode, address, next)
      const { body } = buildSignedDeploy({ from: address, to, bytecode, params, ou, nonce: next, timestamp: nowTimestamp() }, kp)
      const hash = await this.rpc.sendRawTransaction(body)
      this.pendingNonce[address] = next
      return { hash, contractAddress: to }
    }
    const run = () => attempt(0)
      .catch(e => isNonceError(e) ? attempt(1) : Promise.reject(e))
      .catch(e => isNonceError(e) ? attempt(2) : Promise.reject(e))
    const p = this.signingQueue.then(run, run)
    this.signingQueue = p.then(() => {}, () => {})
    return p
  }

  async handle(msg: Msg): Promise<unknown> {
    await this.ensureUnlocked()
    switch (msg.type) {
      case 'status':
        return { hasVault: (await this.loadVault()) !== null, unlocked: this.keyring !== null }

      case 'create': {
        if (await this.loadVault()) throw new Error('wallet already exists')
        assertPasswordPolicy(msg.password)
        this.keyring = new Keyring()
        this.keyring.createAccount('Account 1')
        await this.setUnlocked(msg.password, crypto.getRandomValues(new Uint8Array(32)), defaultKdfMeta())
        await this.saveVault()
        return this.keyring.list()
      }

      case 'importWallet': {
        if (await this.loadVault()) throw new Error('wallet already exists')
        assertPasswordPolicy(msg.password)
        this.keyring = new Keyring()
        if (msg.mode === 'mnemonic') this.keyring.importMnemonic(msg.value, 'Account 1')
        else if (msg.mode === 'private') this.keyring.importPrivateKey(msg.value, 'Account 1')
        else this.keyring.importSeed(msg.value, 'Account 1')
        await this.setUnlocked(msg.password, crypto.getRandomValues(new Uint8Array(32)), defaultKdfMeta())
        await this.saveVault()
        return this.keyring.list()
      }

      case 'unlock': {
        const vault = await this.loadVault()
        if (!vault) throw new Error('no wallet')
        const salt = base64ToBytes(vault.salt)
        const meta = vaultMeta(vault)
        const key = await deriveVaultKey(msg.password, salt, meta)
        const json = await decryptWithKey(vault, key)   // throws 'wrong password' on bad key
        this.keyring = Keyring.deserialize(json)
        this.vkey = key; this.vsalt = salt; this.vmeta = meta
        await this.cacheSession()
        // Upgrade a legacy PBKDF2 vault to scrypt on first successful unlock (re-derive and
        // re-encrypt under a fresh salt). Best-effort; on failure the old vault is kept.
        if (meta.kdf !== 'scrypt') {
          try { await this.setUnlocked(msg.password, crypto.getRandomValues(new Uint8Array(32)), defaultKdfMeta()); await this.saveVault() } catch { /* keep legacy vault */ }
        }
        return this.keyring.list()
      }

      case 'lock':
        this.keyring = null; this.vkey = null; this.vsalt = null
        await this.clearSession()
        // Scrub cached private-balance values so locking leaves nothing behind.
        try { const all = await chrome.storage.session.get(null); const k = Object.keys(all).filter(x => x.startsWith('fw_ppriv_')); if (k.length) await chrome.storage.session.remove(k) } catch { /* */ }
        try { const all = await chrome.storage.local.get(null); const k = Object.keys(all).filter(x => x.startsWith('fw_ppriv_')); if (k.length) await chrome.storage.local.remove(k) } catch { /* */ }
        return { ok: true }

      case 'accounts':
        return this.requireUnlocked().list()

      case 'addAccount': {
        const kr = this.requireUnlocked()
        if (msg.mode === 'private') kr.importPrivateKey(msg.value ?? '')
        else if (msg.mode === 'mnemonic') kr.importMnemonic(msg.value ?? '')
        else kr.createAccount()
        await this.saveVault()
        return kr.list()
      }

      case 'removeAccount': {
        const kr = this.requireUnlocked()
        kr.remove(msg.address)
        await this.saveVault()
        return kr.list()
      }

      case 'balance': {
        const acct = await this.rpc.account(msg.address).catch(() => null)
        return { balance: acct?.balance ?? '0', nonce: acct?.nonce ?? 0 }
      }

      // Private balance needs the account seed in the popup to build the pvac context.
      // Only while unlocked; never crosses to a web page.
      case 'getSeed': {
        const kp = this.requireUnlocked().keypair(msg.address)
        return { seedHex: bytesToHex(kp.privateKey) }
      }

      case 'getSecrets':
        return this.requireUnlocked().secrets(msg.address)

      // Decrypted private balance from the popup's encrypted on-disk cache (no fresh FHE work).
      // The cache is sealed with a key derived from the seed; the background holds the seed, so it
      // can read the value the popup last computed. Returns null until the popup has decrypted once.
      case 'privateBalanceCached': {
        const seed = this.requireUnlocked().keypair(msg.address).privateKey
        const dk = `fw_pdisk_${msg.address}_${this.rpc.url}`
        const blob = (await chrome.storage.local.get(dk))[dk] as { cipher: string; iv: string; ct: string } | undefined
        if (!blob) return { value: null }
        try {
          const keyRaw = await crypto.subtle.digest('SHA-256', seed)
          const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt'])
          const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(blob.iv) }, key, base64ToBytes(blob.ct))
          return { value: new TextDecoder().decode(pt) }
        } catch { return { value: null } }
      }

      case 'tokens': {
        const list = await this.loadTokens()
        const acct = await this.rpc.account(msg.address).catch(() => null)
        const out: { symbol: string; balance: string; native: boolean; address: string }[] =
          [{ symbol: 'OCT', balance: acct?.balance ?? '0', native: true, address: '' }]
        await Promise.all(list.map(async t => {
          let pub = await this.rpc.view<string>(t.address, 'balance_of', [msg.address]).catch(() => '0')
          // confidential-token (shield/unshield) detection: has_private is a valid method that returns
          // 0/1. If present, the token supports a shielded balance; when the user has one, fetch the
          // ciphertext so the popup can decrypt + show public and shielded on the SAME row.
          let confidential = false, privCipher = ''
          const hp = await this.rpc.view<string>(t.address, 'has_private', [msg.address]).catch(() => null)
          if (hp === '0' || hp === '1') {
            confidential = true
            // these tokens keep the public balance under pub_balances:<addr>; their balance_of view
            // returns 0, so read the storage key directly (matches the confidential-pool frontend).
            pub = await this.rpc.contractStorage(t.address, 'pub_balances:' + msg.address).catch(() => pub)
            if (hp === '1') privCipher = await this.rpc.view<string>(t.address, 'private_balance_of', [msg.address]).catch(() => '')
          }
          out.push({ symbol: t.symbol, balance: (Number(pub) / 1e6).toString(), native: false, address: t.address, confidential, privCipher })
        }))
        return out
      }

      case 'lpPositions': {
        // The indexer returns only the CURRENT factory's positions (it filters out pools from older
        // factory deploys), so the client doesn't need to enumerate the factory itself.
        const base = (await chrome.storage.local.get('fw_indexer'))['fw_indexer'] as string || DEFAULT_INDEXER
        let saved: any[] = []
        try { const r = await fetch(`${base}?wallet=${msg.address}`); if (r.ok) saved = await r.json() } catch { return [] }
        if (!Array.isArray(saved) || !saved.length) return []
        const symCache: Record<string, string> = {}
        const symbolOf = async (a: string): Promise<string> => {
          if (symCache[a]) return symCache[a]
          let s = a.slice(3, 8).toUpperCase()
          try { const v = await this.rpc.view<string>(a, 'get_symbol', []); if (v) s = String(v).trim().slice(0, 8) } catch { /* */ }
          return (symCache[a] = s)
        }
        const out: any[] = []
        await Promise.all(saved.map(async (p: any) => {
          try {
            const tl = Number(p.tickLower), tu = Number(p.tickUpper)
            const pos = await this.rpc.viewTuple(p.pool, 'get_position', [msg.address, String(tl), String(tu)])
            const liq = BigInt(pos[0] || '0')
            let owed0 = BigInt(pos[1] || '0'), owed1 = BigInt(pos[2] || '0')
            if (liq === 0n && owed0 === 0n && owed1 === 0n) return
            const [toks, cfg, slot0] = await Promise.all([
              this.rpc.viewTuple(p.pool, 'get_tokens', []).catch(() => [] as string[]),
              this.rpc.viewTuple(p.pool, 'get_config', []).catch(() => [] as string[]),
              this.rpc.viewTuple(p.pool, 'get_slot0', []).catch(() => [] as string[]),
            ])
            if (liq > 0n) {
              try {
                const pf = await this.rpc.viewTuple(p.pool, 'get_pending_fees', [msg.address, String(tl), String(tu)])
                const f0 = BigInt(pf[0] || '0'), f1 = BigInt(pf[1] || '0')
                if (f0 > owed0) owed0 = f0; if (f1 > owed1) owed1 = f1
              } catch { /* pool may lack get_pending_fees */ }
            }
            const sqrtPrice = BigInt(slot0[0] || '0'), curTick = Number(slot0[1] ?? 0)
            const { amount0, amount1 } = positionAmounts(liq, sqrtPrice, tl, tu)
            const [sym0, sym1] = toks.length >= 2 ? [await symbolOf(toks[0]), await symbolOf(toks[1])] : ['?', '?']
            out.push({
              pool: p.pool, sym0, sym1, fee: cfg.length ? Number(cfg[0]) : 0,
              amount0: amount0.toString(), amount1: amount1.toString(),
              owed0: owed0.toString(), owed1: owed1.toString(),
              inRange: liq > 0n && curTick >= tl && curTick < tu,
            })
          } catch { /* skip unreadable position */ }
        }))
        return out
      }

      case 'addToken': {
        const addr = msg.address.trim()
        if (!isValidAddress(addr)) throw new Error('invalid token address')
        // must be a token contract (has a balance ledger)
        await this.rpc.view(addr, 'balance_of', [addr]).catch(() => { throw new Error('not a token contract') })
        const sym = String(await this.rpc.view(addr, 'get_symbol', []).catch(() => '')).trim().slice(0, 10) || addr.slice(3, 9).toUpperCase()
        const list = await this.loadTokens()
        if (!list.some(t => t.address === addr)) list.push({ symbol: sym, address: addr })
        await chrome.storage.local.set({ [TOKENS_KEY]: list })
        return list
      }

      case 'removeToken': {
        const list = (await this.loadTokens()).filter(t => t.address !== msg.address)
        await chrome.storage.local.set({ [TOKENS_KEY]: list })
        return list
      }

      case 'activity': {
        const r = await this.rpc.call<{ transactions?: unknown[] }>('octra_transactionsByAddress', [msg.address, 25, 0]).catch(() => null)
        return r?.transactions ?? []
      }

      case 'octPrice': {
        const j = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=octra&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true')
        if (j?.octra) {
          const out = { usd: j.octra.usd ?? 0, change24h: j.octra.usd_24h_change ?? 0, mcap: j.octra.usd_market_cap ?? 0, vol: j.octra.usd_24h_vol ?? 0 }
          await chrome.storage.local.set({ fw_price: out })
          return out
        }
        return (await chrome.storage.local.get('fw_price')).fw_price ?? { usd: 0, change24h: 0, mcap: 0, vol: 0 }
      }

      // Contract-call/multi_exec receipt status. { success: null } = not mined yet (poll again).
      case 'txReceipt': {
        const r = await this.rpc.receipt(msg.hash).catch(() => null) as { success?: boolean; error?: string | null } | null
        if (!r || typeof r.success !== 'boolean') return { success: null }
        return { success: r.success, error: r.error ?? null }
      }

      case 'tokenSupply': {
        const token = (msg.token as string).trim()
        if (!token) return ''
        const v = await this.rpc.view<string>(token, 'total_supply', []).catch(() => '')
        return v == null ? '' : String(v)
      }

      // Quote an exact-input swap via the Factory quoter. 'OCT' = native (mapped to WOCT for pools).
      case 'swapQuote': {
        const cfg = await chrome.storage.local.get(['fw_factory', 'fw_woct', 'fw_router', 'fw_quoter'])
        const factory = (cfg.fw_factory as string) || FACTORY_ADDR
        const woct = (cfg.fw_woct as string) || WOCT_ADDR
        const router = (cfg.fw_router as string) || ROUTER_ADDR
        const quoter = (cfg.fw_quoter as string) || QUOTER_ADDR
        const inAddr = msg.tokenIn === 'OCT' ? woct : msg.tokenIn
        const outAddr = msg.tokenOut === 'OCT' ? woct : msg.tokenOut
        if (inAddr === outAddr) throw new Error('same token')
        const amountIn = String(msg.amountInMicro)
        if (!(Number(amountIn) > 0)) return { found: false }
        const pool = bestPoolForPair(await fetchPools(this.rpc, factory), inAddr, outAddr, router)
        if (!pool) return { found: false }
        const q = await this.rpc.viewTuple(quoter, 'quote_exact_input_single', [inAddr, outAddr, String(pool.fee), amountIn, '0']).catch(() => [] as string[])
        if (!q.length || !(Number(q[0]) > 0)) return { found: false }
        return { found: true, amountOutMicro: q[0], fee: pool.fee, pool: pool.address, priceImpactBps: Number(q[2]) || 0 }
      }

      // Execute an exact-input swap as ONE atomic multi_exec (approve + swap can't be stranded):
      // (wrap native →) grant the spender → router.exact_input_single (or swaphelper.swap_to_native
      // for native out). Same batch the Factory web app submits. Returns the multi_exec tx hash.
      case 'swap': {
        const kp = this.requireUnlocked().keypair(msg.address)
        const cfg = await chrome.storage.local.get(['fw_woct', 'fw_router', 'fw_swaphelper'])
        const woct = (cfg.fw_woct as string) || WOCT_ADDR
        const router = (cfg.fw_router as string) || ROUTER_ADDR
        const swaphelper = (cfg.fw_swaphelper as string) || SWAPHELPER_ADDR
        const nativeIn = msg.tokenIn === 'OCT', nativeOut = msg.tokenOut === 'OCT'
        const inAddr = requireAddress(nativeIn ? woct : msg.tokenIn)
        const outAddr = requireAddress(nativeOut ? woct : msg.tokenOut)
        if (inAddr === outAddr) throw new Error('same token')
        const fee = Number(msg.fee)
        if (!(fee > 0)) throw new Error('invalid fee tier')
        const amountIn = String(msg.amountInMicro), minOut = String(msg.minOutMicro)
        if (!(Number(amountIn) > 0)) throw new Error('invalid amount')
        const deadline = Math.floor(Date.now() / 1000) + 300
        const recRaw = await this.rpc.call<{ recommended?: string; base_fee?: string }>('octra_recommendedFee', ['contract_call']).catch(() => null)
        const ou = String(Math.max(Number(recRaw?.recommended ?? recRaw?.base_fee ?? 0) || 0, 5000))
        const calls: MultiCall[] = []
        if (nativeIn) calls.push({ to: woct, method: 'deposit', params: [], value: BigInt(amountIn) })
        if (nativeOut) {
          calls.push({ to: inAddr, method: 'grant', params: [swaphelper, amountIn] })
          calls.push({ to: swaphelper, method: 'swap_to_native', params: [inAddr, fee, msg.address, deadline, amountIn, minOut] })
        } else {
          calls.push({ to: inAddr, method: 'grant', params: [router, amountIn] })
          calls.push({ to: router, method: 'exact_input_single', params: [inAddr, outAddr, fee, msg.address, deadline, amountIn, minOut, '0'] })
        }
        const res = await this.signTx(msg.address, (nonce) =>
          buildSignedMultiExec({ from: msg.address, nonce, timestamp: nowTimestamp(), ou, calls }, kp))
        // Nudge the Factory swap indexer to scan this wallet so the swap shows in the web app history
        // (a multi_exec tx has to_="multi_exec", only findable via the sender's address).
        const idx = (await chrome.storage.local.get('fw_indexer'))['fw_indexer'] as string || DEFAULT_INDEXER
        fetch(`${idx}/sync?wallet=${encodeURIComponent(msg.address)}`).catch(() => { /* best-effort */ })
        return res
      }

      case 'prices': {
        // OCT value of 1 unit of each token that has a WOCT pool (deepest valid pool wins).
        const cfg = await chrome.storage.local.get(['fw_factory', 'fw_woct', 'fw_router'])
        const factory = (cfg.fw_factory as string) || FACTORY_ADDR
        const woct = (cfg.fw_woct as string) || WOCT_ADDR
        const router = (cfg.fw_router as string) || ROUTER_ADDR
        const pools = await fetchPools(this.rpc, factory)
        const best: Record<string, PoolMeta> = {}
        for (const p of pools) {
          const tok = p.token0 === woct ? p.token1 : p.token1 === woct ? p.token0 : null
          if (!tok || p.liquidity <= 0) continue
          if (router && p.router && p.router !== router) continue
          if (!best[tok] || p.liquidity > best[tok].liquidity) best[tok] = p
        }
        const out: Record<string, number> = {}
        for (const tok of Object.keys(best)) { const v = tokenOctPrice(best[tok], woct); if (v > 0) out[tok] = v }
        return out
      }

      case 'priceSeries': {
        const token = msg.token as string
        if (!token) return []
        const cfg = await chrome.storage.local.get(['fw_factory', 'fw_woct', 'fw_router', 'fw_indexer'])
        const factory = (cfg.fw_factory as string) || FACTORY_ADDR
        const woct = (cfg.fw_woct as string) || WOCT_ADDR
        const router = (cfg.fw_router as string) || ROUTER_ADDR
        const indexer = (cfg.fw_indexer as string) || DEFAULT_INDEXER
        const pools = await fetchPools(this.rpc, factory)
        const cands = pools.filter(p => {
          const tok = p.token0 === woct ? p.token1 : p.token1 === woct ? p.token0 : null
          if (tok !== token) return false
          if (router && p.router && p.router !== router) return false
          return true
        })
        if (!cands.length) return []
        let bestRows: { sqrtPrice: string }[] = [], bestPool: PoolMeta | null = null
        for (const p of cands) {
          let rows: { sqrtPrice: string }[] = []
          try { const r = await fetch(`${indexer}?priceseries=1&pool=${p.address}`); if (r.ok) rows = await r.json() } catch { /* */ }
          if (Array.isArray(rows) && rows.length > bestRows.length) { bestRows = rows; bestPool = p }
        }
        if (!bestPool) return []
        const t0IsWoct = bestPool.token0 === woct
        const series: number[] = []
        for (const row of bestRows) {
          const s = BigInt(row.sqrtPrice || '0')
          if (s === 0n) continue
          const price = Number((s * s * (10n ** 6n)) / (Q96 * Q96)) / 1e6
          if (!(price > 0) || price < 1e-15 || price > 1e15) continue
          series.push(t0IsWoct ? 1 / price : price)
        }
        return series
      }

      case 'octChart': {
        const j = await fetchJson('https://api.coingecko.com/api/v3/coins/octra/market_chart?vs_currency=usd&days=7')
        const prices: number[] = (j?.prices ?? []).map((p: [number, number]) => p[1])
        if (prices.length) {
          const step = Math.max(1, Math.floor(prices.length / 40))
          const ds = prices.filter((_, i) => i % step === 0)
          await chrome.storage.local.set({ fw_chart: ds })
          return ds
        }
        return (await chrome.storage.local.get('fw_chart')).fw_chart ?? []
      }

      case 'getSelected':
        return { address: (await chrome.storage.local.get('fw_sel')).fw_sel ?? null }
      case 'setSelected':
        await chrome.storage.local.set({ fw_sel: msg.address })
        return { ok: true }

      case 'getAutoLock': {
        const r = await chrome.storage.local.get('fw_autolock_min')
        return { minutes: Number(r.fw_autolock_min ?? 15) }
      }
      case 'setAutoLock':
        await chrome.storage.local.set({ fw_autolock_min: msg.minutes })
        return { minutes: msg.minutes }

      case 'getNetwork':
        return { url: this.rpc.url, networks: NETWORKS }

      case 'setNetwork':
        this.rpc.url = msg.url
        await chrome.storage.local.set({ [RPC_KEY]: msg.url })
        return { url: msg.url }

      case 'renameAccount': {
        const kr = this.requireUnlocked()
        kr.rename(msg.address, msg.label)
        await this.saveVault()
        return kr.list()
      }

      case 'changePassword': {
        const vault = await this.loadVault(); if (!vault) throw new Error('no wallet')
        assertPasswordPolicy(msg.newPassword)
        const oldKey = await deriveVaultKey(msg.oldPassword, base64ToBytes(vault.salt), vaultMeta(vault))
        this.keyring = Keyring.deserialize(await decryptWithKey(vault, oldKey))   // throws 'wrong password'
        await this.setUnlocked(msg.newPassword, crypto.getRandomValues(new Uint8Array(32)), defaultKdfMeta())
        await this.saveVault()
        return { ok: true }
      }

      case 'exportPrivateKey': {
        const vault = await this.loadVault(); if (!vault) throw new Error('no wallet')
        const key = await deriveVaultKey(msg.password, base64ToBytes(vault.salt), vaultMeta(vault))
        await decryptWithKey(vault, key)   // verify password (throws if wrong)
        const kp = this.requireUnlocked().keypair(msg.address)
        return { hex: bytesToHex(kp.privateKey), base64: bytesToBase64(kp.privateKey) }
      }

      case 'reset': {
        this.keyring = null; this.vkey = null; this.vsalt = null
        await chrome.storage.local.clear()
        try { await chrome.storage.session.clear() } catch { /* */ }
        return { ok: true }
      }

      case 'send': {
        const kp = this.requireUnlocked().keypair(msg.address)
        const to = requireAddress(msg.to)
        return this.signTx(msg.address, (nonce) =>
          buildSignedTransfer({ from: msg.address, to, amount: toMicro(msg.oct), nonce, timestamp: nowTimestamp() }, kp))
      }

      case 'sendToken': {
        const kp = this.requireUnlocked().keypair(msg.address)
        const token = requireAddress(msg.token)
        const to = requireAddress(msg.to)
        // OCS-01 transfer(to: address, amount: int) — amount in raw base units (micro)
        return this.signTx(msg.address, (nonce) =>
          buildSignedCall({ contract: token, method: 'transfer', params: [to, Number(msg.amountMicro)], from: msg.address, nonce, timestamp: nowTimestamp() }, kp))
      }

      case 'call': {
        const kp = this.requireUnlocked().keypair(msg.address)
        const contract = requireAddress(msg.contract)
        const value = msg.valueOct ? toMicro(msg.valueOct) : undefined
        return this.signTx(msg.address, (nonce) =>
          buildSignedCall({ contract, method: msg.method, params: msg.params, value, from: msg.address, nonce, timestamp: nowTimestamp() }, kp))
      }

      case 'multiExec': {
        const kp = this.requireUnlocked().keypair(msg.address)
        for (const c of msg.calls) requireAddress(c.to)
        return this.signTx(msg.address, (nonce) =>
          buildSignedMultiExec({ from: msg.address, nonce, timestamp: nowTimestamp(), ou: msg.ou, calls: msg.calls }, kp))
      }

      // Sign an arbitrary message (dapp auth / login / nft-gated content). Raw ed25519
      // over the UTF-8 bytes, returned base64 — matches what an on-chain pubkey verifies
      // (the standard Octra signMessage; e.g. Xpectrum's key-server checks exactly this).
      case 'signMessage': {
        const kp = this.requireUnlocked().keypair(msg.address)
        const sig = sign(new TextEncoder().encode(String(msg.message)), kp.privateKey)
        return bytesToBase64(sig)
      }

      // shield (encrypt) / unshield (decrypt) — the pvac payload is built in the popup and
      // passed in as encryptedData; this just signs and submits.
      case 'encryptOp': {
        const kp = this.requireUnlocked().keypair(msg.address)
        return this.signTx(msg.address, (nonce) =>
          buildSignedEncrypt({
            from: msg.address, amount: BigInt(msg.amountMicro), encryptedData: msg.encryptedData,
            opType: msg.opType, ou: msg.ou, nonce, timestamp: nowTimestamp(),
          }, kp))
      }

      case 'deploy': {
        const kp = this.requireUnlocked().keypair(msg.address)
        if (!msg.bytecode) throw new Error('deploy: missing bytecode')
        return this.signDeploy(msg.address, msg.bytecode, msg.params ?? [], msg.ou, kp)
      }

      default:
        throw new Error('unknown message')
    }
  }
}

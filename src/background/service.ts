// Background wallet service. Holds the decrypted keyring and a derived AES key only while
// unlocked; persists just the encrypted vault to chrome.storage.local. The popup/provider
// talk to it via runtime messages.

import { Keyring } from '../core/keyring'
import { deriveVaultKey, encryptWithKey, decryptWithKey, importVaultKey, exportVaultKey, defaultKdfMeta, vaultMeta, type Vault, type KdfMeta } from '../core/vault'
import { OctraRpc } from '../core/rpc'
import { buildSignedTransfer, toMicro, nowTimestamp } from '../core/tx'
import { buildSignedCall, buildSignedMultiExec, buildSignedEncrypt, type MultiCall } from '../core/contract'
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
  { symbol: 'FACT', address: 'octG3mZ3ZwNAe3LYyhg23x3qSoVRewD9V8MGeZbmj7ZKuLP' },
]

function requireAddress(a: string): string {
  if (!isValidAddress(a)) throw new Error('invalid address: ' + a)
  return a
}

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
  | { type: 'encryptOp'; address: string; amountMicro: string; encryptedData: string; opType: 'encrypt' | 'decrypt'; ou?: string }
  | { type: 'send'; address: string; to: string; oct: number }
  | { type: 'sendToken'; address: string; token: string; to: string; amountMicro: string }
  | { type: 'call'; address: string; contract: string; method: string; params: (string | number)[]; valueOct?: number }
  | { type: 'multiExec'; address: string; calls: MultiCall[] }

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

  /** Serialize a signing op and assign a non-colliding nonce. */
  private async signTx(address: string, build: (nonce: number) => { body: Record<string, unknown> }): Promise<{ hash: string }> {
    const run = async () => {
      const acct = await this.rpc.account(address)
      const nonce = Math.max(acct.nonce + 1, (this.pendingNonce[address] ?? 0) + 1)
      const { body } = build(nonce)
      const hash = await this.rpc.sendRawTransaction(body)
      this.pendingNonce[address] = nonce
      return { hash }
    }
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

      case 'tokens': {
        const list = await this.loadTokens()
        const acct = await this.rpc.account(msg.address).catch(() => null)
        const out: { symbol: string; balance: string; native: boolean; address: string }[] =
          [{ symbol: 'OCT', balance: acct?.balance ?? '0', native: true, address: '' }]
        await Promise.all(list.map(async t => {
          const raw = await this.rpc.view<string>(t.address, 'balance_of', [msg.address]).catch(() => '0')
          out.push({ symbol: t.symbol, balance: (Number(raw) / 1e6).toString(), native: false, address: t.address })
        }))
        return out
      }

      case 'lpPositions': {
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
        const j = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=octra&vs_currencies=usd&include_24hr_change=true')
        if (j?.octra) {
          const out = { usd: j.octra.usd ?? 0, change24h: j.octra.usd_24h_change ?? 0 }
          await chrome.storage.local.set({ fw_price: out })
          return out
        }
        return (await chrome.storage.local.get('fw_price')).fw_price ?? { usd: 0, change24h: 0 }
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
          buildSignedMultiExec({ from: msg.address, nonce, timestamp: nowTimestamp(), calls: msg.calls }, kp))
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

      default:
        throw new Error('unknown message')
    }
  }
}

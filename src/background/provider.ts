// Dapp provider controller (background side). Handles window.octra requests relayed by the
// content script: per-origin connect permission, validated requests, and approval-gated
// signing. Execution is delegated to the WalletService; secrets stay in the background.

import type { WalletService } from './service'
import { isValidAddress } from '../core/address'

const PERM_KEY = 'fw_permissions'
/* Отдельное разрешение — видеть скрытый остаток. Держим врозь от разрешения на
   подключение: подключиться и подсмотреть скрытое — разные вещи, и второе
   человек должен разрешить отдельно. */
const PRIV_KEY = 'fw_private_view'

interface Pending {
  sendResponse: (r: { ok: boolean; res?: unknown; error?: string }) => void
  kind: 'connect' | 'tx' | 'sign' | 'privbal' | 'fheprove' | 'fhedecrypt' | 'fhedeposit' | 'stealthsend' | 'stealthscan' | 'stealthviewpub'
  origin: string
  data: any
}

const isFiniteNonNeg = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
const isMicro = (v: unknown) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0) || (typeof v === 'string' && /^\d+$/.test(v))

// Validate and reject a malformed dapp tx request before showing an approval, so the user
// never approves something the signer would interpret differently.
function validateTxRequest(d: any): void {
  if (!d || typeof d !== 'object') throw new Error('invalid request')
  if (d.kind === 'transfer') {
    if (!isValidAddress(d.to)) throw new Error('invalid recipient address')
    if (!(isFiniteNonNeg(d.oct) && d.oct > 0)) throw new Error('invalid amount')
  } else if (d.kind === 'call') {
    if (!isValidAddress(d.contract)) throw new Error('invalid contract address')
    if (!Array.isArray(d.params)) throw new Error('params must be an array')
    if (!isFiniteNonNeg(d.valueOct ?? 0)) throw new Error('invalid value')
  } else if (d.kind === 'multiExec') {
    if (!Array.isArray(d.calls) || d.calls.length === 0 || d.calls.length > 8) throw new Error('multiExec: 1..8 calls')
    for (const c of d.calls) {
      if (!c || !isValidAddress(c.to)) throw new Error('invalid sub-call target')
      if (!Array.isArray(c.params)) throw new Error('sub-call params must be an array')
      if (!isMicro(c.value)) throw new Error('invalid sub-call value (micro-OCT integer)')
    }
  } else if (d.kind === 'deploy') {
    if (typeof d.bytecode !== 'string' || d.bytecode.length === 0) throw new Error('deploy: missing bytecode')
    if (d.params !== undefined && !Array.isArray(d.params)) throw new Error('deploy: params must be an array')
  } else {
    throw new Error('unknown tx kind')
  }
}

export class ProviderController {
  private perms: Record<string, string> = {}   // origin -> granted address
  private privView: Record<string, true> = {}  // origin -> вправе видеть скрытый остаток
  private pending = new Map<string, Pending>()
  private ready: Promise<void>
  private approvalWindowId: number | null = null
  private lastPing = 0

  constructor(private wallet: WalletService) {
    // Gate handling on the permission store being loaded (a request before load would
    // otherwise see empty perms).
    this.ready = chrome.storage.local.get([PERM_KEY, PRIV_KEY]).then(r => {
      this.perms = (r[PERM_KEY] as Record<string, string>) ?? {}
      this.privView = (r[PRIV_KEY] as Record<string, true>) ?? {}
    })
    try { chrome.windows?.onRemoved?.addListener(id => { if (id === this.approvalWindowId) this.approvalWindowId = null }) } catch { /* */ }
  }

  /** The popup pings while open; this lets us tell whether one is alive to render a request. */
  ping() { this.lastPing = Date.now() }
  private persist() { return chrome.storage.local.set({ [PERM_KEY]: this.perms, [PRIV_KEY]: this.privView }) }

  async handle(origin: string, msg: { method: string; params: any[] }, sendResponse: Pending['sendResponse']) {
    await this.ready
    try {
      // never trust an opaque/unknown origin (sandboxed frame, file://, missing).
      if (!origin || origin === 'unknown' || origin === 'null') {
        return sendResponse({ ok: false, error: 'requests from this origin are not allowed' })
      }
      const w = (m: any) => this.wallet.handle(m)
      switch (msg.method) {
        case 'octra_getNetwork':
          return sendResponse({ ok: true, res: 'octra-devnet' })
        case 'octra_accounts':
          return sendResponse({ ok: true, res: this.perms[origin] ? [this.perms[origin]] : [] })
        case 'octra_disconnect': {
          // revoke this origin's grant so a later requestAccounts re-prompts (lets the user
          // pick a different account instead of silently reconnecting the cached one)
          delete this.perms[origin]
          delete this.privView[origin]
          await this.persist()
          return sendResponse({ ok: true, res: true })
        }
        case 'octra_getBalance':
          if (!isValidAddress(msg.params?.[0])) return sendResponse({ ok: false, error: 'invalid address' })
          return sendResponse({ ok: true, res: await w({ type: 'balance', address: msg.params[0] }) })
        case 'octra_privateBalance': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          /* Скрытый остаток на то и скрытый: в цепи он лежит зашифрованным, и
             прочесть его может только владелец ключа. Раньше он отдавался любому
             подключённому месту молча — то есть подключение к сайту тихо
             раскрывало ровно то, что человек прятал. Рядом стоит octra_fheDecrypt,
             и он спрашивает согласия за то же самое.

             Спрашиваем один раз на место: дальше оно помнится, иначе окно
             всплывало бы при каждом открытии страницы. Снимается вместе с
             отключением места. */
          if (this.privView[origin]) {
            return sendResponse({ ok: true, res: await w({ type: 'privateBalanceCached', address: addr }) })
          }
          return this.open(origin, 'privbal', { address: addr }, sendResponse)
        }
        case 'octra_requestAccounts': {
          if (this.perms[origin]) return sendResponse({ ok: true, res: [this.perms[origin]] })
          const status = await w({ type: 'status' }) as { hasVault: boolean; unlocked: boolean }
          if (!status.hasVault) return sendResponse({ ok: false, error: 'no wallet set up in factory wallet' })
          // if locked, still queue the connect and open the popup: the user unlocks there and the
          // pending request is shown right after, so connecting is one flow with no error.
          return this.open(origin, 'connect', {}, sendResponse)
        }
        case 'octra_signMessage': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          const message = msg.params?.[0]
          if (typeof message !== 'string' || message.length === 0) return sendResponse({ ok: false, error: 'message must be a non-empty string' })
          if (message.length > 4096) return sendResponse({ ok: false, error: 'message too long' })
          // Gate behind an approval popup: signing proves account control and could be
          // phished, so the user must see the message and consent (like personal_sign).
          return this.open(origin, 'sign', { message, address: addr }, sendResponse)
        }
        case 'octra_signAndSend': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          try { validateTxRequest(msg.params?.[0]) } catch (e) { return sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }) }
          // Do NOT reject when locked. Open the approval popup: App.tsx shows the unlock
          // screen first, then renders this pending request right after the user enters their
          // password. So clicking swap/add-liquidity/collect on a locked wallet prompts for
          // the password instead of erroring with "wallet locked".
          return this.open(origin, 'tx', { ...msg.params[0], address: addr }, sendResponse)
        }
        case 'octra_fheProve': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          const values = msg.params?.[0]
          if (!Array.isArray(values) || values.length === 0 || values.length > 8) return sendResponse({ ok: false, error: 'fheProve: expected an array of 1..8 values' })
          for (const v of values) { if (!/^\d{1,20}$/.test(String(v))) return sendResponse({ ok: false, error: 'fheProve: values must be non-negative integers' }) }
          // optional explicit blindings (base64, one per value) so a sender can reuse the same blinding
          // a recipient needs to claim a stealth note. Omitted -> random blinding (normal proofs).
          const blindings = Array.isArray(msg.params?.[1]) ? msg.params[1].map(String) : undefined
          // Gate behind an approval popup: proving uses the account's FHE key, so the user must
          // consent and see the amounts (like signMessage). The key never leaves the wallet — the
          // popup builds the proof and only the ciphertext + proof (which reveal nothing) return.
          return this.open(origin, 'fheprove', { address: addr, values: values.map(String), blindings }, sendResponse)
        }
        case 'octra_fheDecrypt': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          const cipher = msg.params?.[0]
          if (typeof cipher !== 'string' || cipher.length === 0 || cipher.length > 8_000_000) return sendResponse({ ok: false, error: 'fheDecrypt: expected a ciphertext string' })
          // Gate behind an approval popup: decrypting reveals the account's own private amount and
          // uses its FHE key, so the user must consent (like signMessage). The key never leaves the
          // wallet — the popup decrypts and only the resulting number is returned to the page. A
          // cipher not under this account's key decrypts to garbage, so nothing else can leak.
          return this.open(origin, 'fhedecrypt', { address: addr, cipher }, sendResponse)
        }
        case 'octra_fheDeposit': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          const items = msg.params?.[0]
          if (!Array.isArray(items) || items.length === 0 || items.length > 4) return sendResponse({ ok: false, error: 'fheDeposit: expected 1..4 items' })
          for (const it of items) {
            if (!it || typeof it.cipher !== 'string' || it.cipher.length === 0 || it.cipher.length > 8_000_000) return sendResponse({ ok: false, error: 'fheDeposit: each item needs a balance cipher' })
            if (!/^\d{1,20}$/.test(String(it.amount))) return sendResponse({ ok: false, error: 'fheDeposit: amount must be a non-negative integer' })
          }
          // Gate behind an approval popup: this spends the account's shielded balance and uses its
          // FHE key, so the user must consent. The key never leaves the wallet — the popup builds
          // the ciphertext + solvency proofs and only those (which reveal no amount) are returned.
          const amtBlindings = Array.isArray(msg.params?.[1]) ? msg.params[1].map(String) : undefined
          return this.open(origin, 'fhedeposit', { address: addr, items: items.map((it: any) => ({ cipher: it.cipher, amount: String(it.amount) })), amtBlindings }, sendResponse)
        }
        case 'octra_stealthViewPub': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          return this.open(origin, 'stealthviewpub', { address: addr }, sendResponse)
        }
        case 'octra_stealthSend': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          const recipientPub = msg.params?.[0], tokenCipher = msg.params?.[1], amount = msg.params?.[2]
          if (typeof recipientPub !== 'string' || !recipientPub) return sendResponse({ ok: false, error: 'stealthSend: missing recipient public key' })
          if (typeof tokenCipher !== 'string' || !tokenCipher) return sendResponse({ ok: false, error: 'stealthSend: missing token cipher' })
          if (!/^\d{1,20}$/.test(String(amount))) return sendResponse({ ok: false, error: 'stealthSend: bad amount' })
          return this.open(origin, 'stealthsend', { address: addr, recipientPub, tokenCipher, amount: String(amount) }, sendResponse)
        }
        case 'octra_stealthScan': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          const notes = msg.params?.[0]
          if (!Array.isArray(notes)) return sendResponse({ ok: false, error: 'stealthScan: expected an array of notes' })
          return this.open(origin, 'stealthscan', { address: addr, notes }, sendResponse)
        }
        default:
          return sendResponse({ ok: false, error: 'unsupported method: ' + msg.method })
      }
    } catch (e) { sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }) }
  }

  private open(origin: string, kind: Pending['kind'], data: any, sendResponse: Pending['sendResponse']) {
    /* Не больше одного ожидающего запроса на место, иначе сайт завалит окнами.
       Исключение — просьба показать скрытый остаток: её страница шлёт сама при
       открытии, человек её не ждёт и нажимать не идёт. Провисев, она заперла бы
       место, и настоящее действие — обмен, вклад — отвергалось бы со словами
       «уже есть ожидающий запрос». Поэтому она не запирает и уступает: пришло
       настоящее дело — её снимаем. */
    for (const [id, p] of this.pending) {
      if (p.origin !== origin) continue
      if (p.kind === 'privbal' && kind !== 'privbal') {
        this.pending.delete(id)
        p.sendResponse({ ok: true, res: { value: null } })
        continue
      }
      if (kind === 'privbal') return sendResponse({ ok: true, res: { value: null } })
      return sendResponse({ ok: false, error: 'a request is already pending for this origin' })
    }
    // crypto.randomUUID so approval IDs are never reused across service-worker lifecycles.
    const id = 'apr_' + crypto.randomUUID()
    this.pending.set(id, { sendResponse, kind, origin, data })
    this.surface()
  }

  // Surface a pending request. Try the toolbar popup first (it opens on the first tx of a
  // sequence, which rides a user gesture). If no popup heartbeat lands shortly after, a follow-up
  // request (e.g. the second hop of a multi-hop swap) would otherwise sit behind only a badge, so
  // open a dedicated window instead.
  private surface() {
    this.updateBadge()
    // Open the toolbar popup when a browser window is focused (it rides the user gesture from a
    // dapp action). We deliberately do NOT open a separate popup WINDOW as a fallback: that
    // raced the cold service worker and popped a spurious unlock/PASSWORD window even though the
    // wallet was unlocked AND the request was already reachable from the toolbar. The toolbar
    // badge is the signal — the user clicks the extension icon and the pending approval renders
    // in the toolbar popup.
    try { (chrome.action as any)?.openPopup?.()?.catch?.(() => { /* */ }) } catch { /* */ }
  }

  private async openApprovalWindow() {
    if (this.approvalWindowId != null) {
      try { await chrome.windows.update(this.approvalWindowId, { focused: true, drawAttention: true }); return } catch { this.approvalWindowId = null }
    }
    try {
      const w = await chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 400, height: 600, focused: true })
      this.approvalWindowId = w?.id ?? null
    } catch { /* badge remains as the last resort */ }
  }

  private updateBadge() {
    try {
      const n = this.pending.size
      chrome.action?.setBadgeText?.({ text: n ? String(n) : '' })
      chrome.action?.setBadgeBackgroundColor?.({ color: '#3b567f' })
    } catch { /* action API unavailable */ }
  }

  getApproval(id: string) {
    const p = this.pending.get(id)
    return p ? { kind: p.kind, origin: p.origin, data: p.data } : null
  }

  /** The oldest pending request, for the popup to render in-line (instead of a popup window). */
  firstPending() {
    for (const [id, p] of this.pending) return { id, kind: p.kind, origin: p.origin, data: p.data }
    return null
  }

  /** Connected dapps (origin -> granted account), for the popup's "connected" screen. */
  async getSites() {
    await this.ready
    return Object.entries(this.perms).map(([origin, address]) => ({ origin, address }))
  }

  /** Revoke a dapp's connection. */
  async revoke(origin: string) {
    await this.ready
    delete this.perms[origin]
    delete this.privView[origin]
    await this.persist()
  }

  async resolveApproval(id: string, approved: boolean, address?: string) {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    this.updateBadge()
    if (this.pending.size === 0 && this.approvalWindowId != null) {
      const wid = this.approvalWindowId; this.approvalWindowId = null
      chrome.windows.remove(wid).catch(() => { /* */ })
    }
    if (!approved) return p.sendResponse({ ok: false, error: 'user rejected request' })
    try {
      if (p.kind === 'connect') {
        const accts = await this.wallet.handle({ type: 'accounts' } as any) as { address: string }[]
        // honour the account the user picked in the connect screen (if it's a real account)
        const addr = (address && accts.some(a => a.address === address)) ? address : accts[0]!.address
        this.perms[p.origin] = addr
        await this.persist()
        return p.sendResponse({ ok: true, res: [addr] })
      }
      if (p.kind === 'sign') {
        return p.sendResponse({ ok: true, res: await this.wallet.handle({ type: 'signMessage', address: p.data.address, message: p.data.message } as any) })
      }
      if (p.kind === 'privbal') {
        this.privView[p.origin] = true
        await this.persist()
        return p.sendResponse({ ok: true, res: await this.wallet.handle({ type: 'privateBalanceCached', address: p.data.address } as any) })
      }
      if (p.kind === 'fheprove' || p.kind === 'fhedecrypt' || p.kind === 'fhedeposit' || p.kind === 'stealthsend' || p.kind === 'stealthscan' || p.kind === 'stealthviewpub') return p.sendResponse({ ok: false, error: 'resolves via resolveFheProve' })
      const d = p.data
      const m = d.kind === 'transfer' ? { type: 'send', address: d.address, to: d.to, oct: d.oct }
        : d.kind === 'call' ? { type: 'call', address: d.address, contract: d.contract, method: d.method, params: d.params, valueOct: d.valueOct }
        : d.kind === 'multiExec' ? { type: 'multiExec', address: d.address, calls: d.calls, ou: d.ou }
        : d.kind === 'deploy' ? { type: 'deploy', address: d.address, bytecode: d.bytecode, params: d.params, ou: d.ou }
        : null
      if (!m) throw new Error('unknown tx kind')
      return p.sendResponse({ ok: true, res: await this.wallet.handle(m as any) })
    } catch (e) {
      p.sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Resolve an fheprove approval. The popup builds the proof (pvac wasm lives there) and passes
   * the finished result here; the seed/key never touches the background or the site — only the
   * proof (which reveals nothing about the value or key) is sent back to the requesting page. */
  async resolveFheProve(id: string, approved: boolean, result?: any) {
    const p = this.pending.get(id)
    if (!p || (p.kind !== 'fheprove' && p.kind !== 'fhedecrypt' && p.kind !== 'fhedeposit' && p.kind !== 'stealthsend' && p.kind !== 'stealthscan' && p.kind !== 'stealthviewpub')) return
    this.pending.delete(id)
    this.updateBadge()
    if (this.pending.size === 0 && this.approvalWindowId != null) {
      const wid = this.approvalWindowId; this.approvalWindowId = null
      chrome.windows.remove(wid).catch(() => { /* */ })
    }
    if (!approved || !result) return p.sendResponse({ ok: false, error: 'user rejected request' })
    return p.sendResponse({ ok: true, res: result })
  }
}

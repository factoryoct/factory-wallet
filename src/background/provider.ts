// Dapp provider controller (background side). Handles window.octra requests relayed by the
// content script: per-origin connect permission, validated requests, and approval-gated
// signing. Execution is delegated to the WalletService; secrets stay in the background.

import type { WalletService } from './service'
import { isValidAddress } from '../core/address'

const PERM_KEY = 'fw_permissions'

interface Pending {
  sendResponse: (r: { ok: boolean; res?: unknown; error?: string }) => void
  kind: 'connect' | 'tx'
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
  } else {
    throw new Error('unknown tx kind')
  }
}

export class ProviderController {
  private perms: Record<string, string> = {}   // origin -> granted address
  private pending = new Map<string, Pending>()
  private ready: Promise<void>
  private approvalWindowId: number | null = null
  private lastPing = 0

  constructor(private wallet: WalletService) {
    // Gate handling on the permission store being loaded (a request before load would
    // otherwise see empty perms).
    this.ready = chrome.storage.local.get(PERM_KEY).then(r => { this.perms = (r[PERM_KEY] as Record<string, string>) ?? {} })
    try { chrome.windows?.onRemoved?.addListener(id => { if (id === this.approvalWindowId) this.approvalWindowId = null }) } catch { /* */ }
  }

  /** The popup pings while open; this lets us tell whether one is alive to render a request. */
  ping() { this.lastPing = Date.now() }
  private persist() { return chrome.storage.local.set({ [PERM_KEY]: this.perms }) }

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
          await this.persist()
          return sendResponse({ ok: true, res: true })
        }
        case 'octra_getBalance':
          if (!isValidAddress(msg.params?.[0])) return sendResponse({ ok: false, error: 'invalid address' })
          return sendResponse({ ok: true, res: await w({ type: 'balance', address: msg.params[0] }) })
        case 'octra_requestAccounts': {
          if (this.perms[origin]) return sendResponse({ ok: true, res: [this.perms[origin]] })
          const status = await w({ type: 'status' }) as { hasVault: boolean; unlocked: boolean }
          if (!status.hasVault) return sendResponse({ ok: false, error: 'no wallet set up in factory wallet' })
          // if locked, still queue the connect and open the popup: the user unlocks there and the
          // pending request is shown right after, so connecting is one flow with no error.
          return this.open(origin, 'connect', {}, sendResponse)
        }
        case 'octra_signAndSend': {
          const addr = this.perms[origin]
          if (!addr) return sendResponse({ ok: false, error: 'not connected' })
          const status = await w({ type: 'status' }) as { unlocked: boolean }
          if (!status.unlocked) return sendResponse({ ok: false, error: 'wallet locked' })
          try { validateTxRequest(msg.params?.[0]) } catch (e) { return sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }) }
          return this.open(origin, 'tx', { ...msg.params[0], address: addr }, sendResponse)
        }
        default:
          return sendResponse({ ok: false, error: 'unsupported method: ' + msg.method })
      }
    } catch (e) { sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }) }
  }

  private open(origin: string, kind: Pending['kind'], data: any, sendResponse: Pending['sendResponse']) {
    // at most one in-flight approval per origin, so a connected site can't spam popups.
    for (const p of this.pending.values()) {
      if (p.origin === origin) return sendResponse({ ok: false, error: 'a request is already pending for this origin' })
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
    try { (chrome.action as any)?.openPopup?.()?.catch?.(() => { /* */ }) } catch { /* */ }
    const t0 = Date.now()
    setTimeout(() => {
      if (this.pending.size === 0) return
      if (this.lastPing > t0) return   // a live popup heartbeat landed; it will render the request
      this.openApprovalWindow()
    }, 1000)
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
      const d = p.data
      const m = d.kind === 'transfer' ? { type: 'send', address: d.address, to: d.to, oct: d.oct }
        : d.kind === 'call' ? { type: 'call', address: d.address, contract: d.contract, method: d.method, params: d.params, valueOct: d.valueOct }
        : d.kind === 'multiExec' ? { type: 'multiExec', address: d.address, calls: d.calls }
        : null
      if (!m) throw new Error('unknown tx kind')
      return p.sendResponse({ ok: true, res: await this.wallet.handle(m as any) })
    } catch (e) {
      p.sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
}

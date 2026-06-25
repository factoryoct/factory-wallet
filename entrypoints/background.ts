import { WalletService } from '../src/background/service'
import { ProviderController } from '../src/background/provider'

// MV3 service worker. Routes three message channels onto one shared WalletService: the popup
// UI, the dapp provider (window.octra via the content script), and approval decisions.
const AUTOLOCK_ALARM = 'fw_autolock'

export default defineBackground(() => {
  const wallet = new WalletService()
  const provider = new ProviderController(wallet)

  // Auto-lock: extension-page activity re-arms an idle timer of the configured length
  // (default 15 minutes; 0 = never). On expiry the keyring and key are wiped.
  const armAutoLock = async () => {
    const r = await chrome.storage.local.get('fw_autolock_min')
    const min = Number(r.fw_autolock_min ?? 15)
    if (min > 0) chrome.alarms.create(AUTOLOCK_ALARM, { delayInMinutes: min })
    else chrome.alarms.clear(AUTOLOCK_ALARM)
  }
  chrome.alarms.onAlarm.addListener(a => { if (a.name === AUTOLOCK_ALARM) wallet.handle({ type: 'lock' } as any) })

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // dapp provider request (from a content script) — origin is browser-set, page-unforgeable
    if (msg && msg.__provider) {
      armAutoLock()   // using a connected dapp counts as activity — don't auto-lock mid-use
      const origin = sender.origin || (sender.url ? new URL(sender.url).origin : 'unknown')
      provider.handle(origin, { method: msg.method, params: msg.params ?? [] }, sendResponse)
      return true
    }
    // Everything below is an extension-page (popup) channel: the approval channel and the
    // privileged wallet API. Reject anything carrying a sender.tab (a content script / web
    // page) before handling it, so a connected page can't read or auto-approve its own
    // pending request and bypass user consent.
    if (sender.id !== chrome.runtime.id || sender.tab) {
      sendResponse({ ok: false, error: 'unauthorized' })
      return false
    }
    // popup asks if there's a pending dapp request to render in-line
    if (msg && msg.__approvalPending) {
      sendResponse({ ok: true, res: provider.firstPending() })
      return false
    }
    // approval reads a specific pending request by id
    if (msg && msg.__approvalGet) {
      sendResponse({ ok: true, res: provider.getApproval(msg.id) })
      return false
    }
    // popup reports the user's decision (address = the account chosen for a connect)
    if (msg && msg.__approvalResult) {
      provider.resolveApproval(msg.id, msg.approved, msg.address).then(() => sendResponse({ ok: true }))
      return true
    }
    // popup heartbeat: lets the provider know a popup is alive (so it need not open a window)
    if (msg && msg.__popupOpen) { provider.ping(); sendResponse({ ok: true }); return false }
    armAutoLock()   // only extension-page activity re-arms the idle lock
    // connected-sites management lives on the provider, not the wallet service
    if (msg.type === 'sites') { provider.getSites().then(res => sendResponse({ ok: true, res })); return true }
    if (msg.type === 'revoke') { provider.revoke(msg.origin).then(() => sendResponse({ ok: true })); return true }
    wallet.handle(msg)
      .then(res => sendResponse({ ok: true, res }))
      .catch(e => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    return true
  })
})

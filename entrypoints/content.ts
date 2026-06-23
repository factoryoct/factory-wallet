// Content-script bridge: injects the in-page provider, then relays request/response
// between the page (window.postMessage) and the background (runtime.sendMessage).
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  async main() {
    // Swallow the benign "Extension context invalidated" that the framework's content-script
    // machinery throws after the extension is reloaded or updated while this page is still open.
    // It is harmless and goes away once the page is refreshed; keep it out of the console.
    const invalidated = (m: unknown) => typeof m === 'string' && /extension context invalidated/i.test(m)
    window.addEventListener('error', e => { if (invalidated(e.message) || invalidated((e.error as Error)?.message)) { e.preventDefault(); e.stopImmediatePropagation() } }, true)
    window.addEventListener('unhandledrejection', e => { if (invalidated((e.reason as Error)?.message) || invalidated(String(e.reason))) e.preventDefault() })

    await injectScript('/inpage.js', { keepInDom: true })

    window.addEventListener('message', (e) => {
      const d = e.data
      if (e.source !== window || !d || d.target !== 'octra-cs' || typeof d.id !== 'number') return
      // If the extension was reloaded or updated, this page's context is stale until it reloads.
      // Reply with an error instead of throwing an uncaught "Extension context invalidated".
      if (!chrome.runtime?.id) {
        window.postMessage({ target: 'octra-inpage', id: d.id, result: undefined, error: 'wallet was reloaded, refresh the page' }, location.origin)
        return
      }
      try {
        chrome.runtime.sendMessage({ __provider: true, method: d.method, params: d.params }, (r) => {
          const err = chrome.runtime.lastError
          window.postMessage({
            target: 'octra-inpage',
            id: d.id,
            result: !err && r?.ok ? r.res : undefined,
            error: err ? err.message : (r?.ok ? undefined : (r?.error ?? 'error')),
          }, location.origin)
        })
      } catch {
        window.postMessage({ target: 'octra-inpage', id: d.id, result: undefined, error: 'wallet was reloaded, refresh the page' }, location.origin)
      }
    })
  },
})

// Content-script bridge: injects the in-page provider, then relays request/response
// between the page (window.postMessage) and the background (runtime.sendMessage).
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  async main() {
    await injectScript('/inpage.js', { keepInDom: true })

    window.addEventListener('message', (e) => {
      const d = e.data
      if (e.source !== window || !d || d.target !== 'octra-cs' || typeof d.id !== 'number') return
      chrome.runtime.sendMessage({ __provider: true, method: d.method, params: d.params }, (r) => {
        const err = chrome.runtime.lastError
        window.postMessage({
          target: 'octra-inpage',
          id: d.id,
          result: !err && r?.ok ? r.res : undefined,
          error: err ? err.message : (r?.ok ? undefined : (r?.error ?? 'error')),
        }, location.origin)
      })
    })
  },
})

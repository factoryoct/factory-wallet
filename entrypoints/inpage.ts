// The in-page provider: installs window.octra in the page's MAIN world. Pages call
// window.octra.request({method, params}); requests are bridged to the background via the
// content script and resolved by the wallet. Mirror of an EIP-1193 provider, Octra-flavored.
export default defineUnlistedScript(() => {
  let seq = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: any }>()

  window.addEventListener('message', (e) => {
    // only accept responses from this window/origin
    if (e.source !== window || e.origin !== location.origin) return
    const d = e.data
    if (!d || d.target !== 'octra-inpage' || typeof d.id !== 'number') return
    const p = pending.get(d.id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(d.id)
    d.error ? p.reject(new Error(d.error)) : p.resolve(d.result)
  })

  const request = (args: { method: string; params?: any[] }): Promise<any> => {
    const id = ++seq
    return new Promise((resolve, reject) => {
      // time out a lost response instead of hanging the promise forever
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error('octra: request timed out'))
      }, 180_000)
      pending.set(id, { resolve, reject, timer })
      window.postMessage({ target: 'octra-cs', id, method: args.method, params: args.params ?? [] }, location.origin)
    })
  }

  const provider = {
    isFactoryWallet: true,
    request,
    // convenience wrappers
    requestAccounts: () => request({ method: 'octra_requestAccounts' }),
    getAccounts: () => request({ method: 'octra_accounts' }),
    // revoke this site's connection so the next requestAccounts shows the approval popup again
    disconnect: () => request({ method: 'octra_disconnect' }),
    getBalance: (address: string) => request({ method: 'octra_getBalance', params: [address] }),
    // decrypted private (encrypted) balance for the connected account, from the wallet's cache
    privateBalance: () => request({ method: 'octra_privateBalance' }),
    sendTransfer: (to: string, oct: number) => request({ method: 'octra_signAndSend', params: [{ kind: 'transfer', to, oct }] }),
    call: (contract: string, method: string, params: (string | number)[], valueOct?: number) =>
      request({ method: 'octra_signAndSend', params: [{ kind: 'call', contract, method, params, valueOct }] }),
    multiExec: (calls: any[]) => request({ method: 'octra_signAndSend', params: [{ kind: 'multiExec', calls }] }),
    // Deploy a contract: sign+submit an op_type "deploy" tx in the extension. Returns
    // { hash, contractAddress }. bytecode = base64 (compile via RPC octra_compileAml first).
    deploy: (bytecode: string, params: (string | number)[], ou?: string) =>
      request({ method: 'octra_signAndSend', params: [{ kind: 'deploy', bytecode, params, ou }] }),
  }

  ;(window as any).octra = provider
  // discovery: let dapps know an Octra provider is present (own event, EIP-6963 is EVM-only)
  window.dispatchEvent(new CustomEvent('octra:announceProvider', { detail: { info: { name: 'factory wallet', rdns: 'xyz.factory.wallet' }, provider } }))
  window.dispatchEvent(new Event('octra#initialized'))
})

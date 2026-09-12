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
    // Sign an arbitrary message (dapp auth / login / nft-gated content). Returns the
    // ed25519 signature as base64 over the UTF-8 message; verify against the account's
    // on-chain public key (octra_publicKey). Opens an approval popup.
    signMessage: (message: string) => request({ method: 'octra_signMessage', params: [message] }),
    sendTransfer: (to: string, oct: number) => request({ method: 'octra_signAndSend', params: [{ kind: 'transfer', to, oct }] }),
    call: (contract: string, method: string, params: (string | number)[], valueOct?: number) =>
      request({ method: 'octra_signAndSend', params: [{ kind: 'call', contract, method, params, valueOct }] }),
    multiExec: (calls: any[], ou?: string) => request({ method: 'octra_signAndSend', params: [{ kind: 'multiExec', calls, ou }] }),
    // Deploy a contract: sign+submit an op_type "deploy" tx in the extension. Returns
    // { hash, contractAddress }. bytecode = base64 (compile via RPC octra_compileAml first).
    deploy: (bytecode: string, params: (string | number)[], ou?: string) =>
      request({ method: 'octra_signAndSend', params: [{ kind: 'deploy', bytecode, params, ou }] }),
    // Build confidential-AMM proofs for a list of non-negative integer amounts using the connected
    // account's FHE key. Opens an approval popup; returns [{cipher, proof, commit}] as raw base64,
    // ready to pass as contract-call params. The key never leaves the wallet — only proofs return.
    fheProve: (values: (string | number)[], blindings?: string[]) => request({ method: 'octra_fheProve', params: [values.map(String), blindings] }),
    // Decrypt one of the connected account's own confidential ciphertexts (e.g. a shielded token's
    // private_balance_of) so the owner can see the amount. Opens an approval popup; returns the
    // plaintext integer as a string. The key never leaves the wallet — only the number returns.
    fheDecrypt: (cipher: string) => request({ method: 'octra_fheDecrypt', params: [cipher] }),
    // Build confidential-deposit proofs: spend hidden amounts out of the connected account's shielded
    // token balances into a private pool. items = [{cipher: private_balance_of, amount: dx}]. Opens an
    // approval popup; returns [{cipher, amtProof, amtCommit, remProof, remCommit}] as raw base64 ready
    // to pass to the pool's add_liquidity. The key never leaves the wallet — only ciphertext + proofs.
    fheDeposit: (items: { cipher: string; amount: string | number }[], amtBlindings?: string[]) =>
      request({ method: 'octra_fheDeposit', params: [items.map(it => ({ cipher: it.cipher, amount: String(it.amount) })), amtBlindings] }),
    // Stealth (private-transfer) helpers for the confidential-stealth token.
    stealthViewPub: () => request({ method: 'octra_stealthViewPub', params: [] }),
    stealthSend: (recipientPub: string, tokenCipher: string, amount: string | number) =>
      request({ method: 'octra_stealthSend', params: [recipientPub, tokenCipher, String(amount)] }),
    stealthScan: (notes: { id: number; ephem: string; payload: string }[]) =>
      request({ method: 'octra_stealthScan', params: [notes] }),
  }

  ;(window as any).octra = provider
  // Also expose under a unique, collision-proof name. Other Octra wallets (0xio, etc.) may
  // overwrite window.octra, so a dapp that wants OUR provider specifically reads this one —
  // it is never clobbered by another extension.
  ;(window as any).factoryWallet = provider
  // discovery: let dapps know an Octra provider is present (own event, EIP-6963 is EVM-only)
  window.dispatchEvent(new CustomEvent('octra:announceProvider', { detail: { info: { name: 'factory wallet', rdns: 'xyz.factory.wallet' }, provider } }))
  window.dispatchEvent(new Event('octra#initialized'))
})

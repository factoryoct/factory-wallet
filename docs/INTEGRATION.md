# Integrate Factory Wallet

A guide for dApp developers who want their Octra app (NFT marketplace, DEX, game,
anything) to connect **Factory Wallet** and have users sign transactions.

Factory Wallet is a **browser extension**, non-custodial. It injects an
EIP-1193-style provider into every page. Keys never leave the extension; every
transaction is shown to the user in a popup and only signed after they approve.

If you have integrated MetaMask before, this will feel familiar. The only
differences: the global is `window.octra` (not `window.ethereum`), and the method
names are Octra-flavored.

---

## TL;DR

```js
// 1. get the provider (waits for injection)
const w = await getFactoryWallet()

// 2. connect (opens an approval popup)
const [address] = await w.requestAccounts()

// 3. call a contract (opens an approval popup, returns the tx hash)
const { hash } = await w.call(nftContract, 'buy', [tokenId], 1.5 /* OCT */)
```

---

## 1. Detect the wallet

The provider is exposed at two globals:

- `window.octra` — the shared Octra provider slot (another Octra wallet could
  also claim this; last one to load wins).
- `window.factoryWallet` — **always** Factory Wallet, never clobbered. Use this if
  you specifically want ours.

It may not be present the instant your script runs, so also listen for the
discovery event. Recommended helper:

```js
// Resolves to the Factory Wallet provider, or throws after a timeout.
function getFactoryWallet({ timeout = 3000 } = {}) {
  const pick = () => window.factoryWallet || (window.octra?.isFactoryWallet ? window.octra : null)
  return new Promise((resolve, reject) => {
    const now = pick()
    if (now) return resolve(now)
    let done = false
    const onAnnounce = (e) => {
      const p = e.detail?.provider
      if (p?.isFactoryWallet) { done = true; cleanup(); resolve(p) }
    }
    const t = setTimeout(() => { if (!done) { cleanup(); reject(new Error('Factory Wallet not found')) } }, timeout)
    function cleanup() { clearTimeout(t); window.removeEventListener('octra:announceProvider', onAnnounce) }
    window.addEventListener('octra:announceProvider', onAnnounce)
    // late-load fallback: the extension also fires this once it is ready
    window.addEventListener('octra#initialized', () => { const p = pick(); if (p && !done) { done = true; cleanup(); resolve(p) } }, { once: true })
  })
}
```

Events the extension dispatches on load:

| Event | Payload |
| --- | --- |
| `octra:announceProvider` (CustomEvent) | `detail = { info: { name: 'factory wallet', rdns: 'xyz.factory.wallet' }, provider }` |
| `octra#initialized` (Event) | none (signal that `window.octra` is installed) |

Identify our provider with `provider.isFactoryWallet === true`.

---

## 2. Connect

```js
const accounts = await w.requestAccounts()   // opens the approval popup
const address = accounts[0]                    // 'oct...' (47 chars)
```

- Opens the approval popup; the user picks an account and approves.
- Returns `string[]` (currently one address).
- **Idempotent**: if the site is already connected, it resolves immediately with
  no popup.
- If the user has no wallet set up, it rejects with `no wallet set up in factory wallet`.
- If the user declines, it rejects with `user rejected request`.

> Call `requestAccounts()` from a user gesture (a click handler). The approval UI
> opens in the toolbar popup, which rides the click.

Check the current connection without prompting:

```js
const accounts = await w.getAccounts()   // [] if not connected, [address] if connected
```

---

## 3. Read state (no popup)

```js
const { balance, nonce } = await w.getBalance(address)  // balance = OCT (decimal string)
const net = await w.request({ method: 'octra_getNetwork' })  // 'octra-devnet'
const priv = await w.privateBalance()  // { value: string | null } — decrypted private balance for the connected account
```

---

## 4. Send transactions

Every method below opens an approval popup and returns **after** the user signs.
The wallet signs and submits; you get back the tx hash (poll the RPC for the
receipt, see section 6).

### 4.1 Call a contract (the main one)

```js
const { hash } = await w.call(contract, method, params, valueOct)
```

| Arg | Type | Notes |
| --- | --- | --- |
| `contract` | `string` | contract address (`oct...`) |
| `method` | `string` | method name as defined in the contract |
| `params` | `(string \| number)[]` | must match the method signature (address as string, ints as number) |
| `valueOct` | `number` (optional) | native OCT to attach, **decimal OCT**, for payable methods |

Returns `{ hash: string }`.

```js
// NFT marketplace: buy token #42 for 1.5 OCT
const { hash } = await w.call('octNftMarket...', 'buy', [42], 1.5)
```

### 4.2 Native transfer

```js
const { hash } = await w.sendTransfer(to, oct)   // oct = decimal OCT
```

### 4.3 Atomic batch (multiExec, 1..8 calls)

All calls succeed or the whole tx reverts. Useful for approve+action in one signature.

```js
const { hash } = await w.multiExec([
  { to: 'octToken...',  method: 'grant',    params: ['octMarket...', 1000000], value: undefined },
  { to: 'octMarket...', method: 'buy',      params: [42],                       value: undefined },
])
```

Each call: `{ to: string, method: string, params: (string|number)[], value?: number|string }`.
`value` here is **micro-OCT** (integer; 1 OCT = 1_000_000), not decimal.

### 4.4 Deploy a contract

```js
// compile first via RPC, then deploy
const { hash, contractAddress } = await w.deploy(bytecodeBase64, params, ou)
```

`bytecodeBase64` comes from the RPC method `octra_compileAml` (returns base64).

---

## 5. Disconnect

```js
await w.disconnect()   // revokes this site's grant; next requestAccounts() re-prompts
```

---

## 6. Wait for a transaction to confirm

The provider returns a hash as soon as the tx is submitted. Poll the RPC for the
receipt:

```js
const RPC = 'https://devnet.octrascan.io/rpc'
async function waitForTx(hash, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500))
    const res = await fetch(RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_transaction', params: [hash] }),
    }).then(r => r.json())
    const tx = res.result
    if (!tx) continue
    if (tx.status === 'confirmed' || tx.success === true) return { ok: true, tx }
    if (tx.status === 'rejected' || tx.status === 'failed' || tx.status === 'dropped') return { ok: false, tx }
  }
  return { ok: false, error: 'timeout' }
}
```

---

## 7. Errors to handle

Every method rejects with an `Error`; check `err.message`:

| message | when |
| --- | --- |
| `user rejected request` | user declined the popup |
| `not connected` | you called a signing/private method before `requestAccounts()` |
| `no wallet set up in factory wallet` | user has no account yet |
| `a request is already pending for this origin` | you fired a second request while one popup is open |
| `octra: request timed out` | no response within 180s (user ignored the popup) |
| `invalid recipient address` / `invalid amount` / `params must be an array` / ... | request validation failed before approval |

Rule of thumb: one request at a time per site, driven by a user gesture.

---

## 8. Full minimal example

```html
<!doctype html>
<button id="connect">connect</button>
<button id="buy">buy #42</button>
<pre id="out"></pre>
<script type="module">
  const out = (m) => document.getElementById('out').textContent = m

  function getFactoryWallet({ timeout = 3000 } = {}) {
    const pick = () => window.factoryWallet || (window.octra?.isFactoryWallet ? window.octra : null)
    return new Promise((resolve, reject) => {
      const now = pick(); if (now) return resolve(now)
      const t = setTimeout(() => reject(new Error('Factory Wallet not found')), timeout)
      window.addEventListener('octra:announceProvider', (e) => {
        if (e.detail?.provider?.isFactoryWallet) { clearTimeout(t); resolve(e.detail.provider) }
      }, { once: true })
    })
  }

  let w, address
  document.getElementById('connect').onclick = async () => {
    try {
      w = await getFactoryWallet()
      ;[address] = await w.requestAccounts()
      const { balance } = await w.getBalance(address)
      out(`connected ${address}\nbalance ${balance} OCT`)
    } catch (e) { out('error: ' + e.message) }
  }

  document.getElementById('buy').onclick = async () => {
    try {
      const { hash } = await w.call('octNftMarket...', 'buy', [42], 1.5)
      out('submitted: ' + hash)
    } catch (e) { out('error: ' + e.message) }
  }
</script>
```

---

## 9. Method reference

All convenience methods are thin wrappers over `provider.request({ method, params })`.

| Method | Popup | Returns |
| --- | --- | --- |
| `requestAccounts()` | yes (first time) | `string[]` |
| `getAccounts()` | no | `string[]` |
| `getBalance(address)` | no | `{ balance: string, nonce: number }` |
| `privateBalance()` | no | `{ value: string \| null }` |
| `sendTransfer(to, oct)` | yes | `{ hash: string }` |
| `call(contract, method, params, valueOct?)` | yes | `{ hash: string }` |
| `multiExec(calls)` | yes | `{ hash: string }` |
| `deploy(bytecodeB64, params, ou?)` | yes | `{ hash, contractAddress }` |
| `disconnect()` | no | `true` |
| `request({ method, params })` | depends | raw result |

Raw RPC-style method names (for `request`): `octra_requestAccounts`, `octra_accounts`,
`octra_getBalance`, `octra_privateBalance`, `octra_getNetwork`, `octra_disconnect`,
`octra_signAndSend` (with `params: [{ kind: 'transfer' | 'call' | 'multiExec' | 'deploy', ... }]`).

---

## 10. Notes and gotchas

- **Amounts.** `sendTransfer` / `call(..., valueOct)` take **decimal OCT**.
  `multiExec` sub-call `value` is **micro-OCT integer** (1 OCT = 1_000_000).
- **Param types matter.** They are passed straight to the contract. Addresses are
  strings, integers are numbers; a wrong type will revert on chain.
- **Network.** Currently `octra-devnet`.
- **Not `window.ethereum`.** Do not reuse an EVM library; call the provider directly.
- **One popup at a time** per origin. Await each request before firing the next.
- **User gesture.** Trigger `requestAccounts()` and signing from a click so the
  toolbar popup can open.
- **This is a different model from webcli.** webcli (the local Octra signer) uses a
  popup-window + `postMessage` flow; Factory Wallet is an injected extension
  provider. If you support both, detect each separately.

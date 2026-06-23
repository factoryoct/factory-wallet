# factory wallet

A self custody browser extension wallet for the [octra](https://x.com/octra) blockchain.

Send OCT and OCS-01 tokens, swap and add liquidity on Factory, keep a private (encrypted) balance, and connect to Octra dapps through a `window.octra` provider. Private keys are generated and stored on your device, encrypted with your password. They never leave the background service worker and are never sent to a node.

Full documentation: https://factory-amm.xyz/docs#wallet-intro

## Features

- Self custody: keys are derived locally and encrypted at rest (scrypt + AES-GCM-256).
- Send OCT and OCS-01 tokens, with on-chain activity history.
- Swap and add liquidity on Factory directly from the wallet.
- Private balance: encrypt and decrypt funds via the Octra FHE layer.
- Dapp provider (`window.octra`): connect, sign, and call contracts, with in-popup approval.
- Multiple accounts, import via seed phrase or private key.
- Interface available in English, Russian, and Chinese.

## Tech

Built with [WXT](https://wxt.dev) (Manifest V3), React, and [@noble](https://github.com/paulmillr/noble-curves) cryptography. No keys or secrets are sent off-device.

## Install (no build needed)

A prebuilt extension ships in the [`dist/`](dist) folder. Download or clone the repository, then load it in a Chromium browser:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist` folder.
4. Pin the extension and open it to create or import a wallet.

## Build from source

If you prefer to build it yourself, requires [Node.js](https://nodejs.org) 20 or newer:

```bash
npm install
npm run build
```

This produces an unpacked extension in `.output/chrome-mv3` (the same contents as `dist/`). Load that folder the same way. To refresh after pulling changes, rebuild and click the refresh icon on the extension card, or remove and load unpacked again to clear cached chunks.

## Development

```bash
npm run dev         # start WXT in dev mode with hot reload
npm run build       # production build
npm run typecheck   # TypeScript check, no emit
```

## Security

Your password is the only secret protecting the vault at rest, so choose a strong one. The wallet enforces a password policy on creation and import. The decrypted keyring lives only in memory while unlocked and is wiped on lock or auto-lock.

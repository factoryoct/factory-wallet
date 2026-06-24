# Privacy Policy for Factory Wallet

_Last updated: 24 June 2026_

Factory Wallet ("the extension") is a self custody browser wallet for the Octra blockchain. This policy explains what the extension does with your data and what leaves your device.

## The short version

- Your seed phrase, private key, and password are generated and stored only on your device. They are encrypted with a key derived from your password and are never transmitted anywhere.
- The extension contains no analytics, tracking, or telemetry.
- We do not sell or share your data.

## What stays on your device

The following never leaves your device and is never sent to us or to anyone else:

- your seed phrase and private key
- your wallet password
- the encrypted wallet vault

The signing key is held in memory only while the wallet is unlocked, and is wiped on lock or auto lock.

## What leaves your device, and why

To work as a blockchain wallet, the extension makes network requests:

- **Octra RPC nodes** (for example devnet.octrascan.io and octra.network). The extension sends your public wallet address to read your balance and token holdings, and submits the transactions you choose to sign. This is the same public on chain data anyone can read.
- **Factory indexer** (the project read only metrics service). The extension sends your public wallet address to display token information and balances.
- **CoinGecko** (api.coingecko.com). The extension requests the public OCT price to show an approximate fiat value. No wallet data is sent.

As with any internet request, the destination server can see your IP address. We do not store or process your IP address for any other purpose.

## Permissions

- **storage**: stores your encrypted wallet and settings locally on the device.
- **alarms**: schedules the auto lock timer that locks the wallet and clears the key from memory after an idle period.
- **host access** (content script): injects a small provider into web pages so Octra web apps can detect the wallet and request a connection. A page can read only your public address, and can never move funds without a transaction you explicitly approve in the extension.

## Data we do not collect

We do not collect your name, email, home address, age, identity documents, medical data, personal communications, search history, keystrokes, mouse activity, or page content.

## Sharing and use

We do not sell, rent, or share your data. We do not use your data for purposes unrelated to the wallet, and we do not use it to determine creditworthiness or for lending.

## Changes

If this policy changes, the updated version is posted at this URL with a new date.

## Contact

Questions or reports: open an issue at https://github.com/factoryoct/factory-wallet or contact the Factory team.

// Keyring: in-memory set of accounts, each an ed25519 seed -> keypair -> oct address.
// Serializes to a JSON string that the vault encrypts.

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha512'
import { generateKeypair, keypairFromSeed } from './keys'
import { publicKeyToAddress } from './address'
import { bytesToHex, hexToBytes, base64ToBytes, bytesToBase64 } from './encoding'
import type { Keypair } from './keys'

export interface Account {
  address: string
  label: string
  seedHex: string       // 32-byte ed25519 seed
  mnemonic?: string     // BIP39 phrase, when the account was created or imported from one
}

interface Serialized { version: 1; accounts: { label: string; seedHex: string; mnemonic?: string }[] }

// ed25519 seed from a BIP39 phrase, the Octra way.
function seedFromMnemonic(m: string): Uint8Array {
  return hmac(sha512, new TextEncoder().encode('Octra seed'), mnemonicToSeedSync(m)).slice(0, 32)
}

export class Keyring {
  private accounts: Account[] = []

  private add(seed: Uint8Array, label: string, mnemonic?: string): Account {
    const kp = keypairFromSeed(seed)
    const address = publicKeyToAddress(kp.publicKey)
    const existing = this.accounts.find(a => a.address === address)
    if (existing) return existing
    const acct: Account = { address, label, seedHex: bytesToHex(seed), mnemonic }
    this.accounts.push(acct)
    return acct
  }

  /** New account from a freshly generated 12-word seed phrase. */
  createAccount(label = `Account ${this.accounts.length + 1}`): Account {
    const mnemonic = generateMnemonic(wordlist, 128)
    return this.add(seedFromMnemonic(mnemonic), label, mnemonic)
  }

  /** Import from a 32-byte seed (hex, with or without 0x). */
  importSeed(seedHex: string, label = `Imported ${this.accounts.length + 1}`, mnemonic?: string): Account {
    const seed = hexToBytes(seedHex)
    if (seed.length !== 32) throw new Error('seed must be 32 bytes')
    return this.add(seed, label, mnemonic)
  }

  /** Import a private key: 32-byte ed25519 seed as hex (64 chars) or base64 (Octra format). */
  importPrivateKey(value: string, label = `Imported ${this.accounts.length + 1}`): Account {
    const v = value.trim()
    let seed: Uint8Array
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(v)) seed = hexToBytes(v)
    else { try { seed = base64ToBytes(v) } catch { throw new Error('invalid private key') } }
    if (seed.length !== 32) throw new Error('private key must be a 32-byte ed25519 seed')
    return this.add(seed, label)
  }

  /** Import a BIP39 seed phrase: ed25519_seed = HMAC-SHA512("Octra seed", bip39_seed)[:32]. */
  importMnemonic(phrase: string, label = `Imported ${this.accounts.length + 1}`): Account {
    const m = phrase.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!validateMnemonic(m, wordlist)) throw new Error('invalid seed phrase')
    return this.add(seedFromMnemonic(m), label, m)
  }

  /** Remove an account (cannot remove the last one). */
  remove(address: string): void {
    if (this.accounts.length <= 1) throw new Error('cannot remove the last account')
    this.accounts = this.accounts.filter(a => a.address !== address)
  }

  list(): Omit<Account, 'seedHex' | 'mnemonic'>[] {
    return this.accounts.map(({ address, label }) => ({ address, label }))
  }

  rename(address: string, label: string): void {
    const a = this.accounts.find(x => x.address === address)
    if (!a) throw new Error('unknown account')
    a.label = label.trim() || a.label
  }

  /** Backup material for an account: the seed phrase (if any) and the private key (Octra base64). */
  secrets(address: string): { mnemonic?: string; privateKey: string } {
    const a = this.accounts.find(x => x.address === address)
    if (!a) throw new Error('unknown account')
    return { mnemonic: a.mnemonic, privateKey: bytesToBase64(hexToBytes(a.seedHex)) }
  }

  /** Keypair for signing. */
  keypair(address: string): Keypair {
    const a = this.accounts.find(x => x.address === address)
    if (!a) throw new Error('unknown account: ' + address)
    return keypairFromSeed(hexToBytes(a.seedHex))
  }

  isEmpty(): boolean { return this.accounts.length === 0 }

  serialize(): string {
    const s: Serialized = { version: 1, accounts: this.accounts.map(({ label, seedHex, mnemonic }) => ({ label, seedHex, mnemonic })) }
    return JSON.stringify(s)
  }

  static deserialize(json: string): Keyring {
    const s = JSON.parse(json) as Serialized
    const kr = new Keyring()
    for (const a of s.accounts) kr.importSeed(a.seedHex, a.label, a.mnemonic)
    return kr
  }
}

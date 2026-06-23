// Typed popup -> background client. Every call is a runtime message resolved by the
// background service; throws the background's error message on failure.

export interface AccountView { address: string; label: string }

function call<T = unknown>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (r: { ok: boolean; res?: T; error?: string }) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      if (!r) return reject(new Error('no response'))
      r.ok ? resolve(r.res as T) : reject(new Error(r.error || 'error'))
    })
  })
}

export const api = {
  status: () => call<{ hasVault: boolean; unlocked: boolean }>({ type: 'status' }),
  create: (password: string) => call<AccountView[]>({ type: 'create', password }),
  importWallet: (password: string, mode: 'seed' | 'mnemonic' | 'private', value: string) => call<AccountView[]>({ type: 'importWallet', password, mode, value }),
  unlock: (password: string) => call<AccountView[]>({ type: 'unlock', password }),
  lock: () => call({ type: 'lock' }),
  accounts: () => call<AccountView[]>({ type: 'accounts' }),
  addAccount: (mode: 'new' | 'private' | 'mnemonic' = 'new', value?: string) => call<AccountView[]>({ type: 'addAccount', mode, value }),
  removeAccount: (address: string) => call<AccountView[]>({ type: 'removeAccount', address }),
  balance: (address: string) => call<{ balance: string; nonce: number }>({ type: 'balance', address }),
  getSeed: (address: string) => call<{ seedHex: string }>({ type: 'getSeed', address }),
  getSecrets: (address: string) => call<{ mnemonic?: string; privateKey: string }>({ type: 'getSecrets', address }),
  privDecrypt: (address: string, cipher: string) => call<{ value: string }>({ type: 'privDecrypt', address, cipher }),
  tokens: (address: string) => call<{ symbol: string; balance: string; native: boolean; address: string }[]>({ type: 'tokens', address }),
  addToken: (address: string) => call<{ symbol: string; address: string }[]>({ type: 'addToken', address }),
  removeToken: (address: string) => call<{ symbol: string; address: string }[]>({ type: 'removeToken', address }),
  activity: (address: string) => call<any[]>({ type: 'activity', address }),
  lpPositions: (address: string) => call<{ pool: string; sym0: string; sym1: string; fee: number; amount0: string; amount1: string; owed0: string; owed1: string; inRange: boolean }[]>({ type: 'lpPositions', address }),
  octPrice: () => call<{ usd: number; change24h: number }>({ type: 'octPrice' }),
  octChart: () => call<number[]>({ type: 'octChart' }),
  getSelected: () => call<{ address: string | null }>({ type: 'getSelected' }),
  setSelected: (address: string) => call({ type: 'setSelected', address }),
  getNetwork: () => call<{ url: string; networks: { name: string; url: string }[] }>({ type: 'getNetwork' }),
  setNetwork: (url: string) => call<{ url: string }>({ type: 'setNetwork', url }),
  getAutoLock: () => call<{ minutes: number }>({ type: 'getAutoLock' }),
  setAutoLock: (minutes: number) => call<{ minutes: number }>({ type: 'setAutoLock', minutes }),
  renameAccount: (address: string, label: string) => call<AccountView[]>({ type: 'renameAccount', address, label }),
  changePassword: (oldPassword: string, newPassword: string) => call({ type: 'changePassword', oldPassword, newPassword }),
  exportPrivateKey: (address: string, password: string) => call<{ hex: string; base64: string }>({ type: 'exportPrivateKey', address, password }),
  reset: () => call({ type: 'reset' }),
  approvalPending: () => call<{ id: string; kind: 'connect' | 'tx'; origin: string; data: any } | null>({ __approvalPending: true }),
  approvalResolve: (id: string, approved: boolean, address?: string) => call({ __approvalResult: true, id, approved, address }),
  sites: () => call<{ origin: string; address: string }[]>({ type: 'sites' }),
  revoke: (origin: string) => call({ type: 'revoke', origin }),
  send: (address: string, to: string, oct: number) => call<{ hash: string }>({ type: 'send', address, to, oct }),
  sendToken: (address: string, token: string, to: string, amountMicro: string) => call<{ hash: string }>({ type: 'sendToken', address, token, to, amountMicro }),
  encryptOp: (address: string, amountMicro: string, encryptedData: string, opType: 'encrypt' | 'decrypt', ou?: string) =>
    call<{ hash: string }>({ type: 'encryptOp', address, amountMicro, encryptedData, opType, ou }),
}

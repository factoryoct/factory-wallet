import React, { createContext, useContext, useEffect, useState } from 'react'

export type Lang = 'en' | 'ru' | 'zh'
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '中文' },
]

// Translation dictionary. `en` is the source of truth; `ru`/`zh` mirror its keys. A missing
// key falls back to en, then to the key itself.
type Dict = Record<string, string>
const EN: Dict = {
  // actions / nav
  swap: 'Swap', send: 'Send', receive: 'Receive', activity: 'Activity', privacy: 'Privacy', defi: 'DeFi',
  settings: 'Settings', connected: 'Connected', back: 'back', cancel: 'cancel', add: 'add',
  // dashboard
  tokens: 'tokens', private_balance: 'private balance', total: 'total', search_tokens: 'search tokens…',
  no_sites: 'no sites', site: 'site', sites: 'sites', network: 'network',
  // send
  token: 'token', recipient: 'recipient', amount: 'amount', max: 'max', sending: 'sending…', sent: 'sent',
  invalid_recipient: 'invalid recipient address', invalid_amount: 'invalid amount',
  // receive
  your_address: 'your address', copy_address: 'copy address', copied: 'copied ✓',
  receive_hint: 'send OCT or any OCS-01 token to this address on the Octra network.',
  // privacy
  encrypt: 'encrypt', decrypt: 'decrypt', public: 'public', private: 'private', gas: 'gas (ou)',
  encrypt_hint: 'move public OCT into your private (encrypted) balance.',
  decrypt_hint: 'move private OCT back to your public balance. building the proof can take 30-60 seconds.',
  encrypting: 'encrypting…', decrypting: 'decrypting…', enter_amount: 'enter an amount',
  // defi
  defi_liquidity: 'DeFi · liquidity', loading_positions: 'loading positions…',
  no_positions: 'no open liquidity positions in Factory.', in_range: 'in range', out_of_range: 'out of range',
  unclaimed_fees: 'unclaimed fees', manage_position: 'manage position', fee: 'fee',
  // activity
  no_tx: 'no transactions yet', loading: 'loading…',
  // settings
  accounts: 'accounts', active: 'active', add_account: 'add account', network_rpc: 'network (RPC)',
  auto_lock: 'auto-lock', minutes: 'minutes', never: 'never', language: 'language', security: 'security',
  change_password: 'change password', export_private_key: 'export private key', connected_sites: 'connected sites',
  lock_wallet: 'lock wallet', danger_zone: 'danger zone', reset_wallet: 'reset wallet',
  // approval
  connection_request: 'connection request', signature_request: 'review transaction',
  connect_hint: 'this site wants to connect to your wallet and see your account address. it cannot move funds without a separate approval.',
  account_to_connect: 'account to connect', reject: 'reject', connect: 'connect', approve: 'approve',
  // onboard / unlock
  enter_password: 'enter password', unlock: 'unlock', unlocking: 'unlocking…',
  create: 'create', importw: 'import', create_wallet: 'create wallet', import_wallet: 'import wallet',
  password_min: 'password (min 12)', confirm_password: 'confirm password',
}
const RU: Dict = {
  swap: 'Обмен', send: 'Отправить', receive: 'Получить', activity: 'История', privacy: 'Приватность', defi: 'DeFi',
  settings: 'Настройки', connected: 'Подключения', back: 'назад', cancel: 'отмена', add: 'добавить',
  tokens: 'токены', private_balance: 'приватный баланс', total: 'всего', search_tokens: 'поиск токенов…',
  no_sites: 'нет сайтов', site: 'сайт', sites: 'сайтов', network: 'сеть',
  token: 'токен', recipient: 'получатель', amount: 'сумма', max: 'макс', sending: 'отправка…', sent: 'отправлено',
  invalid_recipient: 'неверный адрес получателя', invalid_amount: 'неверная сумма',
  your_address: 'ваш адрес', copy_address: 'копировать адрес', copied: 'скопировано ✓',
  receive_hint: 'отправляйте OCT или любой OCS-01 токен на этот адрес в сети Octra.',
  encrypt: 'зашифровать', decrypt: 'расшифровать', public: 'публичный', private: 'приватный', gas: 'газ (ou)',
  encrypt_hint: 'перевести публичный OCT в приватный (зашифрованный) баланс.',
  decrypt_hint: 'вернуть приватный OCT в публичный баланс. построение доказательства занимает 30-60 секунд.',
  encrypting: 'шифрование…', decrypting: 'расшифровка…', enter_amount: 'введите сумму',
  defi_liquidity: 'DeFi · ликвидность', loading_positions: 'загрузка позиций…',
  no_positions: 'нет открытых позиций ликвидности в Factory.', in_range: 'в диапазоне', out_of_range: 'вне диапазона',
  unclaimed_fees: 'несобранные комиссии', manage_position: 'управление позицией', fee: 'комиссия',
  no_tx: 'пока нет транзакций', loading: 'загрузка…',
  accounts: 'аккаунты', active: 'активный', add_account: 'добавить аккаунт', network_rpc: 'сеть (RPC)',
  auto_lock: 'автоблокировка', minutes: 'минут', never: 'никогда', language: 'язык', security: 'безопасность',
  change_password: 'сменить пароль', export_private_key: 'экспорт приватного ключа', connected_sites: 'подключённые сайты',
  lock_wallet: 'заблокировать', danger_zone: 'опасная зона', reset_wallet: 'сбросить кошелёк',
  connection_request: 'запрос подключения', signature_request: 'проверка транзакции',
  connect_hint: 'этот сайт хочет подключиться к кошельку и видеть адрес вашего аккаунта. без отдельного подтверждения он не может двигать средства.',
  account_to_connect: 'какой аккаунт подключить', reject: 'отклонить', connect: 'подключить', approve: 'подтвердить',
  enter_password: 'введите пароль', unlock: 'разблокировать', unlocking: 'разблокировка…',
  create: 'создать', importw: 'импорт', create_wallet: 'создать кошелёк', import_wallet: 'импорт кошелька',
  password_min: 'пароль (мин 12)', confirm_password: 'подтвердите пароль',
}
const ZH: Dict = {
  swap: '兑换', send: '发送', receive: '接收', activity: '记录', privacy: '隐私', defi: 'DeFi',
  settings: '设置', connected: '已连接', back: '返回', cancel: '取消', add: '添加',
  tokens: '代币', private_balance: '隐私余额', total: '总计', search_tokens: '搜索代币…',
  no_sites: '无站点', site: '站点', sites: '站点', network: '网络',
  token: '代币', recipient: '收款地址', amount: '金额', max: '最大', sending: '发送中…', sent: '已发送',
  invalid_recipient: '收款地址无效', invalid_amount: '金额无效',
  your_address: '您的地址', copy_address: '复制地址', copied: '已复制 ✓',
  receive_hint: '在 Octra 网络向此地址发送 OCT 或任意 OCS-01 代币。',
  encrypt: '加密', decrypt: '解密', public: '公开', private: '隐私', gas: '燃料 (ou)',
  encrypt_hint: '将公开 OCT 转入您的隐私（加密）余额。',
  decrypt_hint: '将隐私 OCT 转回公开余额。生成证明需要 30-60 秒。',
  encrypting: '加密中…', decrypting: '解密中…', enter_amount: '请输入金额',
  defi_liquidity: 'DeFi · 流动性', loading_positions: '加载仓位…',
  no_positions: '在 Factory 没有未平仓流动性仓位。', in_range: '价格范围内', out_of_range: '超出范围',
  unclaimed_fees: '未领取手续费', manage_position: '管理仓位', fee: '费率',
  no_tx: '暂无交易', loading: '加载中…',
  accounts: '账户', active: '当前', add_account: '添加账户', network_rpc: '网络 (RPC)',
  auto_lock: '自动锁定', minutes: '分钟', never: '从不', language: '语言', security: '安全',
  change_password: '修改密码', export_private_key: '导出私钥', connected_sites: '已连接站点',
  lock_wallet: '锁定钱包', danger_zone: '危险区', reset_wallet: '重置钱包',
  connection_request: '连接请求', signature_request: '确认交易',
  connect_hint: '此站点希望连接您的钱包并查看您的账户地址。未经单独批准，它无法转移资金。',
  account_to_connect: '要连接的账户', reject: '拒绝', connect: '连接', approve: '批准',
  enter_password: '输入密码', unlock: '解锁', unlocking: '解锁中…',
  create: '创建', importw: '导入', create_wallet: '创建钱包', import_wallet: '导入钱包',
  password_min: '密码（至少12位）', confirm_password: '确认密码',
}
const DICTS: Record<Lang, Dict> = { en: EN, ru: RU, zh: ZH }

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} })

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')
  useEffect(() => { chrome.storage.local.get('fw_lang').then(r => { if (r.fw_lang) setLangState(r.fw_lang as Lang) }).catch(() => {}) }, [])
  const setLang = (l: Lang) => { setLangState(l); chrome.storage.local.set({ fw_lang: l }).catch(() => {}) }
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>
}

export function useLang() { return useContext(LangContext) }
export function useT() {
  const { lang } = useContext(LangContext)
  return (key: string): string => DICTS[lang][key] ?? EN[key] ?? key
}

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
  tokens: 'assets', private_balance: 'private balance', total: 'total', search_tokens: 'search assets…',
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
  a_swap: 'swap', a_wrap: 'wrap OCT', a_unwrap: 'unwrap OCT', a_transfer: 'token transfer',
  a_approve: 'approve', a_add_liq: 'add liquidity', a_remove_liq: 'remove liquidity',
  a_collect: 'collect fees', a_claim: 'claim', a_deploy: 'deploy', a_tx: 'transaction',
  a_to: 'to', a_from: 'from', a_shield: 'shield balance', a_unshield: 'unshield balance',
  a_contract: 'contract', a_contract_call: 'contract call', a_calls: 'calls', a_call: 'call', a_atomic: 'atomic',
  // browser drawer
  br_search: 'search or enter address', br_favorites: 'favorites', br_recent: 'recent', br_tabs: 'tabs',
  br_no_favorites: 'no bookmarks yet', br_no_recent: 'nothing here yet', br_no_tabs: 'no open tabs', br_new_tab: 'new tab', br_open: 'open', br_go: 'go',
  br_edit: 'edit', br_done: 'done', br_search_url: 'search or enter dapp url', br_circle_addr: 'circle address  oct://… or id',
  br_no_circles: 'no circles saved yet', br_circle_history: 'no circle history yet', br_circle_tabs: 'no circle tabs open',
  // settings
  accounts: 'accounts', active: 'active', add_account: 'add account', network_rpc: 'network (RPC)',
  auto_lock: 'auto-lock', minutes: 'minutes', never: 'never', language: 'language', theme: 'theme', light: 'light', dark: 'dark', security: 'security',
  change_password: 'change password', export_private_key: 'export private key', connected_sites: 'connected sites',
  lock_wallet: 'lock wallet', danger_zone: 'danger zone', reset_wallet: 'reset wallet',
  // approval
  connection_request: 'connection request', signature_request: 'review transaction',
  connect_hint: 'this site wants to connect to your wallet and see your account address. it cannot move funds without a separate approval.',
  account_to_connect: 'account to connect', reject: 'reject', connect: 'connect', approve: 'approve',
  // onboard / unlock
  enter_password: 'enter password', unlock: 'unlock', unlocking: 'unlocking…',
  create: 'create', importw: 'import', create_wallet: 'create wallet', import_wallet: 'import wallet',
  backup_title: 'back up your wallet', backup_warn: 'save these somewhere safe. anyone with them controls your funds, and we cannot recover them for you.',
  seed_phrase: 'seed phrase', private_key: 'private key', copy: 'copy', copied: 'copied', continue: 'continue',
  backup_ack: 'I saved my seed phrase and private key somewhere safe.',
  password_min: 'password (min 12)', confirm_password: 'confirm password',
  // add account
  aa_title: 'add account', aa_tab_new: 'new', aa_tab_seed: 'seed', aa_tab_pk: 'key',
  aa_new_hint: 'creates a brand new account from a fresh random key and adds it to your encrypted vault.',
  aa_seed_ph: 'twelve or twenty-four words…', aa_pk_ph: 'hex (64 chars) or base64…',
  aa_create_btn: 'create account', aa_import_btn: 'import account', aa_working: 'working…',
  wallet_tagline: 'your gateway to Octra',
}
const RU: Dict = {
  swap: 'Обмен', send: 'Отправить', receive: 'Получить', activity: 'История', privacy: 'Приватность', defi: 'DeFi',
  settings: 'Настройки', connected: 'Подключения', back: 'назад', cancel: 'отмена', add: 'добавить',
  tokens: 'активы', private_balance: 'приватный баланс', total: 'всего', search_tokens: 'поиск активов…',
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
  a_swap: 'обмен', a_wrap: 'обернуть OCT', a_unwrap: 'развернуть OCT', a_transfer: 'перевод токена',
  a_approve: 'разрешение', a_add_liq: 'добавление ликвидности', a_remove_liq: 'вывод ликвидности',
  a_collect: 'сбор комиссий', a_claim: 'клейм', a_deploy: 'деплой', a_tx: 'транзакция',
  a_to: 'кому', a_from: 'от', a_shield: 'скрыть баланс', a_unshield: 'раскрыть баланс',
  a_contract: 'контракт', a_contract_call: 'вызов контракта', a_calls: 'вызовов', a_call: 'вызов', a_atomic: 'атомарно',
  br_search: 'поиск или адрес', br_favorites: 'избранное', br_recent: 'недавние', br_tabs: 'вкладки',
  br_no_favorites: 'пока нет закладок', br_no_recent: 'здесь пока пусто', br_no_tabs: 'нет открытых вкладок', br_new_tab: 'новая вкладка', br_open: 'открыть', br_go: 'перейти',
  br_edit: 'правка', br_done: 'готово', br_search_url: 'поиск или адрес dapp', br_circle_addr: 'адрес круга  oct://… или id',
  br_no_circles: 'пока нет сохранённых кругов', br_circle_history: 'истории кругов пока нет', br_circle_tabs: 'нет открытых кругов',
  accounts: 'аккаунты', active: 'активный', add_account: 'добавить аккаунт', network_rpc: 'сеть (RPC)',
  auto_lock: 'автоблокировка', minutes: 'минут', never: 'никогда', language: 'язык', theme: 'тема', light: 'светлая', dark: 'тёмная', security: 'безопасность',
  change_password: 'сменить пароль', export_private_key: 'экспорт приватного ключа', connected_sites: 'подключённые сайты',
  lock_wallet: 'заблокировать', danger_zone: 'опасная зона', reset_wallet: 'сбросить кошелёк',
  connection_request: 'запрос подключения', signature_request: 'проверка транзакции',
  connect_hint: 'этот сайт хочет подключиться к кошельку и видеть адрес вашего аккаунта. без отдельного подтверждения он не может двигать средства.',
  account_to_connect: 'какой аккаунт подключить', reject: 'отклонить', connect: 'подключить', approve: 'подтвердить',
  enter_password: 'введите пароль', unlock: 'разблокировать', unlocking: 'разблокировка…',
  create: 'создать', importw: 'импорт', create_wallet: 'создать кошелёк', import_wallet: 'импорт кошелька',
  backup_title: 'сохраните доступ к кошельку', backup_warn: 'сохраните это в надёжном месте. любой, у кого есть эти данные, управляет вашими средствами, и мы не сможем их восстановить.',
  seed_phrase: 'сид-фраза', private_key: 'приватный ключ', copy: 'копировать', copied: 'скопировано', continue: 'продолжить',
  backup_ack: 'я сохранил сид-фразу и приватный ключ в надёжном месте.',
  password_min: 'пароль (мин 12)', confirm_password: 'подтвердите пароль',
  aa_title: 'добавить аккаунт', aa_tab_new: 'новый', aa_tab_seed: 'фраза', aa_tab_pk: 'ключ',
  aa_new_hint: 'создаёт новый аккаунт из случайного ключа и добавляет его в зашифрованное хранилище.',
  aa_seed_ph: 'двенадцать или двадцать четыре слова…', aa_pk_ph: 'hex (64 символа) или base64…',
  aa_create_btn: 'создать аккаунт', aa_import_btn: 'импортировать аккаунт', aa_working: 'обработка…',
  wallet_tagline: 'ваш доступ к сети Octra',
}
const ZH: Dict = {
  swap: '兑换', send: '发送', receive: '接收', activity: '记录', privacy: '隐私', defi: 'DeFi',
  settings: '设置', connected: '已连接', back: '返回', cancel: '取消', add: '添加',
  tokens: '资产', private_balance: '隐私余额', total: '总计', search_tokens: '搜索资产…',
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
  a_swap: '兑换', a_wrap: '封装 OCT', a_unwrap: '解封 OCT', a_transfer: '代币转账',
  a_approve: '授权', a_add_liq: '添加流动性', a_remove_liq: '移除流动性',
  a_collect: '领取手续费', a_claim: '领取', a_deploy: '部署', a_tx: '交易',
  a_to: '至', a_from: '来自', a_shield: '隐藏余额', a_unshield: '公开余额',
  a_contract: '合约', a_contract_call: '合约调用', a_calls: '次调用', a_call: '次调用', a_atomic: '原子',
  br_search: '搜索或输入地址', br_favorites: '收藏', br_recent: '最近', br_tabs: '标签页',
  br_no_favorites: '暂无书签', br_no_recent: '这里还是空的', br_no_tabs: '没有打开的标签页', br_new_tab: '新标签页', br_open: '打开', br_go: '前往',
  br_edit: '编辑', br_done: '完成', br_search_url: '搜索或输入 dapp 网址', br_circle_addr: '圈子地址  oct://… 或 id',
  br_no_circles: '暂无保存的圈子', br_circle_history: '暂无圈子记录', br_circle_tabs: '没有打开的圈子',
  accounts: '账户', active: '当前', add_account: '添加账户', network_rpc: '网络 (RPC)',
  auto_lock: '自动锁定', minutes: '分钟', never: '从不', language: '语言', theme: '主题', light: '浅色', dark: '深色', security: '安全',
  change_password: '修改密码', export_private_key: '导出私钥', connected_sites: '已连接站点',
  lock_wallet: '锁定钱包', danger_zone: '危险区', reset_wallet: '重置钱包',
  connection_request: '连接请求', signature_request: '确认交易',
  connect_hint: '此站点希望连接您的钱包并查看您的账户地址。未经单独批准，它无法转移资金。',
  account_to_connect: '要连接的账户', reject: '拒绝', connect: '连接', approve: '批准',
  enter_password: '输入密码', unlock: '解锁', unlocking: '解锁中…',
  create: '创建', importw: '导入', create_wallet: '创建钱包', import_wallet: '导入钱包',
  backup_title: '备份您的钱包', backup_warn: '请妥善保存。任何掌握这些信息的人都能控制您的资金，我们无法为您恢复。',
  seed_phrase: '助记词', private_key: '私钥', copy: '复制', copied: '已复制', continue: '继续',
  backup_ack: '我已将助记词和私钥保存在安全的地方。',
  password_min: '密码（至少12位）', confirm_password: '确认密码',
  aa_title: '添加账户', aa_tab_new: '新建', aa_tab_seed: '助记词', aa_tab_pk: '私钥',
  aa_new_hint: '用新的随机密钥创建一个全新账户，并加入您的加密保险库。',
  aa_seed_ph: '十二或二十四个单词…', aa_pk_ph: 'hex（64位）或 base64…',
  aa_create_btn: '创建账户', aa_import_btn: '导入账户', aa_working: '处理中…',
  wallet_tagline: '你通往 Octra 的入口',
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

import React, { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRightLeft, Send as SendIcon, ArrowDownToLine, Clock, Link as LinkIcon, Droplet, Settings as SettingsIcon, Copy, Check, ChevronLeft, RefreshCw, Lock, Plus, Pencil, Globe, ChevronDown, HelpCircle, Trash2 } from 'lucide-react'
import { api, type AccountView } from './api'
import { ApprovalView, type ApprovalReq } from './Approval'
import { useT, useLang, LANGS } from './i18n'

const F = 'Tahoma, Arial, sans-serif'
const M = '"SF Mono", Consolas, Monaco, monospace'
const ink = '#2c3e57', muted = '#7a8fa8', accent = '#3b567f', border = '#c8d0db', bg = '#eef1f5'
const FACTORY_FAUCET = 'https://factory-amm.xyz/faucet'

const btn: CSSProperties = { fontFamily: F, fontSize: 14, fontWeight: 600, color: '#fff', background: accent, border: 'none', padding: '11px 16px', cursor: 'pointer', width: '100%' }
const input: CSSProperties = { fontFamily: M, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, background: '#fff', width: '100%', outline: 'none' }
const pad: CSSProperties = { padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }
const label: CSSProperties = { fontFamily: F, fontSize: 12, color: muted, textTransform: 'uppercase', letterSpacing: '0.8px' }
const short = (a: string) => a.slice(0, 8) + '…' + a.slice(-6)
const grad = `linear-gradient(160deg, ${accent}, ${ink})`

const TOKEN_LOGOS: Record<string, string> = { OCT: '/oct.jpg', WOCT: '/oct.jpg', FACT: '/fact.png', COG: '/cog.png', SPRK: '/sprk.png', LUM: '/lum.png' }
function TokenImg({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const src = TOKEN_LOGOS[symbol]
  if (src) return <img src={src} width={size} height={size} alt={symbol} style={{ borderRadius: '50%', objectFit: 'cover', display: 'block', flexShrink: 0 }} />
  return <div style={{ width: size, height: size, borderRadius: '50%', background: bg, border: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: M, fontSize: size * 0.42, color: ink, flexShrink: 0 }}>{symbol[0]}</div>
}

// ICONS keeps string keys; Ic maps each key to its lucide component.
const LU: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; style?: CSSProperties }>> = {
  swap: ArrowRightLeft, send: SendIcon, receive: ArrowDownToLine, activity: Clock, connected: LinkIcon, faucet: Droplet,
  gear: SettingsIcon, copy: Copy, check: Check, back: ChevronLeft, refresh: RefreshCw, lock: Lock, plus: Plus, edit: Pencil, net: Globe, chevron: ChevronDown, trash: Trash2, privacy: Lock, defi: Droplet,
}
const ICONS: Record<string, string> = Object.fromEntries(Object.keys(LU).map(k => [k, k]))
function Ic({ d, size = 22 }: { d: string; size?: number }) {
  const C = LU[d] || HelpCircle
  return <C size={size} strokeWidth={1.9} style={{ display: 'block', flexShrink: 0 }} />
}

// Native select with a custom chevron.
function Select({ value, onChange, children }: { value: any; onChange: (e: any) => void; children: ReactNode }) {
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={onChange} style={{ ...input, fontFamily: F, appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', paddingRight: 38, cursor: 'pointer' } as CSSProperties}>{children}</select>
      <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: muted }} />
    </div>
  )
}

function Spark({ data, w = 364, h = 46 }: { data: number[]; w?: number; h?: number }) {
  const [hi, setHi] = useState<number | null>(null)
  if (!data || data.length < 2) return <div style={{ height: h }} />
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1
  const X = (i: number) => (i / (data.length - 1)) * w
  const Y = (v: number) => h - ((v - min) / span) * (h - 6) - 3
  const pts = data.map((v, i) => `${X(i)},${Y(v)}`).join(' ')
  const onMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const f = (e.clientX - r.left) / r.width
    setHi(Math.max(0, Math.min(data.length - 1, Math.round(f * (data.length - 1)))))
  }
  return (
    <div style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <polyline points={pts} fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={1.6} />
        {hi != null && <>
          <line x1={X(hi)} y1={0} x2={X(hi)} y2={h} stroke="#fff" strokeOpacity={0.45} strokeWidth={1} />
          <circle cx={X(hi)} cy={Y(data[hi])} r={3.2} fill="#fff" />
        </>}
      </svg>
      {hi != null && (
        <div style={{ position: 'absolute', top: -3, left: `${(hi / (data.length - 1)) * 100}%`, transform: `translateX(${hi < data.length / 2 ? '0' : '-100%'})`, fontFamily: M, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,.4)', padding: '1px 6px', borderRadius: 4, pointerEvents: 'none', whiteSpace: 'nowrap' }}>${data[hi].toFixed(4)}</div>
      )}
    </div>
  )
}

type View = 'loading' | 'onboard' | 'locked' | 'dash' | 'send' | 'receive' | 'activity' | 'connected' | 'settings' | 'addaccount' | 'privacy' | 'defi' | 'approval'

// Error boundary: shows a recoverable message instead of a blank popup. Keyed by view so it resets on navigation.
class Boundary extends React.Component<{ children: ReactNode; onReset: () => void }, { err: string }> {
  state = { err: '' }
  static getDerivedStateFromError(e: any) { return { err: e?.message || String(e) } }
  render() {
    if (!this.state.err) return this.props.children
    return <div style={pad}>
      <div style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: ink }}>something went wrong</div>
      <div style={{ fontFamily: M, fontSize: 12, color: muted }}>{this.state.err}</div>
      <button style={btn} onClick={() => { this.setState({ err: '' }); this.props.onReset() }}>back to home</button>
    </div>
  }
}

export function App() {
  const [view, setView] = useState<View>('loading')
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [sel, setSel] = useState(0)
  const [err, setErr] = useState('')
  const [connBack, setConnBack] = useState<View>('dash')
  const [addBack, setAddBack] = useState<View>('dash')
  const [approval, setApproval] = useState<ApprovalReq | null>(null)

  // Set accounts and restore the previously-selected account.
  const applyAccounts = async (a: AccountView[]) => {
    setAccounts(a)
    const selAddr = (await api.getSelected().catch(() => ({ address: null as string | null }))).address
    const i = selAddr ? a.findIndex(x => x.address === selAddr) : -1
    setSel(i >= 0 ? i : 0)
  }
  // Show a pending connect/sign request inside this popup.
  const checkApproval = async (): Promise<boolean> => {
    const p = await api.approvalPending().catch(() => null)
    if (p) { setApproval(p); setView('approval'); return true }
    return false
  }
  useEffect(() => {
    (async () => {
      let s: { hasVault: boolean; unlocked: boolean }
      try { s = await api.status() } catch { return setView('onboard') }
      if (!s.hasVault) return setView('onboard')
      if (!s.unlocked) return setView('locked')
      try { await applyAccounts(await api.accounts()) } catch { /* */ }
      if (!(await checkApproval())) setView('dash')
    })()
  }, [])
  // Surface a request that arrives while the dashboard is open.
  useEffect(() => {
    if (view !== 'dash') return
    const t = setInterval(() => { checkApproval() }, 2000)
    return () => clearInterval(t)
  }, [view])
  useEffect(() => { if (view === 'dash' && !accounts.length) api.accounts().then(applyAccounts).catch(() => {}) }, [view, accounts.length])
  // Persist the selected account whenever it changes.
  useEffect(() => { const a = accounts[sel]; if (a) api.setSelected(a.address).catch(() => {}) }, [sel])

  const acct = accounts[Math.min(sel, Math.max(0, accounts.length - 1))]
  const go = (v: View) => { setErr(''); setView(v) }
  const open = (url: string) => { try { window.open(url, '_blank') } catch { /* */ } }
  const openConnected = (from: View) => { setConnBack(from); go('connected') }
  const openAddAccount = (from: View) => { setAddBack(from); go('addaccount') }

  let content: ReactNode = null
  if (view === 'loading') content = <div style={{ ...pad, color: muted, fontFamily: F }}>loading…</div>
  else if (view === 'onboard') content = <Onboard onDone={a => { applyAccounts(a); go('dash') }} setErr={setErr} err={err} />
  else if (view === 'locked') content = <Unlock onDone={async a => { await applyAccounts(a); if (!(await checkApproval())) go('dash') }} setErr={setErr} err={err} />
  else if (view === 'approval' && approval) content = <ApprovalView req={approval} accounts={accounts} selDefault={sel} onDone={async () => { setApproval(null); if (!(await checkApproval())) go('dash') }} />
  else if (!acct) content = <div style={{ ...pad, color: muted, fontFamily: F }}>no account</div>
  else if (view === 'dash') content = <Dashboard acct={acct} accounts={accounts} sel={sel} setSel={setSel} setAccounts={setAccounts} go={go} open={open} openConnected={openConnected} openAddAccount={openAddAccount} setErr={setErr} />
  else if (view === 'send') content = <SendView acct={acct} back={() => go('dash')} setErr={setErr} />
  else if (view === 'receive') content = <ReceiveView acct={acct} back={() => go('dash')} />
  else if (view === 'privacy') content = <PrivacyView acct={acct} back={() => go('dash')} setErr={setErr} />
  else if (view === 'defi') content = <DefiView acct={acct} back={() => go('dash')} />
  else if (view === 'activity') content = <ActivityView acct={acct} back={() => go('dash')} />
  else if (view === 'connected') content = <ConnectedView back={() => go(connBack)} setErr={setErr} />
  else if (view === 'addaccount') content = <AddAccountView onDone={a => { setAccounts(a); setSel(a.length - 1); go(addBack) }} back={() => go(addBack)} setErr={setErr} />
  else if (view === 'settings') content = <SettingsView accounts={accounts} sel={sel} setSel={setSel} setAccounts={setAccounts} back={() => go('dash')} onLock={async () => { await api.lock(); import('./pvac').then(m => m.clearPvac()).catch(() => {}); go('locked') }} onReset={async () => { try { await api.reset() } catch { /* */ } setAccounts([]); setSel(0); go('onboard') }} setErr={setErr} openConnected={openConnected} openAddAccount={openAddAccount} />

  return (
    <div style={{ minHeight: 600, background: bg }}>
      {err && view !== 'onboard' && view !== 'locked' && <Banner text={err} />}
      <Boundary key={view} onReset={() => setView('dash')}><div className="fw-fade">{content}</div></Boundary>
    </div>
  )
}

const Banner = ({ text }: { text: string }) => <div style={{ background: '#f7e3e3', color: '#9a3b3b', fontFamily: F, fontSize: 12, padding: '8px 16px' }}>{text}</div>

// In-popup confirm dialog.
function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(20,28,40,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', border: `1px solid ${border}`, width: '100%', maxWidth: 300, padding: 18 }}>
        <div style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: ink, marginBottom: 8 }}>{title}</div>
        <div style={{ fontFamily: F, fontSize: 13, color: muted, lineHeight: 1.5, marginBottom: 16 }}>{body}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ ...btn, background: 'transparent', color: ink, border: `1px solid ${border}` }}>cancel</button>
          <button onClick={onConfirm} style={{ ...btn, background: '#9a3b3b' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function TopBar({ title, back }: { title: string; back?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: `1px solid ${border}`, background: '#fff' }}>
      {back && <button onClick={back} style={{ background: 'none', border: 'none', cursor: 'pointer', color: ink, display: 'flex' }}><Ic d={ICONS.back} size={20} /></button>}
      <span style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: ink, flex: 1 }}>{title}</span>
    </div>
  )
}

// ── dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ acct, accounts, sel, setSel, setAccounts, go, open, openConnected, openAddAccount, setErr }:
  { acct: AccountView; accounts: AccountView[]; sel: number; setSel: (n: number) => void; setAccounts: (a: AccountView[]) => void; go: (v: View) => void; open: (u: string) => void; openConnected: (from: View) => void; openAddAccount: (from: View) => void; setErr: (s: string) => void }) {
  const t = useT()
  const [bal, setBal] = useState<string | null>(null)
  const [tokens, setTokens] = useState<{ symbol: string; balance: string; native: boolean }[]>([])
  const [price, setPrice] = useState<{ usd: number; change24h: number } | null>(null)
  const [chart, setChart] = useState<number[]>([])
  const [sites, setSites] = useState(0)
  const [menu, setMenu] = useState(false)
  const [net, setNet] = useState<{ url: string; networks: { name: string; url: string }[] }>({ url: '', networks: [] })
  const [adding, setAdding] = useState(false)
  const [tokAddr, setTokAddr] = useState('')
  const [tokQ, setTokQ] = useState('')
  const [copied, setCopied] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [priv, setPriv] = useState<{ public: bigint; private: bigint | null } | null>(null)
  const [privBusy, setPrivBusy] = useState(false)
  const [privErr, setPrivErr] = useState('')
  const [tokBusy, setTokBusy] = useState(false)
  const copyAddr = () => { navigator.clipboard?.writeText(acct.address); setCopied(true); setTimeout(() => setCopied(false), 1200) }
  const fmtMicro = (b: bigint | null) => b == null ? '—' : (Number(b) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const loadPriv = async () => {
    setPrivBusy(true); setPrivErr('')
    try {
      const { url } = await api.getNetwork()
      const { readPrivateBalance } = await import('./pvac')
      setPriv(await readPrivateBalance(acct.address, url))
    } catch (e) { setPrivErr(e instanceof Error ? e.message : String(e)) } finally { setPrivBusy(false) }
  }
  useEffect(() => { setPriv(null); setPrivErr(''); loadPriv() }, [acct.address, net.url])

  const loadTokens = () => api.tokens(acct.address).then(setTokens).catch(() => { /* */ })
  const reloadToks = async () => { setTokBusy(true); try { await loadTokens() } finally { setTokBusy(false) } }
  const refresh = () => {
    setSpinning(true)
    if (bal === null) { /* first load shows … */ }
    Promise.all([
      api.balance(acct.address).then(b => setBal(b.balance)).catch(() => setBal('?')),
      loadTokens(),
      api.sites().then(s => setSites(s.length)).catch(() => { /* */ }),
    ]).finally(() => setTimeout(() => setSpinning(false), 500))
  }
  useEffect(() => { refresh() }, [acct.address])
  useEffect(() => {
    api.octPrice().then(setPrice).catch(() => { /* */ })
    api.getNetwork().then(setNet).catch(() => { /* */ })
    let cancelled = false
    const loadChart = (n = 0) => api.octChart()
      .then(c => { if (cancelled) return; if (c && c.length) setChart(c); else if (n < 4) setTimeout(() => loadChart(n + 1), 1000) })
      .catch(() => { if (!cancelled && n < 4) setTimeout(() => loadChart(n + 1), 1000) })
    loadChart()
    return () => { cancelled = true }
  }, [])

  const curNet = net.networks.find(n => n.url === net.url)
  const toggleNet = async () => {
    const other = net.networks.find(n => n.url !== net.url)
    if (!other) return
    try { await api.setNetwork(other.url); setNet({ ...net, url: other.url }); refresh() } catch (e) { setErr(String(e)) }
  }
  const addTok = async () => {
    const a = tokAddr.trim(); if (!a) return
    try { await api.addToken(a); setTokAddr(''); setAdding(false); loadTokens() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  const removeTok = async (a: string) => { try { await api.removeToken(a); loadTokens() } catch (e) { setErr(String(e)) } }

  const usd = price && price.usd > 0 ? '$' + (Number(bal || 0) * price.usd).toFixed(2) : null
  const actions = [
    { key: 'swap', label: t('swap'), disabled: true, onClick: () => { /* coming soon */ } },
    { key: 'send', label: t('send'), onClick: () => go('send') },
    { key: 'receive', label: t('receive'), onClick: () => go('receive') },
    { key: 'activity', label: t('activity'), onClick: () => go('activity') },
    { key: 'privacy', label: t('privacy'), disabled: true, onClick: () => {} },
    { key: 'defi', label: t('defi'), onClick: () => go('defi') },
  ]
  const ftokens = tokens.filter(t => { const q = tokQ.trim().toLowerCase(); return !q || t.symbol.toLowerCase().includes(q) || t.address.toLowerCase().includes(q) })

  return (
    <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
      {/* header (fixed) */}
      <div style={{ background: grad, color: '#fff', padding: '14px 16px 16px', position: 'relative', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setMenu(m => !m)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', fontFamily: F, fontSize: 14, fontWeight: 700, padding: '5px 10px', cursor: 'pointer' }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{acct.label[0]}</span>
            {acct.label}
            <Ic d={ICONS.chevron} size={15} />
          </button>
          <span style={{ fontFamily: M, fontSize: 11, opacity: .85 }}>{short(acct.address)}</span>
          <button onClick={copyAddr} title="copy address" style={{ width: 26, height: 26, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', padding: 0, cursor: 'pointer' }}>
            <Ic d={copied ? ICONS.check : ICONS.copy} size={14} />
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => go('settings')} title="settings" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex' }}><Ic d={ICONS.gear} size={20} /></button>
        </div>

        {menu && (
          <div style={{ position: 'absolute', left: 16, top: 52, zIndex: 20, background: '#fff', border: `1px solid ${border}`, boxShadow: '0 6px 20px rgba(0,0,0,.18)', minWidth: 220 }}>
            {accounts.map((a, i) => (
              <button key={a.address} onClick={() => { setSel(i); setMenu(false) }} style={{ width: '100%', textAlign: 'left', background: i === sel ? bg : '#fff', border: 'none', borderBottom: `1px solid ${border}`, padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontFamily: F, fontSize: 13, color: ink }}>{a.label}</span>
                <span style={{ fontFamily: M, fontSize: 11, color: muted }}>{short(a.address)}</span>
              </button>
            ))}
            <button onClick={() => { setMenu(false); openAddAccount('dash') }} style={{ width: '100%', background: '#fff', border: 'none', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: accent, fontFamily: F, fontSize: 13 }}>
              <Ic d={ICONS.plus} size={15} /> add account
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 16 }}>
          <span style={{ fontFamily: M, fontSize: 32, fontWeight: 700, lineHeight: 1 }}>{bal === null ? '…' : bal}</span>
          <span style={{ fontFamily: F, fontSize: 14, opacity: .8, paddingBottom: 4 }}>OCT</span>
          <button onClick={refresh} title="refresh" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', paddingBottom: 5, opacity: .85 }}><span className={spinning ? 'fw-spin' : ''} style={{ display: 'flex' }}><Ic d={ICONS.refresh} size={16} /></span></button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontFamily: F, fontSize: 13, opacity: .92 }}>
          {usd && <span>{usd}</span>}
          {price && price.usd > 0 && <span style={{ fontFamily: M, fontSize: 12, opacity: .8 }}>${price.usd.toFixed(4)}/OCT</span>}
          {price && <span style={{ color: price.change24h >= 0 ? '#86efac' : '#fca5a5', fontSize: 12 }}>{price.change24h >= 0 ? '+' : ''}{price.change24h.toFixed(2)}%</span>}
        </div>
        <div style={{ marginTop: 8 }}><Spark data={chart} /></div>
      </div>

      {/* action grid (fixed) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: border, flexShrink: 0 }}>
        {actions.map(a => (
          <button key={a.key} disabled={a.disabled} onClick={a.onClick} title={a.disabled ? 'coming soon' : ''} style={{ background: '#fff', border: 'none', cursor: a.disabled ? 'not-allowed' : 'pointer', padding: '15px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, color: a.disabled ? muted : accent, opacity: a.disabled ? .5 : 1 }}>
            <Ic d={ICONS[a.key]} size={23} />
            <span style={{ fontFamily: F, fontSize: 12.5, color: a.disabled ? muted : ink }}>{a.label}</span>
          </button>
        ))}
      </div>

      {/* private balance + tokens (scroll area; header above and footer below stay fixed) */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px 8px' }}>
        {/* private (FHE) balance */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ic d={ICONS.lock} size={15} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: F, fontSize: 11, color: muted }}>{t('private_balance')}</span>
                <button onClick={loadPriv} title="refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, display: 'flex', padding: 0 }}><span className={privBusy ? 'fw-spin' : ''} style={{ display: 'flex' }}><Ic d={ICONS.refresh} size={11} /></span></button>
              </div>
              <div style={{ fontFamily: M, fontSize: 15, color: ink }}>{priv ? `${fmtMicro(priv.private)} OCT` : privErr ? '—' : '…'}</div>
            </div>
          </div>
          {privErr && <div style={{ fontFamily: F, fontSize: 11, color: '#9a3b3b', marginTop: 6 }}>{privErr}</div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={label}>{t('tokens')}</div>
            <button onClick={reloadToks} title="refresh tokens" style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, display: 'flex', padding: 0 }}><span className={tokBusy ? 'fw-spin' : ''} style={{ display: 'flex' }}><Ic d={ICONS.refresh} size={11} /></span></button>
          </div>
          <button onClick={() => setAdding(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: accent, fontFamily: F, fontSize: 12.5 }}><Ic d={ICONS.plus} size={14} /> {t('add')}</button>
        </div>
        {adding ? (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input style={{ ...input, padding: '8px 10px' }} value={tokAddr} onChange={e => setTokAddr(e.target.value)} placeholder="token contract oct…" onKeyDown={e => e.key === 'Enter' && addTok()} autoFocus />
            <button onClick={addTok} style={{ ...btn, width: 'auto', padding: '0 16px' }}>add</button>
          </div>
        ) : tokens.length > 4 && (
          <input style={{ ...input, padding: '7px 10px', fontSize: 12, marginBottom: 8 }} value={tokQ} onChange={e => setTokQ(e.target.value)} placeholder={t('search_tokens')} />
        )}
        {ftokens.length === 0 ? <div style={{ fontFamily: F, fontSize: 13, color: muted, padding: '8px 0' }}>{tokens.length ? 'no match' : '…'}</div> : ftokens.map(t => (
          <div key={t.symbol + t.address} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TokenImg symbol={t.symbol} />
              <span style={{ fontFamily: F, fontSize: 14, color: ink }}>{t.symbol}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: M, fontSize: 13, color: ink }}>{Number(t.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
              {!t.native && <button onClick={() => removeTok(t.address)} title="remove token" style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>}
            </div>
          </div>
        ))}
      </div>

      {/* footer (always visible): connected + network */}
      <div style={{ display: 'flex', borderTop: `1px solid ${border}`, background: '#fff', flexShrink: 0 }}>
        <button onClick={() => openConnected('dash')} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', borderRight: `1px solid ${border}`, padding: '11px 14px', cursor: 'pointer', color: muted }}>
          <Ic d={ICONS.connected} size={16} />
          <span style={{ fontFamily: F, fontSize: 12.5 }}>{sites > 0 ? `${sites} ${sites > 1 ? t('sites') : t('site')}` : t('no_sites')}</span>
        </button>
        <button onClick={toggleNet} title="switch network" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '11px 14px', cursor: 'pointer', color: ink }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: curNet?.url.includes('devnet') ? '#c98a1e' : '#3b7f5a' }} />
          <span style={{ fontFamily: F, fontSize: 12.5 }}>{curNet ? curNet.name.replace('Octra ', '') : 'network'}</span>
          <Ic d={ICONS.chevron} size={13} />
        </button>
      </div>
    </div>
  )
}

// ── send ─────────────────────────────────────────────────────────────────────
function SendView({ acct, back, setErr }: { acct: AccountView; back: () => void; setErr: (s: string) => void }) {
  const t = useT()
  const [toks, setToks] = useState<{ symbol: string; balance: string; native: boolean; address: string }[]>([])
  const [tokIdx, setTokIdx] = useState(0)
  const [to, setTo] = useState(''); const [amt, setAmt] = useState(''); const [busy, setBusy] = useState(false); const [hash, setHash] = useState('')
  useEffect(() => { api.tokens(acct.address).then(setToks).catch(() => setToks([])) }, [acct.address])
  const tok = toks[tokIdx]
  const fmtBal = (b: string) => Number(b).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const send = async () => {
    setErr(''); setHash('')
    const v = Number(amt)
    if (!/^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(to.trim())) return setErr(t('invalid_recipient'))
    if (!(v > 0)) return setErr(t('invalid_amount'))
    setBusy(true)
    try {
      const r = (!tok || tok.native)
        ? await api.send(acct.address, to.trim(), v)
        : await api.sendToken(acct.address, tok.address, to.trim(), String(Math.round(v * 1e6)))
      setHash(r.hash); setTo(''); setAmt('')
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div>
      <TopBar title={t('send')} back={back} />
      <div style={pad}>
        <div style={label}>{t('token')}</div>
        <Select value={tokIdx} onChange={e => { setTokIdx(Number(e.target.value)); setAmt('') }}>
          {toks.map((tk, i) => <option key={tk.symbol + tk.address} value={i}>{tk.symbol} · {fmtBal(tk.balance)}</option>)}
        </Select>
        <div style={label}>{t('recipient')}</div>
        <input style={input} value={to} onChange={e => setTo(e.target.value)} placeholder="oct…" />
        <div style={label}>{t('amount')} ({tok?.symbol || 'OCT'}){tok && <span style={{ color: muted }}> · {t('max')} {fmtBal(tok.balance)}</span>}</div>
        <input style={input} value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.0" inputMode="decimal" />
        {/* private (stealth) send — not yet enabled */}
        <div title="coming soon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0', opacity: 0.5, cursor: 'not-allowed' }}>
          <span style={{ fontFamily: F, fontSize: 13, color: ink }}>private (stealth)<span style={{ fontFamily: F, fontSize: 9, color: muted, border: `1px solid ${border}`, padding: '1px 5px', marginLeft: 7, textTransform: 'uppercase', letterSpacing: '.5px' }}>soon</span></span>
          <div style={{ width: 38, height: 20, borderRadius: 10, background: border, position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: 2 }} />
          </div>
        </div>
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={send}>{busy ? t('sending') : t('send')}</button>
        {hash && <div style={{ fontFamily: M, fontSize: 11, color: '#3b7f5a', wordBreak: 'break-all' }}>{t('sent')}: {hash}</div>}
      </div>
    </div>
  )
}

// ── receive ──────────────────────────────────────────────────────────────────
function ReceiveView({ acct, back }: { acct: AccountView; back: () => void }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <TopBar title={t('receive')} back={back} />
      <div style={{ ...pad, alignItems: 'center', textAlign: 'center' }}>
        <TokenImg symbol="OCT" size={48} />
        <div style={{ ...label, alignSelf: 'stretch' }}>{t('your_address')}</div>
        <div style={{ fontFamily: M, fontSize: 13, color: ink, wordBreak: 'break-all', background: '#fff', border: `1px solid ${border}`, padding: 14, width: '100%' }}>{acct.address}</div>
        <button style={btn} onClick={() => { navigator.clipboard?.writeText(acct.address); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? t('copied') : t('copy_address')}</button>
        <p style={{ fontFamily: F, fontSize: 12.5, color: muted, lineHeight: 1.5 }}>{t('receive_hint')}</p>
      </div>
    </div>
  )
}

// ── privacy (encrypt / decrypt OCT) ──────────────────────────────────────────
function PrivacyView({ acct, back, setErr }: { acct: AccountView; back: () => void; setErr: (s: string) => void }) {
  const t = useT()
  const [snap, setSnap] = useState<{ public: bigint; private: bigint | null } | null>(null)
  const [tab, setTab] = useState<'encrypt' | 'decrypt'>('encrypt')
  const [amt, setAmt] = useState(''); const [ou, setOu] = useState('1000000')
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [txLink, setTxLink] = useState('')
  const load = async () => {
    try { const { url } = await api.getNetwork(); const { readPrivateBalance } = await import('./pvac'); setSnap(await readPrivateBalance(acct.address, url)) } catch { /* */ }
  }
  useEffect(() => { load() }, [acct.address])
  const fmt = (b: bigint | null) => b == null ? '—' : (Number(b) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const run = async () => {
    setErr(''); setMsg(''); setTxLink('')
    const v = Number(amt)
    if (!(v > 0)) return setErr(t('enter_amount'))
    const micro = BigInt(Math.round(v * 1e6))
    const gas = String(Math.max(1_000_000, Number(ou) || 1_000_000))   // minimum gas for privacy ops
    setBusy(true)
    try {
      const { url } = await api.getNetwork()
      const pvac = await import('./pvac')
      let h: string
      if (tab === 'encrypt') { setMsg(t('encrypting')); h = await pvac.shield(acct.address, micro, gas) }
      else { setMsg(t('decrypting')); h = await pvac.unshield(acct.address, micro, url, gas) }
      const base = url.includes('devnet') ? 'https://devnet.octrascan.io' : 'https://octrascan.io'
      setMsg(tab === 'encrypt' ? 'encrypt submitted, confirming…' : 'decrypt submitted, confirming…')
      setTxLink(`${base}/tx.html?hash=${h}`)
      setAmt(''); setTimeout(load, 6000)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setMsg('') } finally { setBusy(false) }
  }
  const avail = tab === 'encrypt' ? snap?.public : snap?.private
  return (
    <div>
      <TopBar title={t('privacy')} back={back} />
      <div style={pad}>
        <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '10px 12px', display: 'flex', justifyContent: 'space-between' }}>
          <div><div style={{ fontFamily: F, fontSize: 11, color: muted }}>{t('public')}</div><div style={{ fontFamily: M, fontSize: 14, color: ink }}>{snap ? fmt(snap.public) : '…'} OCT</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontFamily: F, fontSize: 11, color: muted }}>{t('private')}</div><div style={{ fontFamily: M, fontSize: 14, color: ink }}>{snap ? fmt(snap.private) : '…'} OCT</div></div>
        </div>
        <div style={{ display: 'flex', borderBottom: `1px solid ${border}` }}>
          {(['encrypt', 'decrypt'] as const).map(tb => <button key={tb} onClick={() => { setTab(tb); setMsg(''); setAmt('') }} style={{ flex: 1, fontFamily: F, fontSize: 13, color: tab === tb ? ink : muted, background: 'none', border: 'none', borderBottom: tab === tb ? `2px solid ${accent}` : '2px solid transparent', padding: '9px 0', cursor: 'pointer' }}>{t(tb)}</button>)}
        </div>
        <p style={{ fontFamily: F, fontSize: 12, color: muted, lineHeight: 1.5, margin: 0 }}>
          {tab === 'encrypt' ? t('encrypt_hint') : t('decrypt_hint')}
        </p>
        <div style={label}>{t('amount')} (OCT){avail != null && <span style={{ color: muted }}> · {t('max')} {fmt(avail)}</span>}</div>
        <input style={input} value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.0" inputMode="decimal" />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontFamily: F, fontSize: 11, color: muted }}>{t('gas')}</span>
          <input style={{ ...input, flex: 1 }} value={ou} onChange={e => setOu(e.target.value)} />
        </div>
        <button style={{ ...btn, opacity: busy ? .6 : 1 }} disabled={busy} onClick={run}>{busy ? (tab === 'encrypt' ? t('encrypting') : t('decrypting')) : t(tab)}</button>
        {msg && <div style={{ fontFamily: F, fontSize: 11.5, color: muted, wordBreak: 'break-all' }}>{msg}</div>}
        {txLink && <a href={txLink} target="_blank" rel="noopener noreferrer" style={{ fontFamily: M, fontSize: 11, color: accent, wordBreak: 'break-all', textDecoration: 'underline' }}>view transaction on explorer</a>}
      </div>
    </div>
  )
}

// ── defi (LP positions in Factory) ───────────────────────────────────────────
function DefiView({ acct, back }: { acct: AccountView; back: () => void }) {
  const t = useT()
  const [pos, setPos] = useState<{ pool: string; sym0: string; sym1: string; fee: number; amount0: string; amount1: string; owed0: string; owed1: string; inRange: boolean }[] | null>(null)
  useEffect(() => { api.lpPositions(acct.address).then(setPos).catch(() => setPos([])) }, [acct.address])
  const fmt = (b: string) => (Number(b) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const Row = ({ k, v }: { k: string; v: ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: M, fontSize: 11.5, color: muted, marginTop: 2 }}><span>{k}</span><span style={{ color: ink }}>{v}</span></div>
  )
  return (
    <div>
      <TopBar title={t('defi_liquidity')} back={back} />
      <div style={{ padding: '4px 0' }}>
        {pos === null ? <div style={{ ...pad, color: muted, fontFamily: F }}>{t('loading_positions')}</div>
          : pos.length === 0 ? <div style={{ ...pad, color: muted, fontFamily: F }}>{t('no_positions')}</div>
            : pos.map((p, i) => (
              <div key={p.pool + i} style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontFamily: F, fontSize: 14, color: ink }}>{p.sym0} / {p.sym1} <span style={{ fontFamily: M, fontSize: 11, color: muted }}>{(p.fee / 10000).toFixed(2)}%</span></span>
                  <span style={{ fontFamily: F, fontSize: 10.5, padding: '2px 7px', borderRadius: 2, color: p.inRange ? '#2f6f4f' : '#9a6a3b', background: p.inRange ? '#e7f3ec' : '#f6ecdf' }}>{p.inRange ? t('in_range') : t('out_of_range')}</span>
                </div>
                <Row k={p.sym0} v={`${fmt(p.amount0)}`} />
                <Row k={p.sym1} v={`${fmt(p.amount1)}`} />
                {(p.owed0 !== '0' || p.owed1 !== '0') && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: M, fontSize: 11.5, color: muted, marginTop: 4 }}>
                    <span>{t('unclaimed_fees')}</span><span style={{ color: '#3b7f5a' }}>{fmt(p.owed0)} {p.sym0} · {fmt(p.owed1)} {p.sym1}</span>
                  </div>
                )}
                <a href="https://app.factory-amm.xyz/positions" target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontFamily: F, fontSize: 11, color: accent, textDecoration: 'none' }}>{t('manage_position')}</a>
              </div>
            ))}
      </div>
    </div>
  )
}

// ── activity ─────────────────────────────────────────────────────────────────
function ActivityView({ acct, back }: { acct: AccountView; back: () => void }) {
  const t = useT()
  const [txs, setTxs] = useState<any[] | null>(null)
  const [base, setBase] = useState('https://devnet.octrascan.io')
  useEffect(() => {
    api.activity(acct.address).then(setTxs).catch(() => setTxs([]))
    api.getNetwork().then(n => setBase(n.url.includes('devnet') ? 'https://devnet.octrascan.io' : 'https://octrascan.io')).catch(() => { /* */ })
  }, [acct.address])
  // Map a raw tx to a label and the OCT amount it moved. `call` carries the method in
  // encrypted_data; `multi_exec` carries sub-calls in message, from which swap/liquidity is
  // inferred, using the first non-zero sub-call amount as the value.
  const ML: Record<string, string> = {
    exact_input_single: 'swap', exact_output_single: 'swap', exact_input: 'swap', exact_output: 'swap', swap: 'swap',
    deposit: 'wrap OCT', withdraw: 'unwrap OCT', transfer: 'token transfer', grant: 'approve', approve: 'approve',
    add_liquidity: 'add liquidity', mint_position: 'add liquidity', increase_liquidity: 'add liquidity',
    remove_liquidity: 'remove liquidity', decrease_liquidity: 'remove liquidity', burn: 'remove liquidity',
    collect: 'collect fees', collect_fees: 'collect fees', claim_from_pool: 'claim',
  }
  const describe = (tx: any): { label: string; micro: number; sign: string } => {
    const op = tx.op_type, mine = tx.from === acct.address, mv = Number(tx.amount || 0)
    if (op === 'standard') return { label: mine ? t('send').toLowerCase() : t('receive').toLowerCase(), micro: mv, sign: mine ? '-' : '+' }
    if (op === 'encrypt') return { label: 'encrypt', micro: mv, sign: '' }
    if (op === 'decrypt') return { label: 'decrypt', micro: mv, sign: '' }
    if (op === 'deploy') return { label: 'deploy', micro: 0, sign: '' }
    if (op === 'call') { const m = String(tx.encrypted_data || 'call'); return { label: ML[m] || m.replace(/_/g, ' '), micro: mv, sign: '' } }
    if (op === 'multi_exec') {
      let calls: any[] = []; try { calls = (JSON.parse(tx.message || '{}').calls) || [] } catch { /* */ }
      const ms = calls.map(c => String(c.method))
      const has = (...x: string[]) => ms.some(y => x.includes(y))
      const label = has('exact_input_single', 'exact_output_single', 'exact_input', 'exact_output', 'swap') ? 'swap'
        : has('add_liquidity', 'mint_position', 'increase_liquidity') ? 'add liquidity'
        : has('remove_liquidity', 'decrease_liquidity', 'burn') ? 'remove liquidity'
        : has('collect', 'collect_fees') ? 'collect fees' : `batch · ${calls.length}`
      let micro = 0; for (const c of calls) { const a = Number(c.amount || 0); if (a > 0) { micro = a; break } }
      return { label, micro, sign: '' }
    }
    return { label: op || 'tx', micro: mv, sign: '' }
  }
  const fmtDate = (ts: any) => { const n = Number(ts); if (!n) return ''; const d = new Date(n * 1000); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }
  const fmtOct = (micro: any) => (Number(micro || 0) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const shortHash = (h: string) => h ? h.slice(0, 8) + '…' + h.slice(-6) : ''
  return (
    <div>
      <TopBar title={t('activity')} back={back} />
      <div style={{ padding: '4px 0' }}>
        {txs === null ? <div style={{ ...pad, color: muted, fontFamily: F }}>{t('loading')}</div>
          : txs.length === 0 ? <div style={{ ...pad, color: muted, fontFamily: F }}>{t('no_tx')}</div>
            : txs.map((tx, i) => {
              const { label, micro, sign } = describe(tx)
              return (
                <div key={tx.hash || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderBottom: `1px solid ${border}`, background: '#fff' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: F, fontSize: 13.5, color: ink, textTransform: 'capitalize' }}>{label}</div>
                    <a href={`${base}/tx.html?hash=${tx.hash}`} target="_blank" rel="noopener noreferrer" title={tx.hash} style={{ fontFamily: M, fontSize: 11, color: accent, textDecoration: 'none' }}>{shortHash(String(tx.hash || ''))}</a>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                    {micro > 0 && <div style={{ fontFamily: M, fontSize: 13, color: sign === '+' ? '#3b7f5a' : ink }}>{sign}{fmtOct(micro)} OCT</div>}
                    <div style={{ fontFamily: F, fontSize: 11, color: muted, whiteSpace: 'nowrap' }}>{fmtDate(tx.timestamp)}</div>
                  </div>
                </div>
              )
            })}
      </div>
    </div>
  )
}

// ── connected sites ──────────────────────────────────────────────────────────
function ConnectedView({ back, setErr }: { back: () => void; setErr: (s: string) => void }) {
  const [sites, setSites] = useState<{ origin: string; address: string }[] | null>(null)
  const load = () => { api.sites().then(setSites).catch(() => setSites([])) }
  useEffect(() => { load() }, [])
  const disconnect = async (origin: string) => { try { await api.revoke(origin); load() } catch (e) { setErr(String(e)) } }
  return (
    <div>
      <TopBar title="Connected sites" back={back} />
      <div style={{ padding: '4px 0' }}>
        {sites === null ? <div style={{ ...pad, color: muted, fontFamily: F }}>loading…</div>
          : sites.length === 0 ? <div style={{ ...pad, color: muted, fontFamily: F }}>no sites connected. connect from a dapp using window.octra.</div>
            : sites.map(s => (
              <div key={s.origin} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${border}`, background: '#fff' }}>
                <div>
                  <div style={{ fontFamily: F, fontSize: 13.5, color: ink, wordBreak: 'break-all' }}>{(() => { try { return new URL(s.origin).host } catch { return s.origin } })()}</div>
                  <div style={{ fontFamily: M, fontSize: 11, color: muted }}>{short(s.address)}</div>
                </div>
                <button onClick={() => disconnect(s.origin)} style={{ fontFamily: F, fontSize: 12, color: '#9a3b3b', background: 'none', border: `1px solid ${border}`, padding: '5px 10px', cursor: 'pointer' }}>disconnect</button>
              </div>
            ))}
      </div>
    </div>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,28,40,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', border: `1px solid ${border}`, width: '100%', maxWidth: 320, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: ink }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
const mErr: CSSProperties = { fontFamily: F, fontSize: 12, color: '#9a3b3b' }
const keyBox: CSSProperties = { fontFamily: M, fontSize: 11, color: ink, wordBreak: 'break-all', background: bg, border: `1px solid ${border}`, padding: 10, cursor: 'pointer' }

function ChangePwModal({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [nw2, setNw2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false)
  const submit = async () => {
    setErr('')
    if (nw.length < 12) return setErr('new password must be at least 12 characters')
    if (nw !== nw2) return setErr('passwords do not match')
    setBusy(true)
    try { await api.changePassword(cur, nw); setDone(true); setTimeout(onClose, 900) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return <ModalShell title="Change password" onClose={onClose}>
    {done ? <div style={{ fontFamily: F, fontSize: 13, color: '#3b7f5a' }}>password updated ✓</div> : <>
      {err && <div style={mErr}>{err}</div>}
      <input style={input} type="password" placeholder="current password" value={cur} onChange={e => setCur(e.target.value)} />
      <input style={input} type="password" placeholder="new password (min 12)" value={nw} onChange={e => setNw(e.target.value)} />
      <input style={input} type="password" placeholder="confirm new password" value={nw2} onChange={e => setNw2(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      <button style={{ ...btn, opacity: busy ? .6 : 1 }} disabled={busy} onClick={submit}>{busy ? '…' : 'change password'}</button>
    </>}
  </ModalShell>
}

function ExportKeyModal({ address, onClose }: { address: string; onClose: () => void }) {
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [key, setKey] = useState<{ hex: string; base64: string } | null>(null)
  const reveal = async () => { setErr(''); setBusy(true); try { setKey(await api.exportPrivateKey(address, pw)) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  return <ModalShell title="Export private key" onClose={onClose}>
    {key ? <>
      <div style={mErr}>never share this — anyone with it controls the account.</div>
      <div style={label}>hex</div>
      <div style={keyBox} onClick={() => navigator.clipboard?.writeText(key.hex)}>{key.hex}</div>
      <div style={label}>base64 (Octra)</div>
      <div style={keyBox} onClick={() => navigator.clipboard?.writeText(key.base64)}>{key.base64}</div>
      <div style={{ fontFamily: F, fontSize: 11, color: muted }}>tap a key to copy</div>
    </> : <>
      {err && <div style={mErr}>{err}</div>}
      <div style={{ fontFamily: F, fontSize: 13, color: muted, lineHeight: 1.5 }}>enter your password to reveal the private key of the current account.</div>
      <input style={input} type="password" placeholder="password" value={pw} autoFocus onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && reveal()} />
      <button style={{ ...btn, opacity: busy ? .6 : 1 }} disabled={busy} onClick={reveal}>{busy ? '…' : 'reveal'}</button>
    </>}
  </ModalShell>
}

// ── add account (choice: create / seed phrase / private key) ──────────────────
function AddAccountView({ onDone, back, setErr }: { onDone: (a: AccountView[]) => void; back: () => void; setErr: (s: string) => void }) {
  const [mode, setMode] = useState<'new' | 'mnemonic' | 'private'>('new')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      const a = mode === 'new' ? await api.addAccount('new') : await api.addAccount(mode, value.trim())
      onDone(a)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const tabs: { k: 'new' | 'mnemonic' | 'private'; label: string }[] = [{ k: 'new', label: 'Create' }, { k: 'mnemonic', label: 'Seed phrase' }, { k: 'private', label: 'Private key' }]
  return (
    <div>
      <TopBar title="Add account" back={back} />
      <div style={pad}>
        <div style={{ display: 'flex', borderBottom: `1px solid ${border}` }}>
          {tabs.map(t => <button key={t.k} onClick={() => { setMode(t.k); setValue(''); setErr('') }} style={{ flex: 1, fontFamily: F, fontSize: 12.5, color: mode === t.k ? ink : muted, background: 'none', border: 'none', borderBottom: mode === t.k ? `2px solid ${accent}` : '2px solid transparent', padding: '9px 0', cursor: 'pointer' }}>{t.label}</button>)}
        </div>
        {mode === 'new' && <p style={{ fontFamily: F, fontSize: 13, color: muted, lineHeight: 1.5 }}>create a brand new account from a fresh random key, added to your encrypted vault.</p>}
        {mode === 'mnemonic' && <>
          <div style={label}>seed phrase</div>
          <textarea style={{ ...input, fontFamily: F, minHeight: 80, resize: 'none' } as CSSProperties} value={value} onChange={e => setValue(e.target.value)} placeholder="twelve or twenty-four words…" autoFocus />
        </>}
        {mode === 'private' && <>
          <div style={label}>private key</div>
          <textarea style={{ ...input, minHeight: 64, resize: 'none' } as CSSProperties} value={value} onChange={e => setValue(e.target.value)} placeholder="hex (64 chars) or base64…" autoFocus />
        </>}
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>{busy ? 'working…' : mode === 'new' ? 'create account' : 'import account'}</button>
      </div>
    </div>
  )
}

// ── settings ─────────────────────────────────────────────────────────────────
function SettingsView({ accounts, sel, setSel, setAccounts, back, onLock, onReset, setErr, openConnected, openAddAccount }:
  { accounts: AccountView[]; sel: number; setSel: (n: number) => void; setAccounts: (a: AccountView[]) => void; back: () => void; onLock: () => void; onReset: () => void; setErr: (s: string) => void; openConnected: (from: View) => void; openAddAccount: (from: View) => void }) {
  const t = useT()
  const { lang, setLang } = useLang()
  const [net, setNet] = useState<{ url: string; networks: { name: string; url: string }[] }>({ url: '', networks: [] })
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [modal, setModal] = useState<'pw' | 'export' | 'reset' | null>(null)
  const doRemove = async () => {
    const address = confirmDel; setConfirmDel(null); if (!address) return
    try { const a = await api.removeAccount(address); setAccounts(a); setSel(0) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  const [lockMin, setLockMin] = useState(15)
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const version = (() => { try { return chrome.runtime.getManifest().version } catch { return '0.0.0' } })()

  useEffect(() => { api.getNetwork().then(setNet).catch(() => { /* */ }); api.getAutoLock().then(r => setLockMin(r.minutes)).catch(() => { /* */ }) }, [])

  const sec: CSSProperties = { ...label, marginTop: 4 }
  const card: CSSProperties = { background: '#fff', border: `1px solid ${border}` }
  const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${border}` }

  return (
    <div>
      <TopBar title={t('settings')} back={back} />
      <div style={{ ...pad, gap: 16 }}>
        {/* accounts */}
        <div>
          <div style={sec}>{t('accounts')}</div>
          <div style={{ ...card, marginTop: 8 }}>
            {accounts.map((a, i) => (
              <div key={a.address} style={{ ...row, borderBottom: i === accounts.length - 1 ? 'none' : `1px solid ${border}` }}>
                {editing === a.address ? (
                  <input autoFocus style={{ ...input, padding: '6px 8px' }} value={name} onChange={e => setName(e.target.value)}
                    onBlur={async () => { try { setAccounts(await api.renameAccount(a.address, name)); } catch (e) { setErr(String(e)) } setEditing(null) }}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                ) : (
                  <button onClick={() => setSel(i)} style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', flex: 1 }}>
                    <div style={{ fontFamily: F, fontSize: 13.5, color: ink }}>{a.label} {i === sel && <span style={{ color: accent, fontSize: 11 }}>· {t('active')}</span>}</div>
                    <div style={{ fontFamily: M, fontSize: 11, color: muted }}>{short(a.address)}</div>
                  </button>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setEditing(a.address); setName(a.label) }} title="rename" style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, display: 'flex' }}><Ic d={ICONS.edit} size={16} /></button>
                  {accounts.length > 1 && <button onClick={() => setConfirmDel(a.address)} title="remove account" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b06a6a', display: 'flex' }}><Ic d={ICONS.trash} size={16} /></button>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => openAddAccount('settings')}
            style={{ ...btn, marginTop: 8, background: 'transparent', color: accent, border: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Ic d={ICONS.plus} size={16} /> {t('add_account')}
          </button>
        </div>

        {/* network */}
        <div>
          <div style={sec}>{t('network_rpc')}</div>
          <div style={{ marginTop: 8 }}>
            <Select value={net.url} onChange={async e => { try { await api.setNetwork(e.target.value); setNet({ ...net, url: e.target.value }) } catch (er) { setErr(String(er)) } }}>
              {net.networks.map(n => <option key={n.url} value={n.url}>{n.name}</option>)}
            </Select>
          </div>
        </div>

        {/* auto-lock */}
        <div>
          <div style={sec}>{t('auto_lock')}</div>
          <div style={{ marginTop: 8 }}>
            <Select value={lockMin} onChange={async e => { const m = Number(e.target.value); setLockMin(m); try { await api.setAutoLock(m) } catch (er) { setErr(String(er)) } }}>
              {[1, 5, 15, 30, 60].map(m => <option key={m} value={m}>{m} {t('minutes')}</option>)}
              <option value={0}>{t('never')}</option>
            </Select>
          </div>
        </div>

        {/* language */}
        <div>
          <div style={sec}>{t('language')}</div>
          <div style={{ marginTop: 8 }}>
            <Select value={lang} onChange={e => setLang(e.target.value as typeof lang)}>
              {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </Select>
          </div>
        </div>

        {/* security & backup */}
        <div>
          <div style={sec}>{t('security')}</div>
          <div style={{ ...card, marginTop: 8 }}>
            <button onClick={() => setModal('pw')} style={{ ...row, width: '100%', cursor: 'pointer', background: '#fff', border: 'none', borderBottom: `1px solid ${border}` }}>
              <span style={{ fontFamily: F, fontSize: 13.5, color: ink }}>{t('change_password')}</span><Ic d={ICONS.back} size={15} />
            </button>
            <button onClick={() => setModal('export')} style={{ ...row, width: '100%', cursor: 'pointer', background: '#fff', border: 'none', borderBottom: 'none' }}>
              <span style={{ fontFamily: F, fontSize: 13.5, color: ink }}>{t('export_private_key')}</span><Ic d={ICONS.back} size={15} />
            </button>
          </div>
        </div>

        {/* connected */}
        <button onClick={() => openConnected('settings')} style={{ ...row, ...card, width: '100%', cursor: 'pointer', color: ink, fontFamily: F, fontSize: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Ic d={ICONS.connected} size={16} /> {t('connected_sites')}</span>
          <Ic d={ICONS.back} size={16} />
        </button>

        <button style={{ ...btn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={onLock}>
          <Ic d={ICONS.lock} size={16} /> {t('lock_wallet')}
        </button>

        {/* danger zone */}
        <div>
          <div style={{ ...sec, color: '#9a3b3b' }}>{t('danger_zone')}</div>
          <button onClick={() => setModal('reset')} style={{ ...btn, marginTop: 8, background: 'transparent', color: '#9a3b3b', border: '1px solid #e0b0b0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Ic d={ICONS.trash} size={16} /> {t('reset_wallet')}
          </button>
        </div>

        <div style={{ textAlign: 'center', fontFamily: F, fontSize: 12, color: muted }}>factory wallet · v{version} · Octra</div>
      </div>
      {confirmDel && <ConfirmModal title="Remove account?" body="It will be removed from this wallet. Make sure you have its seed phrase or private key backed up first." confirmLabel="remove" onCancel={() => setConfirmDel(null)} onConfirm={doRemove} />}
      {modal === 'pw' && <ChangePwModal onClose={() => setModal(null)} />}
      {modal === 'export' && accounts[sel] && <ExportKeyModal address={accounts[sel].address} onClose={() => setModal(null)} />}
      {modal === 'reset' && <ConfirmModal title="Reset wallet?" body="This permanently wipes ALL wallet data on this device — accounts, keys, settings. Make sure every account's seed or private key is backed up. This cannot be undone." confirmLabel="reset everything" onCancel={() => setModal(null)} onConfirm={() => { setModal(null); onReset() }} />}
    </div>
  )
}

// ── onboarding / unlock (logo top-center, password below) ─────────────────────
function Brand() {
  return (
    <div style={{ textAlign: 'center', padding: '44px 0 8px' }}>
      <div style={{ fontFamily: F, fontSize: 30, fontWeight: 400, color: '#0D0D0D', letterSpacing: '0.01em' }}>factory wallet</div>
    </div>
  )
}

function Onboard({ onDone, setErr, err }: { onDone: (a: AccountView[]) => void; setErr: (s: string) => void; err: string }) {
  const t = useT()
  const [mode, setMode] = useState<'create' | 'import'>('create')
  const [impMode, setImpMode] = useState<'mnemonic' | 'private'>('mnemonic')
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [value, setValue] = useState(''); const [busy, setBusy] = useState(false)
  const [backup, setBackup] = useState<{ accounts: AccountView[]; mnemonic?: string; privateKey: string } | null>(null)
  const submit = async () => {
    setErr('')
    if (pw.length < 12) return setErr('password must be at least 12 characters')
    if (mode === 'create') {
      if (/^(?:password|12345678|qwerty|letmein|111111|000000|abc123)/i.test(pw) || /^(\d)\1+$/.test(pw)) return setErr('password is too common')
      if (pw !== pw2) return setErr('passwords do not match')
    } else if (!value.trim()) return setErr(impMode === 'mnemonic' ? 'enter your seed phrase' : 'enter your private key')
    setBusy(true)
    try {
      if (mode === 'create') {
        const accts = await api.create(pw)
        const sec = await api.getSecrets(accts[0]!.address).catch(() => ({ privateKey: '', mnemonic: undefined as string | undefined }))
        setBackup({ accounts: accts, mnemonic: sec.mnemonic, privateKey: sec.privateKey })
      } else {
        onDone(await api.importWallet(pw, impMode, value.trim()))
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const subTab = (m: 'mnemonic' | 'private', txt: string) => (
    <button key={m} onClick={() => { setImpMode(m); setValue('') }} style={{ flex: 1, fontFamily: F, fontSize: 12, color: impMode === m ? ink : muted, background: 'none', border: 'none', borderBottom: impMode === m ? `2px solid ${accent}` : '2px solid transparent', padding: '7px 0', cursor: 'pointer' }}>{txt}</button>
  )
  if (backup) return <BackupView data={backup} onContinue={() => onDone(backup.accounts)} />
  return (
    <div>
      <Brand />
      {err && <Banner text={err} />}
      <div style={pad}>
        <div style={{ display: 'flex', borderBottom: `1px solid ${border}` }}>
          <button onClick={() => setMode('create')} style={{ flex: 1, fontFamily: F, fontSize: 13, color: mode === 'create' ? ink : muted, background: 'none', border: 'none', borderBottom: mode === 'create' ? `2px solid ${accent}` : '2px solid transparent', padding: '9px 0', cursor: 'pointer' }}>{t('create')}</button>
          <button onClick={() => setMode('import')} style={{ flex: 1, fontFamily: F, fontSize: 13, color: mode === 'import' ? ink : muted, background: 'none', border: 'none', borderBottom: mode === 'import' ? `2px solid ${accent}` : '2px solid transparent', padding: '9px 0', cursor: 'pointer' }}>{t('importw')}</button>
        </div>
        {mode === 'import' && <>
          <div style={{ display: 'flex', borderBottom: `1px solid ${border}` }}>
            {subTab('mnemonic', 'seed phrase')}
            {subTab('private', 'private key')}
          </div>
          <textarea style={{ ...input, fontFamily: impMode === 'mnemonic' ? F : M, minHeight: 70, resize: 'none' } as CSSProperties} value={value} onChange={e => setValue(e.target.value)}
            placeholder={impMode === 'mnemonic' ? 'twelve or twenty-four words…' : 'private key (hex 64 chars or base64)…'} autoFocus />
        </>}
        <div style={label}>{t('password_min')}</div>
        <input style={input} type="password" value={pw} onChange={e => setPw(e.target.value)} />
        {mode === 'create' && <><div style={label}>{t('confirm_password')}</div><input style={input} type="password" value={pw2} onChange={e => setPw2(e.target.value)} /></>}
        <button style={{ ...btn, opacity: busy ? 0.6 : 1, marginTop: 4 }} disabled={busy} onClick={submit}>{busy ? '…' : mode === 'create' ? t('create_wallet') : t('import_wallet')}</button>
      </div>
    </div>
  )
}

function BackupView({ data, onContinue }: { data: { mnemonic?: string; privateKey: string }; onContinue: () => void }) {
  const t = useT()
  const [ack, setAck] = useState(false)
  const [copied, setCopied] = useState('')
  const copy = (s: string, what: string) => { try { navigator.clipboard.writeText(s); setCopied(what); setTimeout(() => setCopied(''), 1200) } catch { /* */ } }
  const words = (data.mnemonic ?? '').split(' ').filter(Boolean)
  const copyLink = (what: string, text: string) => <span onClick={() => copy(text, what)} style={{ color: accent, cursor: 'pointer' }}>{copied === what ? t('copied') : t('copy')}</span>
  return (
    <div>
      <Brand />
      <div style={pad}>
        <div style={{ fontFamily: F, fontSize: 16, color: ink, fontWeight: 600, marginBottom: 6 }}>{t('backup_title')}</div>
        <div style={{ fontFamily: F, fontSize: 12, color: '#9a3b3b', lineHeight: 1.5, marginBottom: 14 }}>{t('backup_warn')}</div>

        {words.length > 0 && <>
          <div style={{ ...label, display: 'flex', justifyContent: 'space-between' }}><span>{t('seed_phrase')}</span>{copyLink('seed', words.join(' '))}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, background: '#fff', border: `1px solid ${border}`, padding: 10, marginBottom: 14 }}>
            {words.map((w, i) => <div key={i} style={{ fontFamily: M, fontSize: 12, color: ink }}><span style={{ color: muted, marginRight: 4 }}>{i + 1}.</span>{w}</div>)}
          </div>
        </>}

        <div style={{ ...label, display: 'flex', justifyContent: 'space-between' }}><span>{t('private_key')}</span>{copyLink('pk', data.privateKey)}</div>
        <div style={{ fontFamily: M, fontSize: 11, color: ink, background: '#fff', border: `1px solid ${border}`, padding: 10, wordBreak: 'break-all', marginBottom: 14 }}>{data.privateKey}</div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontFamily: F, fontSize: 12, color: ink, cursor: 'pointer', marginBottom: 14 }}>
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 2 }} />
          <span>{t('backup_ack')}</span>
        </label>
        <button style={{ ...btn, opacity: ack ? 1 : 0.5, cursor: ack ? 'pointer' : 'not-allowed' }} disabled={!ack} onClick={onContinue}>{t('continue')}</button>
      </div>
    </div>
  )
}

function Unlock({ onDone, setErr, err }: { onDone: (a: AccountView[]) => void; setErr: (s: string) => void; err: string }) {
  const t = useT()
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false)
  const submit = async () => { setErr(''); setBusy(true); try { onDone(await api.unlock(pw)) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  return (
    <div style={{ minHeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
      <div style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ textAlign: 'center', fontFamily: F, fontSize: 30, fontWeight: 400, color: '#0D0D0D', letterSpacing: '0.01em', marginBottom: 4 }}>factory wallet</div>
        {err && <div style={{ background: '#f7e3e3', color: '#9a3b3b', fontFamily: F, fontSize: 12, padding: '8px 12px', textAlign: 'center' }}>{err}</div>}
        <div style={{ ...label, textAlign: 'center' }}>{t('enter_password')}</div>
        <input style={{ ...input, textAlign: 'center' }} type="password" value={pw} autoFocus onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>{busy ? t('unlocking') : t('unlock')}</button>
      </div>
    </div>
  )
}

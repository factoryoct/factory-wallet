import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRightLeft, Send as SendIcon, ArrowDownToLine, Clock, Link as LinkIcon, Droplet, Settings as SettingsIcon, Copy, Check, ChevronLeft, RefreshCw, Lock, Plus, Pencil, Globe, ChevronDown, HelpCircle, Trash2, Moon, Sun, X } from 'lucide-react'
import { getAvatarSync, onAvatarsChange, loadAvatar, setAvatar, pickAvatar } from '../avatar'
import { useTheme, setTheme } from './theme'
import { api, type AccountView } from './api'
import { ApprovalView, type ApprovalReq } from './Approval'
import { useT, useLang, LANGS } from './i18n'

const F = 'Tahoma, Arial, sans-serif'
const M = '"SF Mono", Consolas, Monaco, monospace'
// Theme colors as CSS variables (defined in index.html, flipped by [data-theme]). See popup/theme.ts.
const ink = 'var(--ink)', muted = 'var(--muted)', accent = 'var(--accent)', border = 'var(--border)', bg = 'var(--bg)'
const surface = 'var(--card)'
const FACTORY_FAUCET = 'https://factory-amm.xyz/faucet'

const onAccent = 'var(--on-accent)'
const btn: CSSProperties = { fontFamily: F, fontSize: 14, fontWeight: 600, color: onAccent, background: accent, border: 'none', padding: '11px 16px', cursor: 'pointer', width: '100%' }
const input: CSSProperties = { fontFamily: M, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, background: surface, width: '100%', outline: 'none' }
const pad: CSSProperties = { padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }
const label: CSSProperties = { fontFamily: F, fontSize: 12, color: muted, textTransform: 'capitalize', letterSpacing: 'normal' }
const short = (a: string) => a.slice(0, 8) + '…' + a.slice(-6)
const grad = 'var(--grad)'

const TOKEN_LOGOS: Record<string, string> = { OCT: '/oct.jpg', WOCT: '/oct.jpg', FACT: '/fact.png', COG: '/cog.png', SPRK: '/sprk.png', LUM: '/lum.png' }
function TokenImg({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const src = TOKEN_LOGOS[symbol]
  if (src) return <img src={src} width={size} height={size} alt={symbol} style={{ borderRadius: '50%', objectFit: 'cover', display: 'block', flexShrink: 0 }} />
  return <div style={{ width: size, height: size, borderRadius: '50%', background: bg, border: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: M, fontSize: size * 0.42, color: ink, flexShrink: 0 }}>{symbol[0]}</div>
}

// ICONS keeps string keys; Ic maps each key to its lucide component.
const LU: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; style?: CSSProperties }>> = {
  swap: ArrowRightLeft, send: SendIcon, receive: ArrowDownToLine, activity: Clock, connected: LinkIcon, faucet: Droplet,
  gear: SettingsIcon, copy: Copy, check: Check, back: ChevronLeft, refresh: RefreshCw, lock: Lock, plus: Plus, edit: Pencil, net: Globe, chevron: ChevronDown, trash: Trash2, privacy: Lock, defi: Droplet, moon: Moon, sun: Sun, close: X,
}
const ICONS: Record<string, string> = Object.fromEntries(Object.keys(LU).map(k => [k, k]))
function Ic({ d, size = 22 }: { d: string; size?: number }) {
  const C = LU[d] || HelpCircle
  return <C size={size} strokeWidth={1.9} style={{ display: 'block', flexShrink: 0 }} />
}

// Account avatar: the saved image if any, else the first letter of the label. Optionally tappable.
function Avatar({ address, label, size, bg = 'rgba(255,255,255,.2)', color = 'var(--on-accent)', onClick }: { address: string; label: string; size: number; bg?: string; color?: string; onClick?: () => void }) {
  const [url, setUrl] = useState<string | null>(getAvatarSync(address))
  useEffect(() => { setUrl(getAvatarSync(address)); loadAvatar(address); return onAvatarsChange(() => setUrl(getAvatarSync(address))) }, [address])
  const base: CSSProperties = { width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: onClick ? 'pointer' : 'default' }
  if (url) return <span onClick={onClick} style={base}><img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></span>
  return <span onClick={onClick} style={{ ...base, background: bg, color, fontFamily: F, fontSize: size * 0.46, fontWeight: 700 }}>{(label[0] || '?').toUpperCase()}</span>
}

// Custom dropdown styled to match the app (not the OS-native select).
function Select({ value, onChange, options }: { value: any; onChange: (v: any) => void; options: { value: any; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const cur = options.find(o => String(o.value) === String(value))
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{ ...input, fontFamily: F, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'left' } as CSSProperties}>
        <span style={{ color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cur ? cur.label : ''}</span>
        <ChevronDown size={16} style={{ color: muted, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && <>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
        <div style={{ position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 41, background: surface, border: `1px solid ${border}`, maxHeight: 244, overflowY: 'auto', boxShadow: '0 8px 22px rgba(0,0,0,.16)' }}>
          {options.map(o => (
            <button key={String(o.value)} type="button" onClick={() => { onChange(o.value); setOpen(false) }} style={{ width: '100%', textAlign: 'left', background: String(o.value) === String(value) ? bg : surface, border: 'none', borderBottom: `1px solid ${border}`, padding: '11px 12px', fontFamily: F, fontSize: 13, color: ink, cursor: 'pointer' }}>{o.label}</button>
          ))}
        </div>
      </>}
    </div>
  )
}

// Segmented selector: one shared track with a highlight that slides between options. The thumb
// position is driven by a local index updated instantly on tap, and the (possibly heavy) onChange
// is deferred a frame — so the slide animates smoothly even when onChange re-themes/re-translates.
function CapsuleSelect({ value, onChange, options }: { value: any; onChange: (v: any) => void; options: { value: any; label: string; icon?: string }[] }) {
  const n = options.length
  const valueIdx = Math.max(0, options.findIndex(o => String(o.value) === String(value)))
  const [idx, setIdx] = useState(valueIdx)
  useEffect(() => { setIdx(valueIdx) }, [valueIdx])
  // Move the highlight instantly (lightweight local state) and run the real change AFTER the slide
  // finishes — the heavy work (re-theme / re-translate) then never stutters the GPU animation. The
  // thumb uses a plain-% translate3d (no calc) on its own layer, like the bottom drawer's slide.
  const pick = (i: number, v: any) => { if (i === idx) return; setIdx(i); setTimeout(() => onChange(v), 250) }
  return (
    <div style={{ position: 'relative', display: 'flex', background: surface, borderRadius: 14, padding: 4 }}>
      <div style={{ position: 'absolute', top: 4, bottom: 4, left: 4, width: `calc((100% - 8px) / ${n})`, background: accent, borderRadius: 10, transform: `translate3d(${idx * 100}%, 0, 0)`, transition: 'transform .24s cubic-bezier(.4,0,.2,1)', willChange: 'transform', backfaceVisibility: 'hidden' }} />
      {options.map((o, i) => (
        <button key={String(o.value)} type="button" onClick={() => pick(i, o.value)}
          style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0, fontFamily: F, fontSize: 13, fontWeight: 600, color: i === idx ? onAccent : ink, background: 'transparent', border: 'none', padding: '13px 6px', cursor: 'pointer', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          {o.icon && <Ic d={o.icon} size={15} />}{o.label}
        </button>
      ))}
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
        <div style={{ position: 'absolute', top: -3, left: `${(hi / (data.length - 1)) * 100}%`, transform: `translateX(${hi < data.length / 2 ? '0' : '-100%'})`, fontFamily: M, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,.4)', padding: '1px 6px', borderRadius: 4, pointerEvents: 'none', whiteSpace: 'nowrap' }}>${data[hi] >= 1 ? data[hi].toFixed(2) : data[hi].toFixed(4)}</div>
      )}
    </div>
  )
}

type View = 'loading' | 'onboard' | 'locked' | 'dash' | 'send' | 'receive' | 'activity' | 'connected' | 'settings' | 'addaccount' | 'privacy' | 'defi' | 'swap' | 'approval'

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
  const [sendInitTok, setSendInitTok] = useState('')   // token preselected when opening Send from a token page
  const [swapInitTok, setSwapInitTok] = useState('')   // token preselected as "from" when opening Swap from a token page
  // While a manual unlock is in progress on the lock screen (incl. the post-unlock
  // "enable fingerprint?" prompt), suppress the self-heal poller below so it does not
  // race the Unlock component and yank the screen to the dashboard.
  const holdUnlock = useRef(false)

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
    // Popup: no splash. Resolve the destination and switch to it immediately.
    const go = (v: View) => { setView(v) }
    ;(async () => {
      // Retry status: when the popup window opens (e.g. to show an approval) the MV3 service
      // worker may be cold/busy and the first message can throw. NEVER fall back to the onboard
      // (create-wallet) screen on a transient error — that showed the registration screen
      // instead of the pending approval. Show 'locked' if the SW stays unreachable.
      let s: { hasVault: boolean; unlocked: boolean } | null = null
      for (let i = 0; i < 10 && !s; i++) {
        try { s = await api.status() } catch { await new Promise(r => setTimeout(r, 250)) }
      }
      if (!s) return go('locked')
      if (!s.hasVault) return go('onboard')
      if (!s.unlocked) return go('locked')
      try { await applyAccounts(await api.accounts()) } catch { /* */ }
      if (await checkApproval()) return   // pending approval → show it immediately, no splash hold
      go('dash')
    })()
  }, [])
  // Heartbeat so the background knows a popup is alive and need not open a separate window.
  useEffect(() => {
    const ping = () => { try { chrome.runtime.sendMessage({ __popupOpen: true }).catch(() => {}) } catch { /* */ } }
    ping()
    const t = setInterval(ping, 700)
    return () => clearInterval(t)
  }, [])
  // Surface a request that arrives while the dashboard is open.
  useEffect(() => {
    if (view !== 'dash') return
    const t = setInterval(() => { checkApproval() }, 2000)
    return () => clearInterval(t)
  }, [view])
  // Self-heal the unlock screen: the approval window can open while the service worker is
  // cold and briefly throws / reports locked, landing on the password screen even though the
  // wallet is unlocked. Keep polling; the moment the SW confirms it is unlocked, advance to
  // the pending approval (or dashboard) automatically — no spurious password prompt.
  useEffect(() => {
    if (view !== 'locked') return
    const t = setInterval(async () => {
      if (holdUnlock.current) return   // user is unlocking here; let Unlock drive navigation
      try {
        const s = await api.status()
        if (s.unlocked) {
          try { await applyAccounts(await api.accounts()) } catch { /* */ }
          if (!(await checkApproval())) setView('dash')
        }
      } catch { /* keep waiting for the SW */ }
    }, 1000)
    return () => clearInterval(t)
  }, [view])
  useEffect(() => { if (view === 'dash' && !accounts.length) api.accounts().then(applyAccounts).catch(() => {}) }, [view, accounts.length])
  // Persist the selected account whenever it changes.
  useEffect(() => { const a = accounts[sel]; if (a) api.setSelected(a.address).catch(() => {}) }, [sel])
  // Auto-dismiss errors: the toast should appear and fade away on its own, not hang at the top.
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(''), 4000); return () => clearTimeout(t) }, [err])

  const acct = accounts[Math.min(sel, Math.max(0, accounts.length - 1))]
  const go = (v: View) => { setErr(''); setView(v) }
  // One step back: nested screens return to where they were opened from, the rest to the dashboard.
  const goBack = () => {
    if (view === 'addaccount') return go(addBack)
    if (view === 'connected') return go(connBack)
    if (view !== 'dash' && view !== 'onboard' && view !== 'locked' && view !== 'loading') go('dash')
  }
  const swStart = useRef<{ x: number; y: number } | null>(null)

  // Open explorer / dapp links in a new browser tab.
  const open = (url: string) => { window.open(url, '_blank') }
  const openConnected = (from: View) => { setConnBack(from); go('connected') }
  const openAddAccount = (from: View) => { setAddBack(from); go('addaccount') }

  let content: ReactNode = null
  if (view === 'loading') content = <div style={{ minHeight: '100vh', background: bg }} />
  else if (view === 'onboard') content = <Onboard onDone={a => { applyAccounts(a); go('dash') }} setErr={setErr} err={err} />
  else if (view === 'locked') content = <Unlock onDone={async a => { holdUnlock.current = false; await applyAccounts(a); if (!(await checkApproval())) go('dash') }} onHold={v => { holdUnlock.current = v }} setErr={setErr} err={err} />
  else if (view === 'approval' && approval) content = <ApprovalView req={approval} accounts={accounts} selDefault={sel} onDone={async () => { setApproval(null); if (!(await checkApproval())) { try { window.close() } catch { /* */ } go('dash') } }} />
  else if (!acct) content = <div style={{ ...pad, color: muted, fontFamily: F }}>no account</div>
  else if (view === 'dash') content = <Dashboard acct={acct} accounts={accounts} sel={sel} setSel={setSel} setAccounts={setAccounts} go={go} open={open} openConnected={openConnected} openAddAccount={openAddAccount} setErr={setErr} openSendToken={(addr: string) => { setSendInitTok(addr); go('send') }} openSwap={(addr: string) => { setSwapInitTok(addr); go('swap') }} />
  else if (view === 'send') content = <SendView acct={acct} back={() => go('dash')} setErr={setErr} initialToken={sendInitTok} />
  else if (view === 'swap') content = <SwapView acct={acct} back={() => go('dash')} setErr={setErr} initialToken={swapInitTok} />
  else if (view === 'receive') content = <ReceiveView acct={acct} back={() => go('dash')} />
  else if (view === 'privacy') content = <PrivacyView acct={acct} back={() => go('dash')} setErr={setErr} />
  else if (view === 'defi') content = <DefiView acct={acct} back={() => go('dash')} />
  else if (view === 'activity') content = <ActivityView acct={acct} back={() => go('dash')} />
  else if (view === 'connected') content = <ConnectedView back={() => go(connBack)} setErr={setErr} />
  else if (view === 'addaccount') content = <AddAccountView onDone={a => { setAccounts(a); setSel(a.length - 1); go(addBack) }} back={() => go(addBack)} setErr={setErr} />
  else if (view === 'settings') content = <SettingsView accounts={accounts} sel={sel} setSel={setSel} setAccounts={setAccounts} back={() => go('dash')} onLock={() => { go('locked'); import('./pvac').then(m => m.clearPvac()).catch(() => {}); api.lock().catch(() => {}) }} onReset={async () => { try { await api.reset() } catch { /* */ } try { await disableBiometric() } catch { /* */ } setAccounts([]); setSel(0); go('onboard') }} setErr={setErr} openConnected={openConnected} openAddAccount={openAddAccount} />

  return (
    <div
      onTouchStart={e => { swStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
      onTouchEnd={e => {
        const s = swStart.current; swStart.current = null
        if (!s) return
        const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y
        if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) goBack()   // left-to-right swipe = back
      }}
      style={{ minHeight: '100vh', background: bg }}>
      {err && view !== 'onboard' && view !== 'locked' && <Banner text={err} />}
      <Boundary key={view} onReset={() => setView('dash')}><div className="fw-fade">{content}</div></Boundary>
    </div>
  )
}

// Floating toast: overlays the screen (position: fixed) so it never takes layout space or pushes
// content / introduces scroll. Fades in; auto-dismissed by the timer in App.
const Banner = ({ text }: { text: string }) => (
  <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, display: 'flex', justifyContent: 'center', pointerEvents: 'none', padding: 'calc(0px + 16px) 12px 0' }}>
    <div className="fw-fade" style={{ maxWidth: '88%', background: '#d64545', color: '#fff', fontFamily: F, fontSize: 14, fontWeight: 600, lineHeight: 1.4, padding: '12px 20px', borderRadius: 0, boxShadow: '0 6px 22px rgba(0,0,0,0.28)', textAlign: 'center' }}>{text}</div>
  </div>
)

// In-popup confirm dialog.
function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(20,28,40,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: surface, border: `1px solid ${border}`, width: '100%', maxWidth: 300, padding: 18 }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(13px + 0px) 16px 13px', borderBottom: `1px solid ${border}`, background: surface }}>
      {back && <button onClick={back} style={{ background: 'none', border: 'none', cursor: 'pointer', color: ink, display: 'flex' }}><Ic d={ICONS.back} size={20} /></button>}
      <span style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: ink, flex: 1 }}>{title}</span>
    </div>
  )
}

// ── dashboard ────────────────────────────────────────────────────────────────
// ── token detail page (price chart + swap/send/receive) ──────────────────────
function TokenDetail({ tk, usdPrice, chartData, change24h, nativeMcap, nativeVol, onBack, onSend, onReceive, onSwap }: {
  tk: { symbol: string; balance: string; native: boolean; address: string }
  usdPrice: number; chartData: number[]; change24h?: number; nativeMcap?: number; nativeVol?: number
  onBack: () => void; onSend: () => void; onReceive: () => void; onSwap: () => void
}) {
  const fmt = (b: string) => Number(b).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const usdValue = Number(tk.balance || 0) * usdPrice
  // Real price history (USD) when we have it; otherwise a flat line at the current price.
  const data = chartData && chartData.length >= 2 ? chartData : (usdPrice > 0 ? [usdPrice, usdPrice] : [])
  const wbtn: CSSProperties = { background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }
  // On-chain total_supply (micro units) for OCS-01 tokens → market cap. Native OCT uses CoinGecko.
  const [supply, setSupply] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [net, setNet] = useState('')
  useEffect(() => {
    if (tk.native) { setSupply(null); return }
    let alive = true
    api.tokenSupply(tk.address).then(s => { if (alive) setSupply(s ? Number(s) / 1e6 : null) }).catch(() => { if (alive) setSupply(null) })
    return () => { alive = false }
  }, [tk.address, tk.native])
  useEffect(() => { api.getNetwork().then(n => setNet(n.url)).catch(() => { /* */ }) }, [])
  // Identical metric set for native OCT and tokens. Native derives circulating supply ≈ mcap / price;
  // tokens read total_supply on-chain. (change24h / nativeVol are still accepted for callers but the
  // header keeps the same four rows for every token so they read consistently.)
  void change24h; void nativeVol
  const mcap = tk.native ? (nativeMcap && nativeMcap > 0 ? nativeMcap : null) : (supply != null && usdPrice > 0 ? supply * usdPrice : null)
  const compact = (n: number) => n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + n.toFixed(0)
  const compactN = (n: number) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  const totalSupply = tk.native ? (mcap != null && usdPrice > 0 ? mcap / usdPrice : null) : supply
  const supplyLoading = !tk.native && supply == null
  const stats: { k: string; v: ReactNode }[] = [
    { k: 'price', v: usdPrice > 0 ? (usdPrice < 1 ? '$' + usdPrice.toFixed(6) : '$' + usdPrice.toFixed(4)) : '—' },
    { k: 'market cap', v: mcap != null ? compact(mcap) : (supplyLoading ? '…' : '—') },
    { k: 'total supply', v: totalSupply != null ? compactN(totalSupply) : (supplyLoading ? '…' : '—') },
    { k: 'your value', v: usdPrice > 0 ? '$' + usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—' },
  ]
  const actions = [
    { key: 'swap', label: 'swap', disabled: false, onClick: onSwap },
    { key: 'send', label: 'send', disabled: false, onClick: onSend },
    { key: 'receive', label: 'receive', disabled: false, onClick: onReceive },
  ]
  const sw = useRef<{ x: number; y: number } | null>(null)
  return (
    <div
      onTouchStart={e => { sw.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
      onTouchEnd={e => { const s = sw.current; sw.current = null; if (!s) return; const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y; if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) onBack() }}
      style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: bg }}>
      <div style={{ flexShrink: 0, padding: 'calc(0px + 8px) 14px 0' }}>
      <div style={{ background: grad, color: '#fff', padding: '12px 16px 13px', borderRadius: 16, border: `1px solid ${border}`, boxShadow: '0 2px 10px rgba(20,28,40,.10)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} title="back" style={wbtn}><Ic d={ICONS.back} size={22} /></button>
          <TokenImg symbol={tk.symbol} size={24} />
          <span style={{ fontFamily: F, fontSize: 17, fontWeight: 700 }}>{tk.symbol}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
          <span style={{ fontFamily: M, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{fmt(tk.balance)}</span>
          <span style={{ fontFamily: F, fontSize: 13, opacity: .8, paddingBottom: 3 }}>{tk.symbol}</span>
        </div>
        <div style={{ marginTop: 8 }}><Spark data={data} h={58} /></div>
        {/* token stats — keep the header dense so it doesn't feel empty */}
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
          {stats.map(s => (
            <div key={s.k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: F, fontSize: 10.5, letterSpacing: .2, textTransform: 'capitalize', opacity: .6 }}>{s.k}</span>
              <span style={{ fontFamily: M, fontSize: 13, fontWeight: 600 }}>{s.v}</span>
            </div>
          ))}
        </div>
      </div>
      </div>
      <div style={{ flexShrink: 0, background: bg }}>
        <div className="fw-actiongrid" style={{ padding: '10px 14px' }}>
          {actions.map(a => (
            <button key={a.key} className="fw-actioncell" disabled={a.disabled} onClick={a.onClick} title={a.disabled ? 'coming soon' : ''} style={{ cursor: a.disabled ? 'not-allowed' : 'pointer', color: a.disabled ? muted : accent, opacity: a.disabled ? .5 : 1 }}>
              <Ic d={ICONS[a.key]} size={23} />
              <span style={{ fontFamily: F, fontSize: 12.5, color: a.disabled ? muted : ink }}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
      {/* useful info filling the space below the actions */}
      <div style={{ flex: 1, background: bg, padding: '0 14px 16px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
        <div style={{ background: surface, borderRadius: 16, padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: F, fontSize: 10.5, letterSpacing: .2, textTransform: 'capitalize', color: muted }}>your holdings</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: M, fontSize: 20, fontWeight: 700, color: ink }}>{fmt(tk.balance)}</span>
            <span style={{ fontFamily: F, fontSize: 13, color: muted }}>{tk.symbol}</span>
          </div>
          {usdPrice > 0 && <span style={{ fontFamily: F, fontSize: 13, color: '#3b7f5a' }}>${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
        </div>
        <div style={{ background: surface, borderRadius: 16, padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <span style={{ fontFamily: F, fontSize: 10.5, letterSpacing: .2, textTransform: 'capitalize', color: muted }}>about {tk.symbol}</span>
          {/* same fields for native OCT and tokens so every coin reads consistently */}
          <InfoRow k="network" v={net.includes('octra.network') ? 'Octra mainnet' : 'Octra devnet'} />
          <InfoRow k="standard" v={tk.native ? 'native coin' : 'OCS-01'} />
          <InfoRow k="decimals" v="6" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: F, fontSize: 12.5, color: muted, flexShrink: 0 }}>contract</span>
            {tk.native
              ? <span style={{ fontFamily: M, fontSize: 12.5, color: ink }}>native</span>
              : <span onClick={() => { navigator.clipboard?.writeText(tk.address); setCopied(true); setTimeout(() => setCopied(false), 1400) }}
                  style={{ fontFamily: M, fontSize: 12, color: accent, cursor: 'pointer', wordBreak: 'break-all', textAlign: 'right' }}>
                  {copied ? 'copied ✓' : tk.address}
                </span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ k, v }: { k: string; v: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontFamily: F, fontSize: 12.5, color: muted }}>{k}</span><span style={{ fontFamily: M, fontSize: 12.5, color: ink }}>{v}</span></div>
}

// Per-account cached dashboard snapshot so a remount (every view change) shows data instantly.
type DashSnap = {
  bal?: string | null
  tokens?: { symbol: string; balance: string; native: boolean; address: string }[]
  tokPrices?: Record<string, number>
  tokChg?: Record<string, number>
  tokShielded?: Record<string, bigint | null>
  price?: { usd: number; change24h: number; mcap?: number; vol?: number } | null
  chart?: number[]
  priv?: { public: bigint; private: bigint | null } | null
}
const dashCache: Record<string, DashSnap> = {}

function Dashboard({ acct, accounts, sel, setSel, setAccounts, go, open, openConnected, openAddAccount, setErr, openSendToken, openSwap }:
  { acct: AccountView; accounts: AccountView[]; sel: number; setSel: (n: number) => void; setAccounts: (a: AccountView[]) => void; go: (v: View) => void; open: (u: string) => void; openConnected: (from: View) => void; openAddAccount: (from: View) => void; setErr: (s: string) => void; openSendToken: (addr: string) => void; openSwap: (addr: string) => void }) {
  const [tokDetail, setTokDetail] = useState<{ symbol: string; balance: string; native: boolean; address: string } | null>(null)
  const [tokSeries, setTokSeries] = useState<number[]>([])   // OCT-per-token price history for the open token
  useEffect(() => {
    if (!tokDetail || tokDetail.native) { setTokSeries([]); return }
    api.priceSeries(tokDetail.address).then(setTokSeries).catch(() => setTokSeries([]))
  }, [tokDetail])
  const t = useT()
  // Cached snapshot (module-level, per account): the Dashboard remounts on every view change, so we
  // seed its state from the last-known data and show it INSTANTLY, then refresh() updates in the
  // background. No more "…" / blank flash when returning from the browser or another screen.
  const cache = (dashCache[acct.address] ||= {})
  const [bal, setBalS] = useState<string | null>(cache.bal ?? null)
  const setBal = (v: string | null) => { cache.bal = v; setBalS(v) }
  const [tokens, setTokensS] = useState<{ symbol: string; balance: string; native: boolean; address: string; confidential?: boolean; privCipher?: string }[]>(cache.tokens ?? [])
  const setTokens = (v: { symbol: string; balance: string; native: boolean; address: string; confidential?: boolean; privCipher?: string }[]) => { cache.tokens = v; setTokensS(v) }
  const [tokShielded, setTokShieldedS] = useState<Record<string, bigint | null>>(cache.tokShielded ?? {})   // tokenAddr -> decrypted shielded balance
  const setTokShielded = (fn: (s: Record<string, bigint | null>) => Record<string, bigint | null>) => setTokShieldedS(s => { const n = fn(s); cache.tokShielded = n; return n })
  const [tokPrices, setTokPricesS] = useState<Record<string, number>>(cache.tokPrices ?? {})   // tokenAddr -> OCT per token
  const setTokPrices = (v: Record<string, number>) => { cache.tokPrices = v; setTokPricesS(v) }
  const [tokChg, setTokChg] = useState<Record<string, number>>(cache.tokChg ?? {})         // tokenAddr -> 24h % change
  const [price, setPriceS] = useState<{ usd: number; change24h: number; mcap?: number; vol?: number } | null>(cache.price ?? null)
  const setPrice = (v: { usd: number; change24h: number; mcap?: number; vol?: number } | null) => { cache.price = v; setPriceS(v) }
  const [chart, setChartS] = useState<number[]>(cache.chart ?? [])
  const setChart = (v: number[]) => { cache.chart = v; setChartS(v) }
  const [balMode, setBalMode] = useState<'oct' | 'usd'>('oct')   // header: OCT amount vs total USD value
  const [sites, setSites] = useState(0)
  const [menu, setMenu] = useState(false)
  const [net, setNet] = useState<{ url: string; networks: { name: string; url: string }[] }>({ url: '', networks: [] })
  const [adding, setAdding] = useState(false)
  const [tokAddr, setTokAddr] = useState('')
  const [tokQ, setTokQ] = useState('')
  // Collapsible action row (popup is short — let the user hide swap/send/etc. to give the asset list room).
  const [actsOpen, setActsOpen] = useState(() => { try { return localStorage.getItem('fw_acts_open') !== '0' } catch { return true } })
  const toggleActs = () => setActsOpen(v => { const n = !v; try { localStorage.setItem('fw_acts_open', n ? '1' : '0') } catch { /* */ } return n })
  const [copied, setCopied] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const manualRef = useRef(false)   // true only for a user pull-to-refresh, so background refreshes are silent
  const ptrStart = useRef<number | null>(null)           // pull-to-refresh drag origin
  const ptrStartX = useRef(0)
  const [ptrPull, setPtrPull] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)   // header horizontal swipe origin
  const [priv, setPrivS] = useState<{ public: bigint; private: bigint | null } | null>(cache.priv ?? null)
  const setPriv = (v: { public: bigint; private: bigint | null } | null) => { cache.priv = v; setPrivS(v) }
  const [privErr, setPrivErr] = useState('')
  const copyAddr = () => { navigator.clipboard?.writeText(acct.address); setCopied(true); setTimeout(() => setCopied(false), 1200) }
  const fmtMicro = (b: bigint | null) => b == null ? '—' : (Number(b) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const loadPriv = async () => {
    setPrivErr('')
    try {
      const { url } = await api.getNetwork()
      const { readPrivateBalance } = await import('./pvac')
      setPriv(await readPrivateBalance(acct.address, url))
    } catch (e) { setPrivErr(e instanceof Error ? e.message : String(e)) }
  }
  // Seed from this account's cached private balance (instant), then refresh — don't blank it on mount.
  useEffect(() => { setPriv(dashCache[acct.address]?.priv ?? null); setPrivErr(''); loadPriv() }, [acct.address, net.url])

  const loadTokens = () => api.tokens(acct.address).then(setTokens).catch(() => { /* */ })
  // Decrypt each confidential token's shielded balance off the UI thread so its row can show
  // public + shielded together. Keyed by cipher length so it re-runs when a balance changes.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { decryptTokenShielded } = await import('./pvac')
      for (const t of tokens) {
        if (!t.confidential) continue
        if (!t.privCipher) { if (alive) setTokShielded(s => ({ ...s, [t.address]: 0n })); continue }
        const v = await decryptTokenShielded(acct.address, t.address, t.privCipher)   // decrypt with the ACCOUNT key
        if (alive) setTokShielded(s => ({ ...s, [t.address]: v }))
      }
    })()
    return () => { alive = false }
  }, [acct.address, tokens.map(t => t.address + ':' + (t.privCipher ? t.privCipher.length : 0)).join(',')])
  const refresh = () => {
    setSpinning(true)
    Promise.all([
      api.balance(acct.address).then(b => setBal(b.balance)).catch(() => setBal('?')),
      loadTokens(),
      api.sites().then(s => setSites(s.length)).catch(() => { /* */ }),
      // pull fresh quotes (OCT price + token prices + chart) so values update too
      api.octPrice().then(setPrice).catch(() => { /* */ }),
      api.prices().then(setTokPrices).catch(() => { /* */ }),
      api.octChart().then(c => { if (c && c.length) setChart(c) }).catch(() => { /* */ }),
      loadPriv(),
    ]).finally(() => setTimeout(() => { setSpinning(false); manualRef.current = false }, 500))
  }
  useEffect(() => { refresh() }, [acct.address])
  // 24h price change % per token — fetched async so the token list renders instantly (no lag). Native
  // OCT uses the header's change24h; tokens derive it from their OCT-per-token price series.
  useEffect(() => {
    let alive = true
    tokens.filter(tk => !tk.native).forEach(tk => {
      api.priceSeries(tk.address).then(s => {
        if (!alive || !s || s.length < 2 || !(s[0] > 0)) return
        setTokChg(prev => ({ ...prev, [tk.address]: (s[s.length - 1] / s[0] - 1) * 100 }))
      }).catch(() => { /* */ })
    })
    return () => { alive = false }
  }, [tokens.map(tk => tk.address).join(',')])
  useEffect(() => {
    api.octPrice().then(setPrice).catch(() => { /* */ })
    api.prices().then(setTokPrices).catch(() => { /* */ })
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

  const usd = price && price.usd > 0 ? '$' + (Number(bal || 0) * price.usd).toFixed(2) : null
  // Total portfolio value in USD. Only OCT is priced today, so unpriced tokens contribute 0; this is
  // a sum, ready to extend once other tokens get prices.
  const octUsd = price && price.usd > 0 ? price.usd : 0
  // USD price of one unit of a token: OCT itself = octUsd; others = (OCT per token) × octUsd.
  const tokenUsd = (tk: { native: boolean; address: string }) => tk.native ? octUsd : (tokPrices[tk.address] || 0) * octUsd
  // Total portfolio value = sum of every holding in USD (unpriced tokens contribute 0).
  const totalUsdNum = tokens.length
    ? tokens.reduce((s, tk) => s + Number(tk.balance || 0) * tokenUsd(tk), 0)
    : Number(bal || 0) * octUsd
  const totalUsd = octUsd > 0 ? '$' + totalUsdNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
  // Portfolio value over time (Rabby-style): OCT price series scaled to the current total value.
  const pfFactor = octUsd > 0 ? totalUsdNum / octUsd : 0
  const portfolioChart = chart.map(p => p * pfFactor)
  const actions = [
    { key: 'swap', label: t('swap'), disabled: false, onClick: () => openSwap('OCT') },
    { key: 'send', label: t('send'), onClick: () => go('send') },
    { key: 'receive', label: t('receive'), onClick: () => go('receive') },
    { key: 'activity', label: t('activity'), onClick: () => go('activity') },
    { key: 'privacy', label: t('privacy'), disabled: true, onClick: () => {} },
    { key: 'defi', label: t('defi'), onClick: () => go('defi') },
  ]
  const ftokens = tokens.filter(t => { const q = tokQ.trim().toLowerCase(); return !q || t.symbol.toLowerCase().includes(q) || t.address.toLowerCase().includes(q) })

  if (tokDetail) return <TokenDetail tk={tokDetail} usdPrice={tokenUsd(tokDetail)} chartData={tokDetail.native ? chart : tokSeries.map(o => o * octUsd)} change24h={tokDetail.native ? price?.change24h : undefined} nativeMcap={tokDetail.native ? price?.mcap : undefined} nativeVol={tokDetail.native ? price?.vol : undefined} onBack={() => setTokDetail(null)} onSend={() => openSendToken(tokDetail.native ? 'OCT' : tokDetail.address)} onReceive={() => go('receive')} onSwap={() => openSwap(tokDetail.native ? 'OCT' : tokDetail.address)} />

  return (
    <div
      onTouchStart={e => { ptrStart.current = (scrollRef.current?.scrollTop ?? 0) <= 0 ? e.touches[0].clientY : null; ptrStartX.current = e.touches[0].clientX }}
      onTouchMove={e => { if (ptrStart.current == null) return; const dy = e.touches[0].clientY - ptrStart.current; const dx = e.touches[0].clientX - ptrStartX.current; if (Math.abs(dx) > Math.abs(dy)) { ptrStart.current = null; setPtrPull(0); return } setPtrPull(dy > 0 ? Math.min(dy, 90) : 0) }}
      onTouchEnd={() => { if (ptrPull > 60) { manualRef.current = true; refresh() } setPtrPull(0); ptrStart.current = null }}
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* pull-to-refresh spinner — only for a manual pull; background refreshes stay silent (cached) */}
      {(ptrPull > 0 || (spinning && manualRef.current)) && (
        <div style={{ position: 'fixed', top: 'calc(0px + 56px)', left: 0, right: 0, zIndex: 1000, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div className={ptrPull > 60 || spinning ? 'fw-spin' : ''} style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid rgba(255,255,255,.35)', borderTopColor: '#fff', opacity: spinning ? 1 : Math.min(1, ptrPull / 50) }} />
        </div>
      )}
      {/* header card (fixed) */}
      <div style={{ flexShrink: 0, padding: 'calc(0px + 8px) 12px 0' }}>
      <div
        onTouchStart={e => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
        onTouchEnd={e => { const s = swipe.current; swipe.current = null; if (!s) return; const dx = e.changedTouches[0].clientX - s.x; const dy = e.changedTouches[0].clientY - s.y; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) setBalMode(dx < 0 ? 'usd' : 'oct') }}
        style={{ background: grad, color: '#fff', padding: '14px 16px 16px', position: 'relative', borderRadius: 16, border: `1px solid ${border}`, boxShadow: '0 2px 10px rgba(20,28,40,.10)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setMenu(m => !m)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', fontFamily: F, fontSize: 14, fontWeight: 700, padding: '5px 10px', cursor: 'pointer' }}>
            <Avatar address={acct.address} label={acct.label} size={22} />
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
          <div style={{ position: 'absolute', left: 16, top: 52, zIndex: 20, background: surface, border: `1px solid ${border}`, boxShadow: '0 6px 20px rgba(0,0,0,.18)', minWidth: 220 }}>
            {accounts.map((a, i) => (
              <button key={a.address} onClick={() => { setSel(i); setMenu(false) }} style={{ width: '100%', textAlign: 'left', background: i === sel ? bg : surface, border: 'none', borderBottom: `1px solid ${border}`, padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontFamily: F, fontSize: 13, color: ink }}>{a.label}</span>
                <span style={{ fontFamily: M, fontSize: 11, color: muted }}>{short(a.address)}</span>
              </button>
            ))}
            <button onClick={() => { setMenu(false); openAddAccount('dash') }} style={{ width: '100%', background: surface, border: 'none', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: accent, fontFamily: F, fontSize: 13 }}>
              <Ic d={ICONS.plus} size={15} /> add account
            </button>
          </div>
        )}

        {/* OCT / total-value toggle */}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
          <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,.12)', padding: 2, borderRadius: 999 }}>
            {(['oct', 'usd'] as const).map(m => (
              <button key={m} onClick={() => setBalMode(m)} style={{ background: balMode === m ? 'rgba(255,255,255,.24)' : 'transparent', border: 'none', color: '#fff', fontFamily: F, fontSize: 12, fontWeight: 700, padding: '5px 12px', cursor: 'pointer', opacity: balMode === m ? 1 : .7 }}>{m === 'oct' ? 'OCT' : 'Value'}</button>
            ))}
          </div>
        </div>

        {/* balance + detail wrapped in a keyed container so it slides in on each OCT/Value switch */}
        <div key={balMode} className={balMode === 'usd' ? 'fw-bal-r' : 'fw-bal-l'}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, marginTop: 14 }}>
          {balMode === 'oct' ? (
            <>
              <span style={{ fontFamily: M, fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{bal === null ? '…' : bal}</span>
              <span style={{ fontFamily: F, fontSize: 16, opacity: .8, paddingBottom: 5 }}>OCT</span>
            </>
          ) : (
            <>
              <span style={{ fontFamily: M, fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{totalUsd === null ? '…' : totalUsd}</span>
              {price && <span style={{ fontFamily: F, fontSize: 13, paddingBottom: 6, color: price.change24h >= 0 ? '#86efac' : '#fca5a5' }}>{price.change24h >= 0 ? '+' : ''}{price.change24h.toFixed(2)}%</span>}
            </>
          )}
        </div>
        {/* fixed-height detail row so the blue header keeps a constant height when toggling OCT /
            Value. OCT: dollar value stacked over price-per-OCT. Value: token logos. */}
        <div style={{ height: 46, marginTop: 9, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
          {balMode === 'oct' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: F, fontSize: 14, opacity: .92 }}>
                {usd && <span>{usd}</span>}
                {price && <span style={{ color: price.change24h >= 0 ? '#86efac' : '#fca5a5', fontSize: 12 }}>{price.change24h >= 0 ? '+' : ''}{price.change24h.toFixed(2)}%</span>}
              </div>
              {price && price.usd > 0 && <span style={{ fontFamily: M, fontSize: 12, opacity: .8 }}>${price.usd.toFixed(4)} / OCT</span>}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {tokens.filter(tk => Number(tk.balance || 0) > 0 && tokenUsd(tk) > 0).map(tk => (
                <span key={tk.symbol} title={tk.symbol} style={{ display: 'inline-flex', borderRadius: '50%', boxShadow: '0 0 0 1.5px rgba(255,255,255,.85)' }}>
                  <TokenImg symbol={tk.symbol} size={18} />
                </span>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
      </div>

      {/* action row — collapsible. The hide/show handle sits ABOVE the buttons. */}
      <div style={{ flexShrink: 0 }}>
        <button onClick={toggleActs} title={actsOpen ? 'hide actions' : 'show actions'}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: muted, fontFamily: F, fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', padding: '8px 0' }}>
          <span style={{ display: 'inline-flex', transform: actsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><Ic d={ICONS.chevron} size={14} /></span>
          {actsOpen ? 'hide' : 'actions'}
        </button>
        {/* keep mounted so collapse/expand can animate height + opacity smoothly */}
        <div style={{ overflow: 'hidden', maxHeight: actsOpen ? 156 : 0, opacity: actsOpen ? 1 : 0, transform: actsOpen ? 'none' : 'translateY(-4px)', transition: 'max-height .28s cubic-bezier(.22,.61,.36,1), opacity .22s ease, transform .28s cubic-bezier(.22,.61,.36,1)' }}>
          <div className="fw-actiongrid">
            {actions.map(a => (
              <button key={a.key} className="fw-actioncell" disabled={a.disabled} onClick={a.onClick} title={a.disabled ? 'coming soon' : ''} style={{ cursor: a.disabled ? 'not-allowed' : 'pointer', color: a.disabled ? muted : accent, opacity: a.disabled ? .5 : 1 }}>
                <Ic d={ICONS[a.key]} size={23} />
                <span style={{ fontFamily: F, fontSize: 12.5, color: a.disabled ? muted : ink }}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* private balance + tokens (scroll area; header above and footer below stay fixed) */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '12px 16px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={label}>{t('tokens')}</div>
          <button onClick={() => setAdding(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: accent, fontFamily: F, fontSize: 12.5 }}><Ic d={ICONS.plus} size={14} /> {t('add')}</button>
        </div>
        {tokens.length > 4 && (
          <input style={{ ...input, padding: '7px 10px', fontSize: 12, marginBottom: 8 }} value={tokQ} onChange={e => setTokQ(e.target.value)} placeholder={t('search_tokens')} />
        )}
        {adding && (
          <div onClick={() => setAdding(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,28,40,.45)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 360, background: surface, border: `1px solid ${border}`, boxShadow: '0 12px 32px rgba(0,0,0,.28)' }}>
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border}`, fontFamily: F, fontSize: 15, fontWeight: 700, color: ink }}>{t('add')} {t('tokens').toLowerCase().replace(/s$/, '')}</div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input style={{ ...input }} value={tokAddr} onChange={e => setTokAddr(e.target.value)} placeholder="token contract oct…" onKeyDown={e => e.key === 'Enter' && addTok()} autoFocus />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setAdding(false)} style={{ ...btn, background: surface, color: ink, border: `1px solid ${border}` }}>{t('cancel') || 'cancel'}</button>
                  <button onClick={addTok} style={{ ...btn }}>{t('add')}</button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
        {ftokens.length === 0 ? <div style={{ fontFamily: F, fontSize: 13, color: muted, padding: '8px 0' }}>{tokens.length ? 'no match' : '…'}</div> : ftokens.map(t => {
          const chg = t.native ? (price ? price.change24h : null) : (t.address in tokChg ? tokChg[t.address] : null)
          return (
          <React.Fragment key={t.symbol + t.address}>
            <div onClick={() => setTokDetail(t)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 2px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <TokenImg symbol={t.symbol} />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontFamily: F, fontSize: 14, color: ink }}>{t.symbol}</span>
                  {chg != null && <span style={{ fontFamily: M, fontSize: 11, color: chg >= 0 ? '#3b9a5a' : '#c0564f' }}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontFamily: M, fontSize: 13, color: ink, display: 'flex', alignItems: 'center', gap: 4 }} title={t.confidential ? 'public (unshielded) balance' : undefined}>{t.confidential && <span style={{ fontSize: 8.5, color: muted, letterSpacing: '.04em' }}>PUB</span>}{t.balance === '' ? <span className="fw-spin" style={{ display: 'inline-flex' }}><Ic d={ICONS.refresh} size={12} /></span> : Number(t.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                  {t.confidential && <span style={{ fontFamily: M, fontSize: 11, color: muted, display: 'flex', alignItems: 'center', gap: 3 }} title="shielded (private) balance"><Ic d={ICONS.lock} size={10} />{!(t.address in tokShielded) ? '…' : tokShielded[t.address] == null ? '—' : (Number(tokShielded[t.address]) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>}
                  {!t.confidential && tokenUsd(t) > 0 && <span style={{ fontFamily: M, fontSize: 11, color: muted }}>${(Number(t.balance) * tokenUsd(t)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                </div>
              </div>
            </div>
            {/* private OCT: shown right under public OCT, non-removable, with its own refresh */}
            {t.native && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <TokenImg symbol="OCT" />
                  <span style={{ fontFamily: F, fontSize: 14, color: ink }}>OCT</span>
                  <span style={{ color: muted, display: 'inline-flex', alignItems: 'center' }} title="private OCT"><Ic d={ICONS.lock} size={14} /></span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontFamily: M, fontSize: 13, color: ink, display: 'flex', alignItems: 'center' }}>{priv ? fmtMicro(priv.private) : privErr ? '—' : <span className="fw-spin" style={{ display: 'inline-flex' }}><Ic d={ICONS.refresh} size={12} /></span>}</span>
                  {priv && priv.private != null && price && price.usd > 0 && <span style={{ fontFamily: M, fontSize: 11, color: muted }}>${(Number(priv.private) / 1e6 * price.usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                </div>
              </div>
            )}
          </React.Fragment>
          )
        })}
        </div>
      </div>
    </div>
  )
}

// ── send ─────────────────────────────────────────────────────────────────────
function SendView({ acct, back, setErr, initialToken }: { acct: AccountView; back: () => void; setErr: (s: string) => void; initialToken?: string }) {
  const t = useT()
  const [toks, setToks] = useState<{ symbol: string; balance: string; native: boolean; address: string }[]>([])
  const [tokIdx, setTokIdx] = useState(0)
  const [to, setTo] = useState(''); const [amt, setAmt] = useState(''); const [busy, setBusy] = useState(false); const [hash, setHash] = useState('')
  useEffect(() => { api.tokens(acct.address).then(list => {
    setToks(list)
    if (initialToken) { const i = list.findIndex(tk => tk.address === initialToken || (initialToken === 'OCT' && tk.native)); if (i >= 0) setTokIdx(i) }
  }).catch(() => setToks([])) }, [acct.address])
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
        <Select value={tokIdx} onChange={(v: number) => { setTokIdx(Number(v)); setAmt('') }} options={toks.map((tk, i) => ({ value: i, label: `${tk.symbol} · ${fmtBal(tk.balance)}` }))} />
        <div style={label}>{t('recipient')}</div>
        <input style={input} value={to} onChange={e => setTo(e.target.value)} placeholder="oct…" />
        <div style={label}>{t('amount')} ({tok?.symbol || 'OCT'}){tok && <span style={{ color: muted }}> · {t('max')} {fmtBal(tok.balance)}</span>}</div>
        <input style={input} value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.0" inputMode="decimal" />
        {/* private (stealth) send — not yet enabled */}
        <div title="coming soon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0', opacity: 0.5, cursor: 'not-allowed' }}>
          <span style={{ fontFamily: F, fontSize: 13, color: ink }}>private (stealth)<span style={{ fontFamily: F, fontSize: 9, color: muted, border: `1px solid ${border}`, padding: '1px 5px', marginLeft: 7, textTransform: 'uppercase', letterSpacing: '.5px' }}>soon</span></span>
          <div style={{ width: 38, height: 20, borderRadius: 10, background: border, position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: surface, position: 'absolute', top: 2, left: 2 }} />
          </div>
        </div>
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={send}>{busy ? t('sending') : t('send')}</button>
        {hash && <div style={{ fontFamily: M, fontSize: 11, color: '#3b7f5a', wordBreak: 'break-all' }}>{t('sent')}: {hash}</div>}
      </div>
    </div>
  )
}

// ── swap (Factory AMM) ───────────────────────────────────────────────────────
type SwapTok = { symbol: string; balance: string; native: boolean; address: string }
const swapKey = (t: SwapTok) => (t.native ? 'OCT' : t.address)
function SwapView({ acct, back, setErr, initialToken }: { acct: AccountView; back: () => void; setErr: (s: string) => void; initialToken?: string }) {
  const t = useT()
  // Seed from the dashboard's cached snapshot so the swap screen shows tokens/balances/prices
  // INSTANTLY on open (no blank "—" chips while api.tokens resolves); the effects below still
  // refresh in the background. Falls back to empty when opened without visiting the dashboard.
  const swapSeed = dashCache[acct.address]?.tokens ?? []
  const seedIdx = (() => {
    let fi = 0
    if (initialToken) { const i = swapSeed.findIndex(tk => tk.address === initialToken || (initialToken === 'OCT' && tk.native)); if (i >= 0) fi = i }
    const ti = swapSeed.findIndex((_, i) => i !== fi)
    return { fi, ti: ti >= 0 ? ti : (fi === 0 ? 1 : 0) }
  })()
  const [toks, setToks] = useState<SwapTok[]>(swapSeed)
  const [fromIdx, setFromIdx] = useState(seedIdx.fi)
  const [toIdx, setToIdx] = useState(seedIdx.ti)
  const [amt, setAmt] = useState('')
  const [quote, setQuote] = useState<{ out: string; fee: number; impact: number } | null>(null)
  const [qStatus, setQStatus] = useState<'' | 'loading' | 'none'>('')
  const [slip, setSlip] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [hash, setHash] = useState('')
  const [px, setPx] = useState<Record<string, number>>(dashCache[acct.address]?.tokPrices ?? {})
  const [octUsd, setOctUsd] = useState(dashCache[acct.address]?.price?.usd ?? 0)
  const [picker, setPicker] = useState<'from' | 'to' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<'pending' | 'ok' | 'fail' | null>(null)   // on-chain swap outcome
  const [net, setNet] = useState('')
  const from = toks[fromIdx], to = toks[toIdx]
  const fmtBal = (b: string) => Number(b).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const explorer = net.includes('octra.network') ? 'https://octrascan.io' : 'https://devnet.octrascan.io'
  useEffect(() => { api.prices().then(setPx).catch(() => { /* */ }); api.octPrice().then(p => setOctUsd(p.usd || 0)).catch(() => { /* */ }); api.getNetwork().then(n => setNet(n.url)).catch(() => { /* */ }) }, [])
  // px holds OCT-per-token (see the 'prices' handler); multiply by OCT/USD to get the USD price.
  const priceOf = (tk?: SwapTok) => !tk ? 0 : tk.native ? octUsd : (px[tk.address] || 0) * octUsd
  // Always show a dollar line when the token price is known; defaults to $0.00 before any amount is typed.
  const usdStr = (tk: SwapTok | undefined, amt: number) => { const p = priceOf(tk); return p > 0 ? '≈ $' + (p * Math.max(amt || 0, 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '' }

  useEffect(() => { api.tokens(acct.address).then(list => {
    setToks(list)
    let fi = 0
    if (initialToken) { const i = list.findIndex(tk => tk.address === initialToken || (initialToken === 'OCT' && tk.native)); if (i >= 0) fi = i }
    const ti = list.findIndex((_, i) => i !== fi)
    setFromIdx(fi); setToIdx(ti >= 0 ? ti : fi)
  }).catch(() => setToks([])) }, [acct.address])

  // Live quote whenever the pair or amount changes (debounced). NOTE: don't clear `hash` here — the
  // post-swap reset (setAmt('')) re-runs this effect, and clearing the hash would wipe the success
  // receipt right after a swap. `review()` clears the old hash when a new swap is initiated instead.
  useEffect(() => {
    if (!from || !to || swapKey(from) === swapKey(to) || !(Number(amt) > 0)) { setQuote(null); setQStatus(''); return }
    const micro = String(Math.round(Number(amt) * 1e6))
    let alive = true
    setQStatus('loading')
    const id = setTimeout(() => {
      api.swapQuote(swapKey(from), swapKey(to), micro).then(q => {
        if (!alive) return
        if (q.found && q.amountOutMicro) { setQuote({ out: q.amountOutMicro, fee: q.fee || 0, impact: q.priceImpactBps || 0 }); setQStatus('') }
        else { setQuote(null); setQStatus('none') }
      }).catch(() => { if (alive) { setQuote(null); setQStatus('none') } })
    }, 350)
    return () => { alive = false; clearTimeout(id) }
  }, [fromIdx, toIdx, amt, toks])

  const outAmt = quote ? Number(quote.out) / 1e6 : 0
  const minOut = quote ? Math.floor(Number(quote.out) * (1 - slip / 100)) : 0
  const rate = quote && Number(amt) > 0 ? outAmt / Number(amt) : 0
  const flip = () => { const f = fromIdx; setFromIdx(toIdx); setToIdx(f); setAmt('') }
  const pick = (which: 'from' | 'to', v: number) => {
    if (which === 'from') { if (v === toIdx) setToIdx(fromIdx); setFromIdx(v) }
    else { if (v === fromIdx) setFromIdx(toIdx); setToIdx(v) }
    setAmt('')
  }
  // Tapping Swap opens the approval window; this validates and shows it.
  const review = () => {
    setErr(''); setHash(''); setResult(null)
    if (!from || !to) return
    const v = Number(amt)
    if (!(v > 0)) return setErr(t('invalid_amount'))
    if (Number(from.balance) < v) return setErr('insufficient balance')
    if (!quote) return setErr('no route for this pair')
    setConfirm(true)
  }
  // Confirmed in the approval window → submit the swap. The window STAYS OPEN the whole time: it
  // shows a spinner while confirming, then the spinner fades into a green check or red cross in place.
  const run = async () => {
    if (!from || !to || !quote) return
    const v = Number(amt)
    setErr(''); setBusy(true); setResult('pending')
    const started = Date.now()
    try {
      const r = await api.swap(acct.address, swapKey(from), swapKey(to), String(Math.round(v * 1e6)), String(minOut), quote.fee)
      const wait = 1400 - (Date.now() - started)
      if (wait > 0) await new Promise(res => setTimeout(res, wait))
      setHash(r.hash); setBusy(false)
      // poll the on-chain receipt to confirm success / failure (takes a few seconds to be mined)
      let tries = 0
      const poll = async () => {
        tries++
        const rec = await api.txReceipt(r.hash).catch(() => ({ success: null as boolean | null }))
        if (rec.success === true) return setResult('ok')
        if (rec.success === false) return setResult('fail')
        if (tries < 10) setTimeout(poll, 1500); else setResult('ok')
      }
      setTimeout(poll, 1200)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setResult('fail'); setBusy(false) }
  }
  // Close the approval window and reset the form (used after a finished swap).
  const done = () => { setConfirm(false); setResult(null); setHash(''); setAmt(''); setQuote(null) }

  // Compact cards so the whole swap (pay, receive, slippage, button) fits a 600px popup without scrolling.
  const card: CSSProperties = { background: surface, border: `1px solid ${border}`, borderRadius: 16, padding: '12px 17px', display: 'flex', flexDirection: 'column', gap: 7 }
  // Token chip → opens the bottom-sheet picker. Even right padding keeps the chevron off the edge.
  const tokSel = (which: 'from' | 'to') => {
    const tk = toks[which === 'from' ? fromIdx : toIdx]
    return (
      <button onClick={() => setPicker(which)} className="fw-tokchip"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: bg, border: 'none', padding: '7px 13px 7px 8px', cursor: 'pointer', flexShrink: 0, color: ink }}>
        {tk && <TokenImg symbol={tk.symbol} size={24} />}
        <span style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: ink }}>{tk?.symbol || '—'}</span>
        <Ic d={ICONS.chevron} size={16} />
      </button>
    )
  }
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar title={t('swap')} back={back} />
      <div style={{ ...pad, padding: '12px 14px', gap: 7, flex: 1, minHeight: 0 }}>
        {/* you pay */}
        <div style={card}>
          {/* amount slider (small) sits above the balance label; drag to pick a share of the balance */}
          {from && Number(from.balance) > 0 && (() => {
            const pct = Math.max(0, Math.min(100, (Math.min(Number(amt) || 0, Number(from.balance)) / Number(from.balance)) * 100))
            return (
              <input type="range" min={0} max={Number(from.balance)} step={Number(from.balance) / 100}
                value={Math.min(Number(amt) || 0, Number(from.balance))}
                onChange={e => setAmt(e.target.value)}
                style={{ width: '100%', background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--cell-border) ${pct}%, var(--cell-border) 100%)` }} />
            )
          })()}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={label}>you pay</span>
            {from && <span style={{ fontFamily: F, fontSize: 12.5, color: muted }}>balance {fmtBal(from.balance)}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.0" inputMode="decimal"
              style={{ flex: 1, fontFamily: M, fontSize: 31, fontWeight: 700, color: ink, border: 'none', outline: 'none', background: 'transparent', width: '100%', minWidth: 0 }} />
            {tokSel('from')}
          </div>
          <span style={{ fontFamily: F, fontSize: 13.5, color: muted, minHeight: 0 }}>{usdStr(from, Number(amt))}</span>
        </div>
        {/* flip — sits in the gap between the cards (no overlap onto them) */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '-2px 0' }}>
          <button onClick={flip} title="flip" style={{ width: 42, height: 42, borderRadius: 12, background: accent, border: 'none', color: onAccent, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ic d={ICONS.swap} size={19} />
          </button>
        </div>
        {/* you receive */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={label}>you receive</span>
            {to && <span style={{ fontFamily: F, fontSize: 12.5, color: muted }}>balance {fmtBal(to.balance)}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, fontFamily: M, fontSize: 31, fontWeight: 700, color: quote ? ink : muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {qStatus === 'loading' ? '…' : quote ? outAmt.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.0'}
            </span>
            {tokSel('to')}
          </div>
          <span style={{ fontFamily: F, fontSize: 13.5, color: muted, minHeight: 0 }}>{usdStr(to, outAmt)}</span>
        </div>
        {/* slippage */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...label, flex: 1 }}>slippage</span>
          {[0.1, 0.5, 1].map(s => (
            <button key={s} onClick={() => setSlip(s)} style={{ fontFamily: M, fontSize: 13, color: slip === s ? onAccent : ink, background: slip === s ? accent : bg, border: 'none', padding: '8px 15px', cursor: 'pointer' }}>{s}%</button>
          ))}
        </div>
        {/* details — always visible; values stay blank until an amount is entered (a quote arrives) */}
        {from && to && (
          <div style={{ ...card, gap: 3, padding: '8px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F, fontSize: 11.5, color: muted }}><span>rate</span><span style={{ fontFamily: M, color: ink }}>{quote ? `1 ${from.symbol} ≈ ${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to.symbol}` : ''}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F, fontSize: 11.5, color: muted }}><span>fee tier</span><span style={{ fontFamily: M, color: ink }}>{quote ? `${(quote.fee / 10000).toFixed(2)}%` : ''}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F, fontSize: 11.5, color: muted }}><span>price impact</span><span style={{ fontFamily: M, color: quote && quote.impact > 300 ? '#c0392b' : ink }}>{quote ? `${(quote.impact / 100).toFixed(2)}%` : ''}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F, fontSize: 11.5, color: muted }}><span>min received</span><span style={{ fontFamily: M, color: ink }}>{quote ? `${(minOut / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to.symbol}` : ''}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F, fontSize: 11.5, color: muted, borderTop: `1px solid ${bg}`, paddingTop: 5 }}><span>route</span><span style={{ fontFamily: M, color: ink }}>{quote ? `${from.symbol} → ${to.symbol} · via Factory` : ''}</span></div>
          </div>
        )}
        {qStatus === 'none' && Number(amt) > 0 && <div style={{ fontFamily: F, fontSize: 12, color: '#c0392b' }}>no direct pool for this pair</div>}
        <button style={{ ...btn, padding: '12px 16px', marginTop: 'auto', opacity: busy || !quote ? 0.6 : 1 }} disabled={busy || !quote} onClick={review}>{busy ? 'swapping…' : t('swap')}</button>
      </div>
      {/* bottom-sheet token picker */}
      {picker && (
        <div onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(10,15,22,.55)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} className="fw-slideup"
            style={{ width: '100%', maxWidth: 480, margin: '0 auto', background: surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 'calc(12px + 0px)', maxHeight: '72vh', overflowY: 'auto' }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: border, margin: '10px auto 8px' }} />
            <div style={{ fontFamily: F, fontSize: 11, color: muted, padding: '0 18px 8px', textTransform: 'capitalize', letterSpacing: 'normal' }}>select token</div>
            {toks.map((o, i) => {
              const sel = (picker === 'from' ? fromIdx : toIdx) === i
              return (
                <div key={i} onClick={() => { pick(picker, i); setPicker(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', background: sel ? bg : 'transparent', cursor: 'pointer' }}>
                  <TokenImg symbol={o.symbol} size={30} />
                  <span style={{ flex: 1, fontFamily: F, fontSize: 15, fontWeight: 700, color: ink }}>{o.symbol}</span>
                  <span style={{ fontFamily: M, fontSize: 13, color: muted }}>{fmtBal(o.balance)}</span>
                  {sel && <span style={{ color: accent, display: 'inline-flex' }}><Ic d={ICONS.check} size={16} /></span>}
                </div>
              )
            })}
          </div>
        </div>
      )}
      {/* approval window — shown before the swap is signed */}
      {confirm && from && to && quote && (
        <div onClick={() => { if (result === 'ok' || result === 'fail') done(); else if (!busy && !result) setConfirm(false) }} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(6,10,16,.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 360, background: surface, border: `1px solid ${border}`, borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontFamily: F, fontSize: 16, fontWeight: 700, color: ink }}>{result === 'ok' ? 'swap complete' : result === 'fail' ? 'swap failed' : 'approve swap'}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: bg, borderRadius: 12, padding: '11px 13px' }}>
                <TokenImg symbol={from.symbol} size={26} />
                <div style={{ flex: 1 }}><div style={{ fontFamily: F, fontSize: 11, color: muted }}>you pay</div><div style={{ fontFamily: M, fontSize: 16, fontWeight: 700, color: ink }}>{amt} {from.symbol}</div></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: bg, borderRadius: 12, padding: '11px 13px' }}>
                <TokenImg symbol={to.symbol} size={26} />
                <div style={{ flex: 1 }}><div style={{ fontFamily: F, fontSize: 11, color: muted }}>you receive (est.)</div><div style={{ fontFamily: M, fontSize: 16, fontWeight: 700, color: ink }}>{outAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} {to.symbol}</div></div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontFamily: F, fontSize: 12, color: muted }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>rate</span><span style={{ fontFamily: M, color: ink }}>1 {from.symbol} ≈ {rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {to.symbol}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>min received</span><span style={{ fontFamily: M, color: ink }}>{(minOut / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} {to.symbol}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>fee tier · slippage</span><span style={{ fontFamily: M, color: ink }}>{(quote.fee / 10000).toFixed(2)}% · {slip}%</span></div>
            </div>
            {result === 'ok' ? (
              <div className="fw-fade" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                <span className="fw-pop" style={{ width: 46, height: 46, borderRadius: '50%', background: '#3b9a5a', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Ic d={ICONS.check} size={26} /></span>
                <span style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: '#3b9a5a' }}>swap successful</span>
                {hash && <span onClick={() => window.open(`${explorer}/tx.html?hash=${hash}`)} style={{ fontFamily: M, fontSize: 11, color: accent, textDecoration: 'underline', cursor: 'pointer' }}>{hash.slice(0, 10)}…{hash.slice(-8)}</span>}
                <button onClick={done} style={{ ...btn, marginTop: 4 }}>done</button>
              </div>
            ) : result === 'fail' ? (
              <div className="fw-fade" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                <span className="fw-pop" style={{ width: 46, height: 46, borderRadius: '50%', background: '#c0564f', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Ic d={ICONS.close} size={26} /></span>
                <span style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: '#c0564f' }}>swap failed</span>
                <button onClick={done} style={{ ...btn, background: bg, color: ink, border: `1px solid ${border}`, marginTop: 4 }}>close</button>
              </div>
            ) : (busy || result === 'pending') ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px 0 10px' }}>
                <span className="fw-spin" style={{ display: 'inline-block', width: 24, height: 24, borderRadius: '50%', border: `3px solid ${border}`, borderTopColor: accent }} />
                <span style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: ink }}>confirming…</span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                <button onClick={() => setConfirm(false)} style={{ ...btn, background: bg, color: ink, border: `1px solid ${border}` }}>cancel</button>
                <button onClick={run} style={{ ...btn }}>confirm</button>
              </div>
            )}
          </div>
        </div>
      )}
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
        <div style={{ fontFamily: M, fontSize: 13, color: ink, wordBreak: 'break-all', background: surface, border: `1px solid ${border}`, padding: 14, width: '100%' }}>{acct.address}</div>
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
        <div style={{ background: surface, border: `1px solid ${border}`, padding: '10px 12px', display: 'flex', justifyContent: 'space-between' }}>
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
        {txLink && <span onClick={() => window.open(txLink)} style={{ fontFamily: M, fontSize: 11, color: accent, wordBreak: 'break-all', textDecoration: 'underline', cursor: 'pointer' }}>view transaction on explorer</span>}
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
  const posCard: CSSProperties = { background: surface, border: `1px solid ${border}`, borderRadius: 16, padding: '13px 15px' }
  return (
    <div>
      <TopBar title={t('defi_liquidity')} back={back} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: 14 }}>
        {pos === null ? <div style={{ color: muted, fontFamily: F, padding: 6 }}>{t('loading_positions')}</div>
          : pos.length === 0 ? <div style={{ color: muted, fontFamily: F, padding: 6 }}>{t('no_positions')}</div>
            : pos.map((p, i) => (
              <div key={p.pool + i} onClick={() => window.open('https://app.factory-amm.xyz/positions')}
                style={{ ...posCard, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
                  <span style={{ fontFamily: F, fontSize: 14.5, fontWeight: 700, color: ink }}>{p.sym0} / {p.sym1} <span style={{ fontFamily: M, fontSize: 11, fontWeight: 400, color: muted }}>{(p.fee / 10000).toFixed(2)}%</span></span>
                  <span style={{ fontFamily: F, fontSize: 10.5, padding: '3px 9px', borderRadius: 999, color: p.inRange ? '#2f6f4f' : '#9a6a3b', background: p.inRange ? '#e7f3ec' : '#f6ecdf' }}>{p.inRange ? t('in_range') : t('out_of_range')}</span>
                </div>
                <Row k={p.sym0} v={`${fmt(p.amount0)}`} />
                <Row k={p.sym1} v={`${fmt(p.amount1)}`} />
                {(p.owed0 !== '0' || p.owed1 !== '0') && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: M, fontSize: 11.5, color: muted, marginTop: 6 }}>
                    <span>{t('unclaimed_fees')}</span><span style={{ color: '#3b7f5a' }}>{fmt(p.owed0)} {p.sym0} · {fmt(p.owed1)} {p.sym1}</span>
                  </div>
                )}
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
  // method → localized-label key
  const MLK: Record<string, string> = {
    exact_input_single: 'a_swap', exact_output_single: 'a_swap', exact_input: 'a_swap', exact_output: 'a_swap', swap: 'a_swap',
    deposit: 'a_wrap', withdraw: 'a_unwrap', transfer: 'a_transfer', grant: 'a_approve', approve: 'a_approve',
    add_liquidity: 'a_add_liq', mint_position: 'a_add_liq', increase_liquidity: 'a_add_liq',
    remove_liquidity: 'a_remove_liq', decrease_liquidity: 'a_remove_liq', burn: 'a_remove_liq',
    collect: 'a_collect', collect_fees: 'a_collect', claim_from_pool: 'a_claim',
  }
  const describe = (tx: any): { label: string; micro: number; sign: string; detail: string } => {
    const op = tx.op_type, mine = tx.from === acct.address, mv = Number(tx.amount || 0)
    if (op === 'standard') return { label: mine ? t('send') : t('receive'), micro: mv, sign: mine ? '-' : '+', detail: mine ? `${t('a_to')} ${short(tx.to || tx.to_ || '')}` : `${t('a_from')} ${short(tx.from || '')}` }
    if (op === 'encrypt') return { label: t('encrypt'), micro: mv, sign: '', detail: t('a_shield') }
    if (op === 'decrypt') return { label: t('decrypt'), micro: mv, sign: '', detail: t('a_unshield') }
    if (op === 'deploy') return { label: t('a_deploy'), micro: 0, sign: '', detail: t('a_contract') }
    if (op === 'call') { const m = String(tx.encrypted_data || 'call'); return { label: MLK[m] ? t(MLK[m]) : m.replace(/_/g, ' '), micro: mv, sign: '', detail: `${t('a_contract_call')} · ${short(tx.to || tx.to_ || '')}` } }
    if (op === 'multi_exec') {
      let calls: any[] = []; try { calls = (JSON.parse(tx.message || '{}').calls) || [] } catch { /* */ }
      const ms = calls.map(c => String(c.method))
      const has = (...x: string[]) => ms.some(y => x.includes(y))
      const label = has('exact_input_single', 'exact_output_single', 'exact_input', 'exact_output', 'swap') ? t('a_swap')
        : has('add_liquidity', 'mint_position', 'increase_liquidity') ? t('a_add_liq')
        : has('remove_liquidity', 'decrease_liquidity', 'burn') ? t('a_remove_liq')
        : has('collect', 'collect_fees') ? t('a_collect') : `${t('a_swap')}`
      let micro = 0; for (const c of calls) { const a = Number(c.amount || 0); if (a > 0) { micro = a; break } }
      return { label, micro, sign: '', detail: `${calls.length} ${calls.length === 1 ? t('a_call') : t('a_calls')} · ${t('a_atomic')}` }
    }
    return { label: op || t('a_tx'), micro: mv, sign: '', detail: '' }
  }
  const fmtDate = (ts: any) => { const n = Number(ts); if (!n) return ''; const d = new Date(n * 1000); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }
  const fmtOct = (micro: any) => (Number(micro || 0) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const shortHash = (h: string) => h ? h.slice(0, 10) + '…' + h.slice(-8) : ''
  return (
    <div>
      <TopBar title={t('activity')} back={back} />
      <div style={{ padding: '12px 14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {txs === null ? <div style={{ color: muted, fontFamily: F, padding: '8px 4px' }}>{t('loading')}</div>
          : txs.length === 0 ? <div style={{ color: muted, fontFamily: F, padding: '8px 4px' }}>{t('no_tx')}</div>
            : txs.map((tx, i) => {
              const { label, micro, sign, detail } = describe(tx)
              return (
                <div key={tx.hash || i} style={{ background: surface, borderRadius: 16, padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* top row: label + amount */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontFamily: F, fontSize: 14.5, color: ink, textTransform: 'capitalize', fontWeight: 600 }}>{label}</div>
                      {detail && <div style={{ fontFamily: M, fontSize: 11.5, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>}
                    </div>
                    {micro > 0 && <div style={{ fontFamily: M, fontSize: 14, fontWeight: 600, color: sign === '+' ? '#3b7f5a' : ink, flexShrink: 0, marginLeft: 8 }}>{sign}{fmtOct(micro)} OCT</div>}
                  </div>
                  {/* bottom row: hash link + date */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingTop: 11, borderTop: `1px solid ${border}` }}>
                    <span onClick={() => window.open(`${base}/tx.html?hash=${tx.hash}`)} title={tx.hash} style={{ fontFamily: M, fontSize: 11.5, color: accent, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{shortHash(String(tx.hash || ''))}</span>
                    <span style={{ fontFamily: F, fontSize: 11.5, color: muted, whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtDate(tx.timestamp)}</span>
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
  const host = (origin: string) => { try { return new URL(origin).host } catch { return origin } }
  return (
    <div>
      <TopBar title="Connected sites" back={back} />
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sites === null ? <div style={{ color: muted, fontFamily: F, fontSize: 13, padding: '8px 2px' }}>loading…</div>
          : sites.length === 0 ? <div style={{ color: muted, fontFamily: F, fontSize: 13, lineHeight: 1.5, padding: '8px 2px' }}>No sites connected. Connect from a dapp using window.octra.</div>
            : sites.map(s => (
              <div key={s.origin} style={{ background: surface, borderRadius: 16, padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: accent }}>
                  <Ic d={ICONS.connected} size={19} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host(s.origin)}</div>
                  <div style={{ fontFamily: M, fontSize: 11.5, color: muted, marginTop: 2 }}>{short(s.address)}</div>
                </div>
                <button onClick={() => disconnect(s.origin)} style={{ fontFamily: F, fontSize: 12, fontWeight: 600, color: '#c0392b', background: bg, border: 'none', padding: '8px 13px', cursor: 'pointer', flexShrink: 0 }}>disconnect</button>
              </div>
            ))}
      </div>
    </div>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,28,40,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: surface, border: `1px solid ${border}`, width: '100%', maxWidth: 320, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
  const t = useT()
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
  return (
    <div>
      <TopBar title={t('aa_title')} back={back} />
      <div style={pad}>
        {/* same segmented selector as the rest of the app */}
        <CapsuleSelect value={mode} onChange={(v: any) => { setMode(v); setValue(''); setErr('') }}
          options={[{ value: 'new', label: t('aa_tab_new') }, { value: 'mnemonic', label: t('aa_tab_seed') }, { value: 'private', label: t('aa_tab_pk') }]} />

        {mode === 'new' && (
          <div style={{ background: surface, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}><Ic d={ICONS.plus} size={24} /></div>
            <div style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: ink }}>{t('aa_create_btn')}</div>
            <div style={{ fontFamily: F, fontSize: 13, color: muted, lineHeight: 1.55 }}>{t('aa_new_hint')}</div>
          </div>
        )}
        {mode !== 'new' && (
          <div style={{ background: surface, borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ fontFamily: F, fontSize: 10.5, letterSpacing: .2, textTransform: 'capitalize', color: muted }}>{mode === 'mnemonic' ? t('seed_phrase') : t('private_key')}</span>
            <textarea value={value} onChange={e => setValue(e.target.value)} autoFocus
              placeholder={mode === 'mnemonic' ? t('aa_seed_ph') : t('aa_pk_ph')}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              style={{ fontFamily: mode === 'mnemonic' ? F : M, fontSize: 13.5, lineHeight: 1.5, padding: 12, border: 'none', background: bg, color: ink, width: '100%', outline: 'none', minHeight: mode === 'mnemonic' ? 96 : 66, resize: 'none', borderRadius: 12 }} />
          </div>
        )}
        <button style={{ ...btn, padding: '13px 16px', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>{busy ? t('aa_working') : mode === 'new' ? t('aa_create_btn') : t('aa_import_btn')}</button>
      </div>
    </div>
  )
}

// ── settings ─────────────────────────────────────────────────────────────────
function SettingsView({ accounts, sel, setSel, setAccounts, back, onLock, onReset, setErr, openConnected, openAddAccount }:
  { accounts: AccountView[]; sel: number; setSel: (n: number) => void; setAccounts: (a: AccountView[]) => void; back: () => void; onLock: () => void; onReset: () => void; setErr: (s: string) => void; openConnected: (from: View) => void; openAddAccount: (from: View) => void }) {
  const t = useT()
  const { lang, setLang } = useLang()
  const theme = useTheme()
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
  const card: CSSProperties = { background: surface, border: `1px solid ${border}` }
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
              <div key={a.address} style={{ ...row, gap: 10, borderBottom: i === accounts.length - 1 ? 'none' : `1px solid ${border}` }}>
                <Avatar address={a.address} label={a.label} size={34} bg={accent} onClick={async () => { try { const u = await pickAvatar(); if (u) await setAvatar(a.address, u) } catch (e) { setErr(String(e)) } }} />
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
            style={{ ...btn, marginTop: 8, background: surface, color: accent, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Ic d={ICONS.plus} size={16} /> {t('add_account')}
          </button>
        </div>

        {/* network */}
        <div>
          <div style={sec}>{t('network_rpc')}</div>
          <div style={{ marginTop: 8 }}>
            <CapsuleSelect value={net.url} onChange={(v: string) => { setNet({ ...net, url: v }); api.setNetwork(v).catch((er) => setErr(String(er))) }} options={net.networks.map(n => ({ value: n.url, label: n.name }))} />
          </div>
        </div>

        {/* auto-lock */}
        <div>
          <div style={sec}>{t('auto_lock')}</div>
          <div style={{ marginTop: 8 }}>
            <CapsuleSelect value={lockMin} onChange={async (v: number) => { const m = Number(v); setLockMin(m); try { await api.setAutoLock(m) } catch (er) { setErr(String(er)) } }} options={[{ value: 5, label: '5m' }, { value: 30, label: '30m' }, { value: 0, label: t('never') }]} />
          </div>
        </div>

        {/* language */}
        <div>
          <div style={sec}>{t('language')}</div>
          <div style={{ marginTop: 8 }}>
            <CapsuleSelect value={lang} onChange={(v: string) => setLang(v as typeof lang)} options={LANGS.map(l => ({ value: l.code, label: l.label }))} />
          </div>
        </div>

        {/* appearance / theme */}
        <div>
          <div style={sec}>{t('theme')}</div>
          <div style={{ marginTop: 8 }}>
            <CapsuleSelect value={theme} onChange={(v: string) => setTheme(v as 'light' | 'dark')} options={[{ value: 'light', label: t('light'), icon: ICONS.sun }, { value: 'dark', label: t('dark'), icon: ICONS.moon }]} />
          </div>
        </div>

        {/* security & backup */}
        <div>
          <div style={sec}>{t('security')}</div>
          <div style={{ ...card, marginTop: 8 }}>
            <button onClick={() => setModal('pw')} style={{ ...row, width: '100%', cursor: 'pointer', background: surface, color: muted, border: 'none', borderBottom: `1px solid ${border}` }}>
              <span style={{ fontFamily: F, fontSize: 13.5, color: ink }}>{t('change_password')}</span><Ic d={ICONS.back} size={15} />
            </button>
            <button onClick={() => setModal('export')} style={{ ...row, width: '100%', cursor: 'pointer', background: surface, color: muted, border: 'none', borderBottom: 'none' }}>
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
          <button onClick={() => setModal('reset')} style={{ ...btn, marginTop: 8, background: 'transparent', color: '#d05a5a', border: '1px solid #b0484a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
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
function Brand({ tagline }: { tagline?: boolean }) {
  const t = useT()
  return (
    <div style={{ textAlign: 'center', padding: '8px 0 18px' }}>
      <div style={{ fontFamily: F, fontSize: 25, fontWeight: 700, color: ink, letterSpacing: '0.01em' }}>factory wallet</div>
      {tagline && <div style={{ fontFamily: F, fontSize: 13, color: muted, marginTop: 5 }}>{t('wallet_tagline')}</div>}
    </div>
  )
}

// shared field styles for the onboarding / unlock screens (theme-aware, borderless on the inner bg)
const obLabel: CSSProperties = { fontFamily: F, fontSize: 10.5, letterSpacing: 'normal', textTransform: 'capitalize', color: muted }
const obField: CSSProperties = { fontFamily: M, fontSize: 14, padding: '11px 12px', border: 'none', background: bg, color: ink, width: '100%', outline: 'none', borderRadius: 12 }

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
  if (backup) return <BackupView data={backup} onContinue={() => onDone(backup.accounts)} />
  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: bg }}>
      <div style={{ margin: 'auto', width: '100%', maxWidth: 360, padding: '20px 22px' }}>
      <Brand tagline />
      {err && <Banner text={err} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
        {/* create / import — same segmented control as the rest of the app */}
        <CapsuleSelect value={mode} onChange={(v: any) => { setMode(v); setErr('') }}
          options={[{ value: 'create', label: t('create') }, { value: 'import', label: t('importw') }]} />

        {mode === 'import' && (
          <div style={{ background: surface, borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 11 }}>
            <CapsuleSelect value={impMode} onChange={(v: any) => { setImpMode(v); setValue('') }}
              options={[{ value: 'mnemonic', label: t('aa_tab_seed') }, { value: 'private', label: t('aa_tab_pk') }]} />
            <textarea value={value} onChange={e => setValue(e.target.value)} autoFocus
              placeholder={impMode === 'mnemonic' ? t('aa_seed_ph') : t('aa_pk_ph')}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              style={{ ...obField, fontFamily: impMode === 'mnemonic' ? F : M, fontSize: 13.5, lineHeight: 1.5, minHeight: 88, resize: 'none' }} />
          </div>
        )}

        <div style={{ background: surface, borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={obLabel}>{t('password_min')}</span>
            <input style={obField} type="password" value={pw} onChange={e => setPw(e.target.value)} />
          </div>
          {mode === 'create' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={obLabel}>{t('confirm_password')}</span>
              <input style={obField} type="password" value={pw2} onChange={e => setPw2(e.target.value)} />
            </div>
          )}
        </div>

        <button style={{ ...btn, padding: '13px 16px', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>{busy ? '…' : mode === 'create' ? t('create_wallet') : t('import_wallet')}</button>
      </div>
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
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <div style={{ margin: 'auto', width: '100%', maxWidth: 340 }}>
      <Brand />
      <div style={pad}>
        <div style={{ fontFamily: F, fontSize: 16, color: ink, fontWeight: 600, marginBottom: 6 }}>{t('backup_title')}</div>
        <div style={{ fontFamily: F, fontSize: 12, color: '#9a3b3b', lineHeight: 1.5, marginBottom: 14 }}>{t('backup_warn')}</div>

        {words.length > 0 && <>
          <div style={{ ...label, display: 'flex', justifyContent: 'space-between' }}><span>{t('seed_phrase')}</span>{copyLink('seed', words.join(' '))}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, background: surface, border: `1px solid ${border}`, padding: 10, marginBottom: 14 }}>
            {words.map((w, i) => <div key={i} style={{ fontFamily: M, fontSize: 12, color: ink }}><span style={{ color: muted, marginRight: 4 }}>{i + 1}.</span>{w}</div>)}
          </div>
        </>}

        <div style={{ ...label, display: 'flex', justifyContent: 'space-between' }}><span>{t('private_key')}</span>{copyLink('pk', data.privateKey)}</div>
        <div style={{ fontFamily: M, fontSize: 11, color: ink, background: surface, border: `1px solid ${border}`, padding: 10, wordBreak: 'break-all', marginBottom: 14 }}>{data.privateKey}</div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontFamily: F, fontSize: 12, color: ink, cursor: 'pointer', marginBottom: 14 }}>
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 2 }} />
          <span>{t('backup_ack')}</span>
        </label>
        <button style={{ ...btn, opacity: ack ? 1 : 0.5, cursor: ack ? 'pointer' : 'not-allowed' }} disabled={!ack} onClick={onContinue}>{t('continue')}</button>
      </div>
      </div>
    </div>
  )
}

function Unlock({ onDone, onHold, setErr, err }: { onDone: (a: AccountView[]) => void; onHold: (v: boolean) => void; setErr: (s: string) => void; err: string }) {
  const t = useT()
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false)

  const submit = async () => {
    setErr(''); setBusy(true)
    onHold(true)
    try { onDone(await api.unlock(pw)) }
    catch (e) { onHold(false); setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', background: bg }}>
      <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Brand />
        {err && <div style={{ background: '#f7e3e3', color: '#9a3b3b', fontFamily: F, fontSize: 12, padding: '8px 12px', textAlign: 'center', borderRadius: 10 }}>{err}</div>}
        <div style={{ background: surface, borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={obLabel}>{t('enter_password')}</span>
          <input style={obField} type="password" value={pw} autoFocus onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        </div>
        <button style={{ ...btn, padding: '13px 16px', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>{busy ? t('unlocking') : t('unlock')}</button>
      </div>
    </div>
  )
}

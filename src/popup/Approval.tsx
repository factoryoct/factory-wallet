import React, { useState, type CSSProperties } from 'react'
import { api, type AccountView } from './api'
import { useT } from './i18n'
import { toMicro } from '../core/tx'

const F = 'Tahoma, Arial, sans-serif'
const M = '"SF Mono", Consolas, Monaco, monospace'
const ink = '#2c3e57', muted = '#7a8fa8', accent = '#3b567f', border = '#c8d0db'

export interface ApprovalReq { id: string; kind: 'connect' | 'tx'; origin: string; data: any }
const short = (a: string) => a ? a.slice(0, 8) + '…' + a.slice(-4) : ''

// Rendered inside the main popup so the approval shares the wallet's window and styling. For a
// connect request the user can pick which account to share.
export function ApprovalView({ req, accounts, selDefault, onDone }: {
  req: ApprovalReq; accounts: AccountView[]; selDefault: number; onDone: () => void
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState(Math.min(selDefault, Math.max(0, accounts.length - 1)))

  const decide = async (approved: boolean) => {
    setBusy(true)
    try { await api.approvalResolve(req.id, approved, accounts[pick]?.address) }
    catch { /* */ }
    onDone()
  }

  return (
    <div style={{ padding: 20, minHeight: 600, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontFamily: F, fontSize: 12, color: muted, textTransform: 'uppercase', letterSpacing: '1px' }}>
        {req.kind === 'connect' ? t('connection_request') : t('signature_request')}
      </div>
      <SafeOrigin origin={req.origin} />

      {req.kind === 'connect' ? (
        <Block>
          <p style={{ fontFamily: F, fontSize: 14, color: ink, lineHeight: 1.5, margin: 0 }}>
            {t('connect_hint')}
          </p>
          {accounts.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: F, fontSize: 11, color: muted, marginBottom: 6 }}>{t('account_to_connect')}</div>
              <select value={pick} onChange={e => setPick(Number(e.target.value))}
                style={{ width: '100%', fontFamily: M, fontSize: 13, padding: '9px 10px', border: `1px solid ${border}`, background: '#fff', color: ink, outline: 'none' }}>
                {accounts.map((a, i) => <option key={a.address} value={i}>{a.label} · {short(a.address)}</option>)}
              </select>
            </div>
          )}
        </Block>
      ) : <TxSummary d={req.data} />}

      <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
        <button disabled={busy} onClick={() => decide(false)} style={{ ...b, background: 'transparent', color: accent, border: `1px solid ${border}` }}>{t('reject')}</button>
        <button disabled={busy} onClick={() => decide(true)} style={{ ...b }}>{busy ? '…' : req.kind === 'connect' ? t('connect') : t('approve')}</button>
      </div>
    </div>
  )
}

// micro-OCT (string/number/bigint) -> OCT decimal string for display.
function microToOct(v: unknown): string {
  let m: bigint
  try { m = BigInt(String(v ?? '0')) } catch { return '0' }
  const neg = m < 0n; if (neg) m = -m
  const i = m / 1_000_000n, f = m % 1_000_000n
  const s = f > 0n ? `${i}.${f.toString().padStart(6, '0').replace(/0+$/, '')}` : i.toString()
  return (neg ? '-' : '') + s
}
// Display the exact micro value the signer will encode (same toMicro as core/tx).
const octInputToMicro = (oct: unknown): bigint => { try { return toMicro(oct as number) } catch { return 0n } }
function feeMicro(d: any): bigint {
  if (d.kind === 'transfer') return Number(d.oct) < 1000 ? 1n : 3n
  if (d.kind === 'call') return 10_000n
  if (d.kind === 'multiExec') return 5_000n
  return 0n
}

function SafeOrigin({ origin }: { origin: string }) {
  let scheme = '', host = origin
  try { const u = new URL(origin); scheme = u.protocol; host = u.host } catch { /* keep raw */ }
  const insecure = scheme && scheme !== 'https:'
  return (
    <div style={{ fontFamily: M, fontSize: 12 }}>
      {scheme && <span style={{ color: insecure ? '#9a3b3b' : muted }}>{scheme}//</span>}
      <span style={{ color: ink, fontWeight: 700 }}>{host}</span>
      {insecure && <span style={{ color: '#9a3b3b', fontFamily: F, fontSize: 11, marginLeft: 6 }}>insecure</span>}
    </div>
  )
}

const prettyMethod = (m: unknown) => String(m ?? '').replace(/_/g, ' ')
const valueOf = (v: unknown): bigint => { try { return BigInt(String(v ?? '0')) } catch { return 0n } }

function Disclosure({ open, toggle }: { open: boolean; toggle: () => void }) {
  return (
    <button onClick={toggle} style={{ marginTop: 10, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: F, fontSize: 12, color: accent }}>
      {open ? 'hide details' : 'show details'}
    </button>
  )
}

function TxSummary({ d }: { d: any }) {
  const [open, setOpen] = useState(false)
  const fee = `~${microToOct(feeMicro(d))} OCT`

  if (d.kind === 'multiExec') {
    const calls: any[] = d.calls ?? []
    let total = 0n
    for (const c of calls) total += valueOf(c.value)
    return (
      <Block>
        <Row label="total" value={`${microToOct(total)} OCT`} />
        <Row label="network fee" value={fee} />
        <div style={{ marginTop: 8 }}>
          {calls.map((c, i) => {
            const v = valueOf(c.value)
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0' }}>
                <span style={{ fontFamily: F, fontSize: 13, color: ink }}>{i + 1}. {prettyMethod(c.method)}</span>
                {v > 0n && <span style={{ fontFamily: F, fontSize: 13, color: muted }}>{microToOct(v)} OCT</span>}
              </div>
            )
          })}
        </div>
        <Disclosure open={open} toggle={() => setOpen(o => !o)} />
        {open && (
          <div style={{ marginTop: 4 }}>
            {calls.map((c, i) => (
              <div key={i} style={{ borderTop: `1px solid ${border}`, marginTop: 8, paddingTop: 6 }}>
                <Row label={`#${i + 1} method`} value={String(c.method)} />
                <Row label="to" value={String(c.to)} mono />
                <Row label="value" value={`${microToOct(c.value)} OCT`} />
                <Row label="args" value={JSON.stringify(c.params ?? [])} mono />
              </div>
            ))}
            <Row label="from" value={d.address} mono />
          </div>
        )}
      </Block>
    )
  }

  if (d.kind === 'transfer') {
    return (
      <Block>
        <Row label="send" value={`${microToOct(octInputToMicro(d.oct))} OCT`} />
        <Row label="to" value={short(d.to)} mono />
        <Row label="network fee" value={fee} />
      </Block>
    )
  }

  // single contract call
  const val = octInputToMicro(d.valueOct || 0)
  return (
    <Block>
      <Row label="action" value={prettyMethod(d.method)} />
      <Row label="contract" value={short(d.contract)} mono />
      {val > 0n && <Row label="value" value={`${microToOct(val)} OCT`} />}
      <Row label="network fee" value={fee} />
      <Disclosure open={open} toggle={() => setOpen(o => !o)} />
      {open && (
        <div style={{ marginTop: 4 }}>
          <Row label="contract" value={String(d.contract)} mono />
          <Row label="args" value={JSON.stringify(d.params ?? [])} mono />
          <Row label="from" value={d.address} mono />
        </div>
      )}
    </Block>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: `1px solid ${border}` }}>
      <span style={{ fontFamily: F, fontSize: 12, color: muted }}>{label}</span>
      <span style={{ fontFamily: mono ? M : F, fontSize: 12, color: ink, textAlign: 'right', wordBreak: 'break-all', maxWidth: 220 }}>{value}</span>
    </div>
  )
}

const Block = ({ children }: { children: any }) => <div style={{ background: '#fff', border: `1px solid ${border}`, padding: 14 }}>{children}</div>
const b: CSSProperties = { flex: 1, fontFamily: F, fontSize: 14, fontWeight: 600, color: '#fff', background: accent, border: 'none', padding: '11px 0', cursor: 'pointer' }

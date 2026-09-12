import React, { useState, type CSSProperties } from 'react'
import { api, type AccountView } from './api'
import { useT } from './i18n'
import { toMicro } from '../core/tx'
import { proveValues, decryptCipher, depositProofs, stealthSend, stealthScan, stealthViewPub } from './pvac'

const F = 'Tahoma, Arial, sans-serif'
const M = '"SF Mono", Consolas, Monaco, monospace'
const ink = '#2c3e57', muted = '#7a8fa8', accent = '#3b567f', border = '#c8d0db'

export interface ApprovalReq { id: string; kind: 'connect' | 'tx' | 'sign' | 'privbal' | 'fheprove' | 'fhedecrypt' | 'fhedeposit' | 'stealthsend' | 'stealthscan' | 'stealthviewpub'; origin: string; data: any }
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
    try {
      if (req.kind === 'fheprove' || req.kind === 'fhedecrypt' || req.kind === 'fhedeposit' || req.kind === 'stealthsend' || req.kind === 'stealthscan' || req.kind === 'stealthviewpub') {
        // Run the FHE/stealth op in the popup (pvac wasm + stealth crypto live here) with the connected
        // account's key, then hand ONLY the result back. The seed/key never leaves the wallet.
        if (!approved) { await api.fheProveResolve(req.id, false); onDone(); return }
        const result = req.kind === 'fheprove'
          ? await proveValues(req.data.address, req.data.values, req.data.blindings)
          : req.kind === 'fhedecrypt'
            ? await decryptCipher(req.data.address, req.data.cipher)
            : req.kind === 'fhedeposit'
              ? await depositProofs(req.data.address, req.data.items, req.data.amtBlindings)
              : req.kind === 'stealthsend'
                ? await stealthSend(req.data.address, req.data.recipientPub, req.data.tokenCipher, req.data.amount)
                : req.kind === 'stealthscan'
                  ? await stealthScan(req.data.address, req.data.notes)
                  : await stealthViewPub(req.data.address)
        await api.fheProveResolve(req.id, true, result)
      } else {
        await api.approvalResolve(req.id, approved, accounts[pick]?.address)
      }
    } catch {
      try { if (req.kind === 'fheprove' || req.kind === 'fhedecrypt' || req.kind === 'fhedeposit') await api.fheProveResolve(req.id, false) } catch { /* */ }
    }
    onDone()
  }

  return (
    <div style={{ padding: 20, minHeight: 600, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontFamily: F, fontSize: 12, color: muted, textTransform: 'uppercase', letterSpacing: '1px' }}>
        {req.kind === 'connect' ? t('connection_request') : req.kind === 'privbal' ? 'see your private balance' : req.kind === 'fheprove' ? 'private proof request' : req.kind === 'fhedecrypt' ? 'reveal private balance' : req.kind === 'fhedeposit' ? 'confidential deposit' : t('signature_request')}
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
      ) : req.kind === 'sign' ? <SignSummary d={req.data} /> : req.kind === 'privbal' ? <PrivBalSummary /> : req.kind === 'fheprove' ? <FheProveSummary d={req.data} /> : req.kind === 'fhedecrypt' ? <FheDecryptSummary /> : req.kind === 'fhedeposit' ? <FheDepositSummary d={req.data} /> : <TxSummary d={req.data} />}

      <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
        <button disabled={busy} onClick={() => decide(false)} style={{ ...b, background: 'transparent', color: accent, border: `1px solid ${border}` }}>{t('reject')}</button>
        <button disabled={busy} onClick={() => decide(true)} style={{ ...b }}>{busy ? '…' : req.kind === 'connect' ? t('connect') : req.kind === 'privbal' ? 'allow' : req.kind === 'fhedecrypt' ? 'reveal' : req.kind === 'fhedeposit' ? 'deposit' : t('approve')}</button>
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
  if (d.kind === 'multiExec') { try { return d.ou ? BigInt(d.ou) : 5_000n } catch { return 5_000n } }
  if (d.kind === 'deploy') return 200_000n
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

// Message-signing request (dapp auth / nft-gated content). Shows the exact message and
// makes clear it is NOT a transaction: no funds move, no network fee.
function SignSummary({ d }: { d: any }) {
  return (
    <Block>
      <div style={{ fontFamily: F, fontSize: 12, color: muted, marginBottom: 6 }}>message to sign</div>
      <div style={{ fontFamily: M, fontSize: 12, color: ink, wordBreak: 'break-all', whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', background: '#f4f6f9', border: `1px solid ${border}`, padding: 10 }}>
        {String(d.message ?? '')}
      </div>
      <p style={{ fontFamily: F, fontSize: 12, color: muted, lineHeight: 1.5, margin: '10px 0 0' }}>
        signing proves you control this account. it does not move funds and costs no fee.
      </p>
    </Block>
  )
}

// Confidential-AMM proof request: the site asks the wallet to build a bound proof for these
// amounts with this account's FHE key. The amounts stay in the wallet; only the proof (which
// reveals nothing about them or the key) is returned. No funds move and no fee is charged here.
function FheProveSummary({ d }: { d: any }) {
  const vals: string[] = Array.isArray(d.values) ? d.values : []
  return (
    <Block>
      <div style={{ fontFamily: F, fontSize: 12, color: muted, marginBottom: 6 }}>build a private proof for</div>
      <div style={{ fontFamily: M, fontSize: 13, color: ink, background: '#f4f6f9', border: `1px solid ${border}`, padding: 10, maxHeight: 180, overflowY: 'auto' }}>
        {vals.map((v, i) => <div key={i}>{v}</div>)}
      </div>
      <p style={{ fontFamily: F, fontSize: 12, color: muted, lineHeight: 1.5, margin: '10px 0 0' }}>
        the proof is built inside the wallet with your key. your key never leaves the wallet and the
        amounts are not revealed on-chain. no funds move and there is no fee for this.
      </p>
    </Block>
  )
}

// Запрос на показ скрытого остатка самому сайту. Спрашивается один раз на место:
// дальше сайт видит остаток без окна, пока человек не отключит его в списке
// подключённых. Денег это не двигает и сбора не берёт.
function PrivBalSummary() {
  return (
    <Block>
      <div style={{ fontFamily: F, fontSize: 12, color: muted, marginBottom: 6 }}>this site wants to see your private balance</div>
      <p style={{ fontFamily: F, fontSize: 12, color: muted, lineHeight: 1.5, margin: 0 }}>
        your private balance is hidden on-chain and only your key can read it. allowing this lets
        the site read the amount from now on, until you disconnect it. no funds move and there is
        no fee.
      </p>
    </Block>
  )
}

// Reveal-private-balance request: the site asks the wallet to decrypt one of this account's own
// confidential ciphertexts (e.g. a shielded token balance) so the owner can see the amount. The
// cipher is decrypted with this account's key inside the wallet; only the resulting number goes
// back to the page. No funds move and no fee is charged.
function FheDecryptSummary() {
  return (
    <Block>
      <div style={{ fontFamily: F, fontSize: 12, color: muted, marginBottom: 6 }}>reveal your private balance</div>
      <p style={{ fontFamily: F, fontSize: 12, color: muted, lineHeight: 1.5, margin: 0 }}>
        this decrypts one of your own confidential amounts with your key, inside the wallet, so only
        you see it. your key never leaves the wallet. no funds move and there is no fee for this.
      </p>
    </Block>
  )
}

// Confidential-deposit request: the site asks the wallet to spend hidden amounts out of this
// account's shielded token balances into a private pool. The wallet builds the ciphertext + a
// solvency proof (balance stays >= 0) with this account's key; only those are returned. The amounts
// are never revealed on-chain and no amount is shown to the site.
function FheDepositSummary({ d }: { d: any }) {
  const items: any[] = Array.isArray(d.items) ? d.items : []
  return (
    <Block>
      <div style={{ fontFamily: F, fontSize: 12, color: muted, marginBottom: 6 }}>deposit into a private pool</div>
      <div style={{ fontFamily: M, fontSize: 13, color: ink, background: '#f4f6f9', border: `1px solid ${border}`, padding: 10 }}>
        {items.map((it, i) => <div key={i}>amount {i + 1}: {String(it.amount)}</div>)}
      </div>
      <p style={{ fontFamily: F, fontSize: 12, color: muted, lineHeight: 1.5, margin: '10px 0 0' }}>
        this spends the shown amounts from your shielded balance and proves, with your key inside the
        wallet, that your balance stays covered. the amounts are not revealed on-chain and your key
        never leaves the wallet.
      </p>
    </Block>
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

  if (d.kind === 'deploy') {
    return (
      <Block>
        <Row label="deploy" value="new contract" />
        <Row label="bytecode" value={`${Math.ceil((d.bytecode?.length || 0) * 3 / 4 / 1024)} KB`} />
        <Row label="constructor args" value={JSON.stringify(d.params ?? [])} mono />
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

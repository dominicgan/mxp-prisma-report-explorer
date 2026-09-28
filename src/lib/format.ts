const nf = new Intl.NumberFormat('en-US')
const nfCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function num(n: number | undefined | null): string {
  return n == null ? '-' : nf.format(n)
}

export function compact(n: number | undefined | null): string {
  return n == null ? '-' : n < 10_000 ? nf.format(n) : nfCompact.format(n)
}

export function pct(part: number, whole: number): string {
  if (!whole) return '0%'
  const p = (part / whole) * 100
  return `${p < 1 && p > 0 ? p.toFixed(1) : Math.round(p)}%`
}

/** Dates are stored as UTC ISO; render them in UTC so they never shift by a day. */
export function date(iso: unknown): string {
  if (!iso) return ''
  const t = Date.parse(String(iso))
  if (Number.isNaN(t)) return String(iso)
  return new Date(t).toISOString().slice(0, 10)
}

export function dateTime(iso: unknown): string {
  if (!iso) return ''
  const t = Date.parse(String(iso))
  if (Number.isNaN(t)) return String(iso)
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export function cvss(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(1) : String(v)
}

/** `myexpress-services/myexpress-adt-services` -> `myexpress-adt-services`. */
export function shortRepo(repo: unknown): string {
  const s = String(repo ?? '')
  const i = s.lastIndexOf('/')
  return i === -1 ? s : s.slice(i + 1)
}

export function truncate(s: unknown, n: number): string {
  const v = String(s ?? '')
  return v.length <= n ? v : `${v.slice(0, n - 1)}…`
}

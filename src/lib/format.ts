/** Format monétaire FCFA : 12500 -> "12 500 F" */
export function fcfa(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  const s = Math.abs(v).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')
  return (v < 0 ? '-' : '') + s + ' F'
}

/** Nombre simple : 12500 -> "12 500" */
export function num(n: number): string {
  return Math.round(Number.isFinite(n) ? n : 0)
    .toLocaleString('fr-FR')
    .replace(/\u202f|\u00a0/g, ' ')
}

/** Date locale "YYYY-MM-DD" (indépendante du fuseau horaire) */
export function todayISO(): string {
  return toISO(new Date())
}

export function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0)
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

export function formatDateFr(iso: string): string {
  if (!iso) return '—'
  return parseISO(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatDateShort(iso: string): string {
  if (!iso) return '—'
  return parseISO(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

export function monthLabel(iso: string): string {
  return parseISO(iso + (iso.length === 7 ? '-01' : '')).toLocaleDateString('fr-FR', {
    month: 'short',
    year: '2-digit',
  })
}

export function pct(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  const sign = v > 0 ? '+' : ''
  return `${sign}${Math.round(v * 100) / 100} %`
}

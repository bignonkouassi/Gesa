import type { Credit, CreditPayment, CreditStatus, DB, Item, Sale } from './types'
import { addDays, parseISO, toISO } from './format'

/* ------------------------------------------------------------------ */
/* Périodes                                                            */
/* ------------------------------------------------------------------ */

export type RangeMode = 'jour' | 'semaine' | 'mois' | 'année'

export interface Range {
  from: string // inclusif, ISO
  to: string // exclusif, ISO
}

/** Lundi de la semaine contenant d */
export function startOfWeek(d: Date): Date {
  const c = new Date(d)
  const day = (c.getDay() + 6) % 7 // 0 = lundi
  c.setDate(c.getDate() - day)
  c.setHours(12, 0, 0, 0)
  return c
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0)
}

export function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1, 12, 0, 0, 0)
}

export function rangeFor(mode: RangeMode, base = new Date()): Range {
  if (mode === 'jour') {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12)
    return { from: toISO(d), to: toISO(addDays(d, 1)) }
  }
  if (mode === 'semaine') {
    const s = startOfWeek(base)
    return { from: toISO(s), to: toISO(addDays(s, 7)) }
  }
  if (mode === 'mois') {
    const s = startOfMonth(base)
    const next = new Date(s.getFullYear(), s.getMonth() + 1, 1, 12)
    return { from: toISO(s), to: toISO(next) }
  }
  const s = startOfYear(base)
  const next = new Date(s.getFullYear() + 1, 0, 1, 12)
  return { from: toISO(s), to: toISO(next) }
}

/** Période précédente de même longueur, juste avant `range` */
export function previousRange(mode: RangeMode, range: Range): Range {
  const from = parseISO(range.from)
  if (mode === 'jour') {
    const nFrom = addDays(from, -1)
    return { from: toISO(nFrom), to: range.from }
  }
  if (mode === 'semaine') {
    return { from: toISO(addDays(from, -7)), to: range.from }
  }
  if (mode === 'mois') {
    const prev = new Date(from.getFullYear(), from.getMonth() - 1, 1, 12)
    return { from: toISO(prev), to: range.from }
  }
  const prev = new Date(from.getFullYear() - 1, 0, 1, 12)
  return { from: toISO(prev), to: range.from }
}

export function inRange(date: string, r: Range): boolean {
  return date >= r.from && date < r.to
}

/* ------------------------------------------------------------------ */
/* Crédits                                                             */
/* ------------------------------------------------------------------ */

export function creditRest(c: Credit): number {
  return Math.max(0, c.total_amount - c.amount_paid)
}

/** Statut calculé : soldé > en retard > partiellement payé > en cours */
export function computeCreditStatus(c: Credit, today: string): CreditStatus {
  if (c.amount_paid + 0.001 >= c.total_amount) return 'soldé'
  if (c.due_date && c.due_date < today) return 'en retard'
  if (c.amount_paid > 0) return 'partiellement payé'
  return 'en cours'
}

export function isLate(c: Credit, today: string): boolean {
  return computeCreditStatus(c, today) === 'en retard'
}

export const CREDIT_STATUS_COLORS: Record<CreditStatus, string> = {
  soldé: 'bg-emerald-100 text-emerald-800',
  'en cours': 'bg-amber-100 text-amber-800',
  'partiellement payé': 'bg-orange-100 text-orange-800',
  'en retard': 'bg-red-100 text-red-800',
}

/* ------------------------------------------------------------------ */
/* Réapprovisionnements : coût moyen pondéré                          */
/* ------------------------------------------------------------------ */

export interface RecomputedItem {
  stock: number
  cost_price: number
}

/**
 * Recalcule le stock et le coût moyen d'un article en rejouant tous ses
 * événements (réappro + ventes) dans l'ordre chronologique, à partir du
 * stock initial. Utilisé lors de la correction/suppression d'un réappro.
 */
export function recomputeItem(db: DB, itemId: string): RecomputedItem {
  const item = db.items.find((i) => i.id === itemId)
  if (!item) return { stock: 0, cost_price: 0 }

  type Ev = { date: string; created_at: string; kind: 'restock' | 'sale'; q: number; cost?: number }
  const events: Ev[] = [
    ...db.restocks
      .filter((r) => r.item_id === itemId)
      .map((r) => ({
        date: r.restock_date,
        created_at: r.created_at,
        kind: 'restock' as const,
        q: r.quantity,
        cost: r.unit_cost,
      })),
    ...db.sales
      .filter((s) => s.item_id === itemId)
      .map((s) => ({
        date: s.sale_date,
        created_at: s.created_at,
        kind: 'sale' as const,
        q: s.quantity,
      })),
  ].sort((a, b) =>
    a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date),
  )

  let qty = item.opening_stock
  let cost = item.opening_cost

  for (const ev of events) {
    if (ev.kind === 'restock') {
      const lotCost = ev.cost ?? cost
      cost = qty <= 0 ? lotCost : (qty * cost + ev.q * lotCost) / (qty + ev.q)
      qty += ev.q
    } else {
      qty = Math.max(0, qty - ev.q)
    }
  }
  return { stock: qty, cost_price: cost }
}

/* ------------------------------------------------------------------ */
/* Statistiques                                                        */
/* ------------------------------------------------------------------ */

export interface PeriodStats {
  revenue: number
  profit: number
  spent: number // dépenses de réappro (argent sorti)
  salesCount: number
  quantity: number
  profitEncaisse: number
  profitAttente: number
  revenueCredit: number
}

export const emptyStats = (): PeriodStats => ({
  revenue: 0,
  profit: 0,
  spent: 0,
  salesCount: 0,
  quantity: 0,
  profitEncaisse: 0,
  profitAttente: 0,
  revenueCredit: 0,
})

/* ------------------------------------------------------------------ */
/* Périodes passées (semaines et mois)                                 */
/* ------------------------------------------------------------------ */

export interface PeriodSummary {
  key: string
  label: string
  shortLabel: string
  range: Range
  stats: PeriodStats
}

/** Numéro de semaine ISO (semaine commençant le lundi) */
export function isoWeek(d: Date): { week: number; year: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { week, year: date.getUTCFullYear() }
}

export function weekLabel(range: Range): string {
  const { week, year } = isoWeek(parseISO(range.from))
  const end = addDays(parseISO(range.from), 6)
  const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  return `Semaine ${week} · du ${fmt(parseISO(range.from))} au ${fmt(end)} ${year}`
}

export function monthNameLabel(year: number, month: number): string {
  return new Date(year, month, 1, 12)
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    .replace(/^./, (c) => c.toUpperCase())
}

/** Liste des semaines (lundi→dimanche) qui contiennent au moins une activité */
export function listWeekPeriods(db: DB, sales: Sale[], restocks: DB['restocks']): PeriodSummary[] {
  const keys = new Map<string, Range>()
  for (const s of sales) {
    const r = rangeFor('semaine', parseISO(s.sale_date))
    keys.set(r.from, r)
  }
  for (const r of restocks) {
    const rg = rangeFor('semaine', parseISO(r.restock_date))
    keys.set(rg.from, rg)
  }
  return [...keys.values()]
    .sort((a, b) => b.from.localeCompare(a.from))
    .map((range) => ({
      key: range.from,
      label: weekLabel(range),
      shortLabel: `S${isoWeek(parseISO(range.from)).week}`,
      range,
      stats: statsFor(db, sales, range, restocks),
    }))
}

/** Liste des mois qui contiennent au moins une activité */
export function listMonthPeriods(db: DB, sales: Sale[], restocks: DB['restocks']): PeriodSummary[] {
  const keys = new Map<string, Range>()
  for (const s of sales) {
    const r = rangeFor('mois', parseISO(s.sale_date))
    keys.set(r.from, r)
  }
  for (const r of restocks) {
    const rg = rangeFor('mois', parseISO(r.restock_date))
    keys.set(rg.from, rg)
  }
  return [...keys.values()]
    .sort((a, b) => b.from.localeCompare(a.from))
    .map((range) => {
      const d = parseISO(range.from)
      return {
        key: range.from,
        label: monthNameLabel(d.getFullYear(), d.getMonth()),
        shortLabel: monthNameLabel(d.getFullYear(), d.getMonth()).slice(0, 3),
        range,
        stats: statsFor(db, sales, range, restocks),
      }
    })
}

export function saleProfit(s: Sale): number {
  return (s.unit_price - s.unit_cost) * s.quantity
}

export function saleRevenue(s: Sale): number {
  return s.unit_price * s.quantity
}

/** Fraction déjà encaissée d'une vente à crédit (0..1) */
function paidFraction(sale: Sale, credits: Credit[]): number {
  if (sale.payment_type !== 'crédit') return 1
  const c = credits.find((x) => x.sale_id === sale.id)
  if (!c || c.total_amount <= 0) return 1
  return Math.min(1, Math.max(0, c.amount_paid / c.total_amount))
}

export function statsFor(
  db: DB,
  sales: Sale[],
  range: Range,
  restocks: DB['restocks'] = db.restocks,
): PeriodStats {
  const st = emptyStats()
  for (const s of sales) {
    if (!inRange(s.sale_date, range)) continue
    const profit = saleProfit(s)
    const frac = paidFraction(s, db.credits)
    st.revenue += saleRevenue(s)
    st.profit += profit
    st.salesCount += 1
    st.quantity += s.quantity
    st.profitEncaisse += profit * frac
    st.profitAttente += profit * (1 - frac)
    if (s.payment_type === 'crédit') st.revenueCredit += saleRevenue(s)
  }
  for (const r of restocks) {
    if (!inRange(r.restock_date, range)) continue
    st.spent += r.quantity * r.unit_cost
  }
  return st
}

export interface Comparison {
  pct: number | null // null = pas de période précédente
  previous: PeriodStats
}

export function compare<T extends object>(current: T, previous: T, key: keyof T & string): number | null {
  const prev = (previous as unknown as Record<string, number>)[key]
  const cur = (current as unknown as Record<string, number>)[key]
  if (Math.abs(prev) < 0.5) return cur > 0 ? null : 0
  return ((cur - prev) / Math.abs(prev)) * 100
}

/* ------------------------------------------------------------------ */
/* Graphiques                                                          */
/* ------------------------------------------------------------------ */

export interface Bucket {
  label: string
  revenue: number
  profit: number
}

export interface ChartData {
  buckets: Bucket[]
  mode: RangeMode
  range: Range
  totals: PeriodStats
  previous: PeriodStats
  comparePct: number | null
  compareLabel: string
}

const DAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

function bucketLabel(d: Date, mode: RangeMode): string {
  if (mode === 'semaine') return DAY_SHORT[(d.getDay() + 6) % 7]
  if (mode === 'mois') return String(d.getDate())
  return d.toLocaleDateString('fr-FR', { month: 'short' })
}

/** Construit les données du graphique en barres (CA + bénéfice par période) */
export function buildChart(db: DB, scope: string | null, mode: RangeMode, year?: number): ChartData {
  const range = mode === 'année' && year ? { from: `${year}-01-01`, to: `${year + 1}-01-01` } : rangeFor(mode)
  const prevRange = previousRange(mode, range)
  const sales = scope ? db.sales.filter((s) => s.shop_id === scope) : db.sales
  const restocks = scope ? db.restocks.filter((r) => r.shop_id === scope) : db.restocks

  const buckets: Bucket[] = []
  if (mode === 'année') {
    const y = parseISO(range.from).getFullYear()
    for (let m = 0; m < 12; m++) {
      const d = new Date(y, m, 1, 12)
      buckets.push({ label: bucketLabel(d, 'année'), revenue: 0, profit: 0 })
    }
    for (const s of sales) {
      const d = parseISO(s.sale_date)
      if (d.getFullYear() !== y) continue
      buckets[d.getMonth()].revenue += saleRevenue(s)
      buckets[d.getMonth()].profit += saleProfit(s)
    }
  } else {
    const start = parseISO(range.from)
    const days = mode === 'semaine' ? 7 : Math.round((parseISO(range.to).getTime() - start.getTime()) / 86400000)
    for (let i = 0; i < days; i++) buckets.push({ label: bucketLabel(addDays(start, i), mode), revenue: 0, profit: 0 })
    for (const s of sales) {
      if (!inRange(s.sale_date, range)) continue
      const idx = Math.round((parseISO(s.sale_date).getTime() - start.getTime()) / 86400000)
      if (idx < 0 || idx >= buckets.length) continue
      buckets[idx].revenue += saleRevenue(s)
      buckets[idx].profit += saleProfit(s)
    }
  }

  const totals = statsFor(db, sales, range, restocks)
  const previous = statsFor(db, sales, prevRange, restocks)
  const compareLabel =
    mode === 'semaine'
      ? 'vs semaine dernière'
      : mode === 'mois'
        ? 'vs mois dernier'
        : mode === 'année'
          ? 'vs année dernière'
          : 'vs hier'

  return {
    buckets,
    mode,
    range,
    totals,
    previous,
    comparePct: compare(totals, previous, 'profit'),
    compareLabel,
  }
}

/* ------------------------------------------------------------------ */
/* Top articles                                                        */
/* ------------------------------------------------------------------ */

export interface TopRow {
  item_id: string
  name: string
  quantity: number
  revenue: number
  profit: number
  marginPct: number
}

export function topProducts(sales: Sale[], range: Range | null, limit = 5): TopRow[] {
  const map = new Map<string, TopRow>()
  for (const s of sales) {
    if (range && !inRange(s.sale_date, range)) continue
    const row = map.get(s.item_id) ?? {
      item_id: s.item_id,
      name: s.item_name,
      quantity: 0,
      revenue: 0,
      profit: 0,
      marginPct: 0,
    }
    row.quantity += s.quantity
    row.revenue += saleRevenue(s)
    row.profit += saleProfit(s)
    map.set(s.item_id, row)
  }
  const rows = [...map.values()]
  rows.forEach((r) => {
    r.marginPct = r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0
  })
  return rows.sort((a, b) => b.quantity - a.quantity).slice(0, limit)
}

export function topBy(
  sales: Sale[],
  range: Range | null,
  key: 'quantity' | 'profit' | 'margin',
  limit = 5,
): TopRow[] {
  const scoped = range ? sales.filter((s) => inRange(s.sale_date, range)) : sales
  const base = topProducts(scoped, null, Number.MAX_SAFE_INTEGER)
  if (key === 'quantity') return base.sort((a, b) => b.quantity - a.quantity).slice(0, limit)
  if (key === 'profit') return base.sort((a, b) => b.profit - a.profit).slice(0, limit)
  return base.sort((a, b) => b.marginPct - a.marginPct).slice(0, limit)
}

/* ------------------------------------------------------------------ */
/* Stock                                                               */
/* ------------------------------------------------------------------ */

export interface StockValue {
  atCost: number
  atPrice: number
  units: number
}

export function stockValue(items: Item[]): StockValue {
  let atCost = 0
  let atPrice = 0
  let units = 0
  for (const i of items) {
    atCost += i.stock * i.cost_price
    atPrice += i.stock * i.price
    units += i.stock
  }
  return { atCost, atPrice, units }
}

export type StockStatus = 'rupture' | 'bas' | 'normal'

export function stockStatus(item: Item): StockStatus {
  if (item.stock <= 0) return 'rupture'
  if (item.stock <= item.low_stock_threshold) return 'bas'
  return 'normal'
}

/* ------------------------------------------------------------------ */
/* Bilan annuel                                                        */
/* ------------------------------------------------------------------ */

export interface YearMonthRow {
  month: number // 0..11
  label: string
  revenue: number
  profit: number
  marginPct: number
  evolutionPct: number | null
}

export interface YearSummary {
  year: number
  rows: YearMonthRow[]
  totals: PeriodStats
  bestMonth: { label: string; profit: number } | null
  worstMonth: { label: string; profit: number } | null
  top10Qty: TopRow[]
  top10Profit: TopRow[]
  credits: { granted: number; paid: number; outstanding: number }
  previous: PeriodStats | null
  previousYear: number | null
}

export function availableYears(sales: Sale[], restocks: DB['restocks']): number[] {
  const years = new Set<number>()
  const current = new Date().getFullYear()
  years.add(current)
  for (const s of sales) years.add(parseISO(s.sale_date).getFullYear())
  for (const r of restocks) years.add(parseISO(r.restock_date).getFullYear())
  return [...years].sort((a, b) => b - a)
}

export function yearSummary(
  db: DB,
  sales: Sale[],
  restocks: DB['restocks'],
  credits: Credit[],
  payments: CreditPayment[],
  year: number,
): YearSummary {
  const range: Range = { from: `${year}-01-01`, to: `${year + 1}-01-01` }
  const prevRange: Range = { from: `${year - 1}-01-01`, to: `${year}-01-01` }
  const rows: YearMonthRow[] = []
  for (let m = 0; m < 12; m++) {
    const monthRange: Range = {
      from: `${year}-${String(m + 1).padStart(2, '0')}-01`,
      to: m === 11 ? `${year + 1}-01-01` : `${year}-${String(m + 2).padStart(2, '0')}-01`,
    }
    const st = statsFor(db, sales, monthRange, restocks)
    rows.push({
      month: m,
      label: new Date(year, m, 1, 12).toLocaleDateString('fr-FR', { month: 'short' }),
      revenue: st.revenue,
      profit: st.profit,
      marginPct: st.revenue > 0 ? (st.profit / st.revenue) * 100 : 0,
      evolutionPct: null,
    })
  }
  for (let i = 1; i < rows.length; i++) {
    rows[i].evolutionPct = compare(rows[i], rows[i - 1], 'profit')
  }

  const totals = statsFor(db, sales, range, restocks)
  const prevTotals = sales.some((s) => s.sale_date >= prevRange.from && s.sale_date < prevRange.to)
    ? statsFor(db, sales, prevRange, restocks)
    : null

  const withSales = rows.filter((r) => r.revenue > 0 || r.profit > 0)
  const best = withSales.length
    ? withSales.reduce((a, b) => (b.profit > a.profit ? b : a))
    : null
  const worst = withSales.length
    ? withSales.reduce((a, b) => (b.profit < a.profit ? b : a))
    : null

  const yearSales = sales.filter((s) => inRange(s.sale_date, range))
  const granted = credits
    .filter((c) => inRange(c.sale_date, range))
    .reduce((a, c) => a + c.total_amount, 0)
  const paid = payments
    .filter((p) => inRange(p.payment_date, range))
    .reduce((a, p) => a + p.amount, 0)
  const outstanding = credits
    .filter((c) => inRange(c.sale_date, range))
    .reduce((a, c) => a + creditRest(c), 0)

  const all = topProducts(yearSales, null, Number.MAX_SAFE_INTEGER)
  return {
    year,
    rows,
    totals,
    bestMonth: best ? { label: best.label, profit: best.profit } : null,
    worstMonth: worst ? { label: worst.label, profit: worst.profit } : null,
    top10Qty: [...all].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    top10Profit: [...all].sort((a, b) => b.profit - a.profit).slice(0, 10),
    credits: { granted, paid, outstanding },
    previous: prevTotals,
    previousYear: prevTotals ? year - 1 : null,
  }
}

/** Alertes visibles sur le tableau de bord */
export interface DashboardAlerts {
  lateCredits: Credit[]
  lowStock: Item[]
}

export function collectAlerts(db: DB, items: Item[], today: string): DashboardAlerts {
  const lateCredits = db.credits.filter((c) => computeCreditStatus(c, today) === 'en retard')
  const lowStock = items.filter((i) => stockStatus(i) !== 'normal')
  return { lateCredits, lowStock }
}

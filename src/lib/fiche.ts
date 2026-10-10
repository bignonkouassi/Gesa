import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { DB } from './types'
import {
  computeCreditStatus,
  creditRest,
  inRange,
  saleProfit,
  saleRevenue,
  stockStatus,
  stockValue,
  topProducts,
  type Range,
  type RangeMode,
} from './calc'
import { fcfa, formatDateShort, num, todayISO } from './format'
import { csvCell, safeCell } from './sanitize'

export type FicheFormat = 'pdf' | 'excel' | 'csv'

export interface FicheArticleRow {
  itemId: string
  name: string
  quantity: number
  revenue: number
  profit: number
  marginPct: number
  stock: number
}

export interface FicheData {
  shopLabel: string
  periodLabel: string
  fileBase: string
  range: Range
  generatedAt: string
  stats: {
    revenue: number
    profit: number
    spent: number
    salesCount: number
    quantity: number
    profitEncaisse: number
    profitAttente: number
  }
  compareLabel: string
  comparePct: number | null
  perArticle: FicheArticleRow[]
  topQuantity: { name: string; quantity: number }[]
  topProfit: { name: string; profit: number }[]
  lowStock: { name: string; stock: number; status: string }[]
  credits: { granted: number; refunded: number; outstanding: number; debtors: number }
  stockValue: { atCost: number; atPrice: number; units: number }
  buckets: { label: string; revenue: number; profit: number }[]
  hasSales: boolean
}

/** "Boutique Eau" -> "Boutique-Eau" */
export function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function compareLabelFor(mode: RangeMode | 'personnalisée'): string {
  return mode === 'semaine'
    ? 'vs semaine dernière'
    : mode === 'mois'
      ? 'vs mois dernier'
      : mode === 'année'
        ? 'vs année dernière'
        : mode === 'jour'
          ? 'vs hier'
          : 'vs période précédente'
}

/** Construit toutes les données de la fiche pour une période donnée */
export function buildFiche(
  db: DB,
  scope: string | null,
  range: Range,
  periodLabel: string,
  fileBase: string,
  compareLabel: string,
  comparePct: number | null,
): FicheData {
  const sales = (scope ? db.sales.filter((s) => s.shop_id === scope) : db.sales).filter((s) =>
    inRange(s.sale_date, range),
  )
  const restocks = (scope ? db.restocks.filter((r) => r.shop_id === scope) : db.restocks).filter((r) =>
    inRange(r.restock_date, range),
  )
  const items = scope ? db.items.filter((i) => i.shop_id === scope) : db.items

  let revenue = 0
  let profit = 0
  let quantity = 0
  let profitEncaisse = 0
  let profitAttente = 0
  const byItem = new Map<string, FicheArticleRow>()

  for (const s of sales) {
    const p = saleProfit(s)
    const frac =
      s.payment_type !== 'crédit'
        ? 1
        : (() => {
            const c = db.credits.find((x) => x.sale_id === s.id)
            if (!c || c.total_amount <= 0) return 1
            return Math.min(1, Math.max(0, c.amount_paid / c.total_amount))
          })()
    revenue += saleRevenue(s)
    profit += p
    quantity += s.quantity
    profitEncaisse += p * frac
    profitAttente += p * (1 - frac)

    const row =
      byItem.get(s.item_id) ??
      ({
        itemId: s.item_id,
        name: s.item_name,
        quantity: 0,
        revenue: 0,
        profit: 0,
        marginPct: 0,
        stock: 0,
      } as FicheArticleRow)
    row.quantity += s.quantity
    row.revenue += saleRevenue(s)
    row.profit += p
    byItem.set(s.item_id, row)
  }

  for (const row of byItem.values()) {
    row.marginPct = row.revenue > 0 ? (row.profit / row.revenue) * 100 : 0
    const item = items.find((i) => i.id === row.itemId) ?? db.items.find((i) => i.id === row.itemId)
    row.stock = item ? item.stock : 0
  }
  const perArticle = [...byItem.values()].sort((a, b) => b.revenue - a.revenue)

  const creditsScoped = scope ? db.credits.filter((c) => c.shop_id === scope) : db.credits
  const paymentsScoped = scope ? db.credit_payments.filter((c) => c.shop_id === scope) : db.credit_payments
  const periodCredits = creditsScoped.filter((c) => inRange(c.sale_date, range))
  const granted = periodCredits.reduce((a, c) => a + c.total_amount, 0)
  const refunded = paymentsScoped.filter((p) => inRange(p.payment_date, range)).reduce((a, p) => a + p.amount, 0)
  const outstanding = periodCredits.reduce((a, c) => a + creditRest(c), 0)
  const debtors = new Set(
    periodCredits.filter((c) => creditRest(c) > 0.001 && computeCreditStatus(c, todayISO()) !== 'soldé').map((c) => c.customer_id),
  ).size

  const top = topProducts(sales, null, 5)
  const sv = stockValue(items)
  const spent = restocks.reduce((a, r) => a + r.quantity * r.unit_cost, 0)

  return {
    shopLabel: scope ? (db.shops.find((s) => s.id === scope)?.name ?? 'Boutique') : 'Toutes les boutiques',
    periodLabel,
    fileBase,
    range,
    generatedAt: todayISO(),
    stats: {
      revenue,
      profit,
      spent,
      salesCount: sales.length,
      quantity,
      profitEncaisse,
      profitAttente,
    },
    compareLabel,
    comparePct,
    perArticle,
    topQuantity: [...top].sort((a, b) => b.quantity - a.quantity).map((t) => ({ name: t.name, quantity: t.quantity })),
    topProfit: [...top].sort((a, b) => b.profit - a.profit).map((t) => ({ name: t.name, profit: t.profit })),
    lowStock: items
      .filter((i) => stockStatus(i) !== 'normal')
      .map((i) => ({ name: i.name, stock: i.stock, status: stockStatus(i) === 'rupture' ? 'Rupture' : 'Stock bas' })),
    credits: { granted, refunded, outstanding, debtors },
    stockValue: sv,
    buckets: buildBuckets(sales, range),
    hasSales: sales.length > 0,
  }
}

function buildBuckets(sales: DB['sales'], range: Range): { label: string; revenue: number; profit: number }[] {
  const start = new Date(`${range.from}T12:00:00`)
  const end = new Date(`${range.to}T12:00:00`)
  const days = Math.round((end.getTime() - start.getTime()) / 86400000)
  const daily = days <= 31
  const buckets = new Map<string, { label: string; revenue: number; profit: number }>()

  if (daily) {
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12)
      buckets.set(iso(d), {
        label: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
        revenue: 0,
        profit: 0,
      })
    }
  }
  for (const s of sales) {
    const d = new Date(`${s.sale_date}T12:00:00`)
    const key = daily
      ? s.sale_date
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
        revenue: 0,
        profit: 0,
      })
    }
    const b = buckets.get(key) as { label: string; revenue: number; profit: number }
    b.revenue += saleRevenue(s)
    b.profit += saleProfit(s)
  }
  return [...buckets.values()]
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/* ------------------------------------------------------------------ */
/* Téléchargement                                                      */
/* ------------------------------------------------------------------ */

export function downloadFiche(data: FicheData, format: FicheFormat): void {
  if (format === 'pdf') downloadPdf(data)
  else if (format === 'excel') downloadExcel(data)
  else downloadCsv(data)
}

/** Déclenche un téléchargement sans couper le flux (ancre retirée après un délai) */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  window.setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 15000)
}

/* ---------------- Logo de l'application dans les PDF ---------------- */

let logoCache: string | null = null
let logoLoading: Promise<string | null> | null = null

function loadLogo(): Promise<string | null> {
  if (logoCache) return Promise.resolve(logoCache)
  if (!logoLoading) {
    logoLoading = fetch('/logo-pdf.png')
      .then((r) => {
        if (!r.ok) throw new Error('logo introuvable')
        return r.blob()
      })
      .then(
        (b) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader()
            fr.onload = () => resolve(String(fr.result))
            fr.onerror = () => reject(new Error('lecture logo impossible'))
            fr.readAsDataURL(b)
          }),
      )
      .then((d) => (logoCache = d))
      .catch(() => null)
  }
  return logoLoading
}

/** À appeler au démarrage : le logo est prêt quand l'utilisateur exporte. */
export function preloadLogo(): void {
  void loadLogo()
}

export function logoDataUrl(): string | null {
  if (!logoCache) void loadLogo()
  return logoCache
}

/** Logo en haut à droite (optionnel : absent silencieusement si indisponible). */
export function drawLogoTopRight(doc: import('jspdf').jsPDF, size = 26): void {
  const url = logoDataUrl()
  if (!url) return
  try {
    const w = doc.internal.pageSize.getWidth()
    doc.addImage(url, 'PNG', w - 14 - size, 10, size, size)
  } catch {
    /* logo décoratif : ne bloque jamais l'export */
  }
}

/** Impression navigateur : le nom du fichier PDF vient du titre de la page. */
export function printWithTitle(title: string): void {  const prev = document.title
  const done = () => {
    document.title = prev
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  document.title = title
  window.print()
  // Sécurité : si afterprint ne se déclenche pas, restaure après un délai
  window.setTimeout(() => {
    if (document.title === title) {
      document.title = prev
      window.removeEventListener('afterprint', done)
    }
  }, 5000)
}

function pctText(v: number | null): string {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : ''}${Math.round(v)} %`
}

/* ---------------- PDF ---------------- */

function downloadPdf(data: FicheData): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  let y = 16

  doc.setFontSize(17)
  doc.setTextColor(5, 150, 105)
  doc.text('Fiche de résultats', 14, y)
  drawLogoTopRight(doc)
  y += 7
  doc.setFontSize(10)
  doc.setTextColor(60)
  doc.text(`Boutique : ${data.shopLabel}`, 14, y)
  y += 5
  doc.text(`Période : ${data.periodLabel}`, 14, y)
  y += 5
  doc.text(`Générée le : ${formatDateShort(data.generatedAt)}`, 14, y)
  y += 8

  if (!data.hasSales) {
    doc.setTextColor(120)
    doc.text('Aucune vente sur cette période.', 14, y)
    y += 8
  }

  // Résumé
  autoTable(doc, {
    startY: y,
    head: [['Chiffre d’affaires', 'Bénéfice', 'Dépenses réappro', 'Ventes', 'Bénéfice encaissé', 'En attente']],
    body: [
      [
        fcfa(data.stats.revenue),
        fcfa(data.stats.profit),
        fcfa(data.stats.spent),
        num(data.stats.salesCount),
        fcfa(data.stats.profitEncaisse),
        fcfa(data.stats.profitAttente),
      ],
    ],
    styles: { fontSize: 9, halign: 'center' },
    headStyles: { fillColor: [5, 150, 105] },
  })
  y = lastY(doc) + 4
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text(`Comparaison : ${pctText(data.comparePct)} ${data.compareLabel}`, 14, y)
  y += 6

  // Graphique
  if (data.buckets.length > 0) {
    doc.setFontSize(11)
    doc.setTextColor(40)
    doc.text('Graphique de la période', 14, y)
    y += 3
    const h = 32
    const max = Math.max(1, ...data.buckets.map((b) => Math.max(b.revenue, b.profit)))
    const areaW = W - 28
    const groupW = areaW / data.buckets.length
    doc.setDrawColor(220)
    doc.line(14, y + h, 14 + areaW, y + h)
    data.buckets.forEach((b, i) => {
      const x = 14 + i * groupW
      const hr = (b.revenue / max) * h
      const hp = (b.profit / max) * h
      doc.setFillColor(5, 150, 105)
      doc.rect(x + groupW * 0.1, y + h - hr, groupW * 0.38, Math.max(hr, b.revenue > 0 ? 0.6 : 0), 'F')
      doc.setFillColor(245, 158, 11)
      doc.rect(x + groupW * 0.52, y + h - hp, groupW * 0.38, Math.max(hp, b.profit > 0 ? 0.6 : 0), 'F')
    })
    y += h + 8
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.setFillColor(5, 150, 105)
    doc.rect(14, y - 3, 3, 3, 'F')
    doc.setTextColor(60)
    doc.text('Chiffre d’affaires', 19, y)
    doc.setFillColor(245, 158, 11)
    doc.rect(55, y - 3, 3, 3, 'F')
    doc.text('Bénéfice', 60, y)
    y += 7
  }

  // Par article
  if (data.perArticle.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Article', 'Qté vendue', 'Chiffre d’affaires', 'Bénéfice', 'Marge', 'Stock']],
      body: data.perArticle.map((r) => [
        r.name,
        num(r.quantity),
        fcfa(r.revenue),
        fcfa(r.profit),
        `${Math.round(r.marginPct)} %`,
        num(r.stock),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [5, 150, 105] },
    })
    y = lastY(doc) + 6
  }

  // Top 5
  autoTable(doc, {
    startY: y,
    head: [['Top 5 par quantité', 'Qté', 'Top 5 par bénéfice', 'Bénéfice']],
    body: [0, 1, 2, 3, 4].map((i) => [
      data.topQuantity[i]?.name ?? '—',
      data.topQuantity[i] ? num(data.topQuantity[i].quantity) : '—',
      data.topProfit[i]?.name ?? '—',
      data.topProfit[i] ? fcfa(data.topProfit[i].profit) : '—',
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [5, 150, 105] },
  })
  y = lastY(doc) + 6

  // Stock & crédits
  autoTable(doc, {
    startY: y,
    head: [['Stock', 'Valeur']],
    body: [
      ['Valeur au prix d’achat (argent investi)', fcfa(data.stockValue.atCost)],
      ['Valeur au prix de vente (gain potentiel)', fcfa(data.stockValue.atPrice)],
      ['Unités en stock', num(data.stockValue.units)],
      ['Articles en stock bas ou en rupture', data.lowStock.length === 0 ? 'Aucun' : data.lowStock.map((l) => `${l.name} (${l.stock})`).join(', ')],
      ['Crédits accordés sur la période', fcfa(data.credits.granted)],
      ['Remboursé sur la période', fcfa(data.credits.refunded)],
      ['Reste à récupérer', fcfa(data.credits.outstanding)],
      ['Clients débiteurs', num(data.credits.debtors)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [5, 150, 105] },
    columnStyles: { 1: { halign: 'right' } },
  })

  doc.save(`${data.fileBase}.pdf`)
}

function lastY(doc: jsPDF): number {
  const anyDoc = doc as unknown as { lastAutoTable?: { finalY: number } }
  return anyDoc.lastAutoTable?.finalY ?? 20
}

/* ---------------- Excel ---------------- */

/** Nettoie un objet de lignes avant export Excel (anti injection de formules) */
function safeRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'string' ? safeCell(v) : v
    return out as T
  })
}

function downloadExcel(data: FicheData): void {
  const wb = XLSX.utils.book_new()
  const json_to_sheet = (rows: Record<string, unknown>[]) => XLSX.utils.json_to_sheet(safeRows(rows))

  XLSX.utils.book_append_sheet(
    wb,
    json_to_sheet([
      { Boutique: data.shopLabel, Période: data.periodLabel, 'Générée le': formatDateShort(data.generatedAt) },
      { Boutique: 'Chiffre d’affaires', Période: data.stats.revenue },
      { Boutique: 'Bénéfice', Période: data.stats.profit },
      { Boutique: 'Dépenses de réappro', Période: data.stats.spent },
      { Boutique: 'Nombre de ventes', Période: data.stats.salesCount },
      { Boutique: 'Quantité vendue', Période: data.stats.quantity },
      { Boutique: 'Bénéfice encaissé', Période: data.stats.profitEncaisse },
      { Boutique: 'Bénéfice en attente', Période: data.stats.profitAttente },
      { Boutique: `Comparaison (${data.compareLabel})`, Période: pctText(data.comparePct) },
    ]),
    'Résumé',
  )

  XLSX.utils.book_append_sheet(
    wb,
    json_to_sheet(
      data.perArticle.map((r) => ({
        Article: r.name,
        'Qté vendue': r.quantity,
        'Chiffre d’affaires': r.revenue,
        Bénéfice: r.profit,
        'Marge %': Math.round(r.marginPct),
        Stock: r.stock,
      })),
    ),
    'Par article',
  )

  XLSX.utils.book_append_sheet(
    wb,
    json_to_sheet(
      data.buckets.map((b) => ({
        Période: b.label,
        'Chiffre d’affaires': b.revenue,
        Bénéfice: b.profit,
      })),
    ),
    'Période',
  )

  XLSX.utils.book_append_sheet(
    wb,
    json_to_sheet([
      { Poste: 'Valeur au prix d’achat', Montant: data.stockValue.atCost },
      { Poste: 'Valeur au prix de vente', Montant: data.stockValue.atPrice },
      { Poste: 'Unités en stock', Montant: data.stockValue.units },
      { Poste: 'Crédits accordés', Montant: data.credits.granted },
      { Poste: 'Remboursé', Montant: data.credits.refunded },
      { Poste: 'Reste à récupérer', Montant: data.credits.outstanding },
      { Poste: 'Clients débiteurs', Montant: data.credits.debtors },
      ...data.lowStock.map((l) => ({ Poste: `Stock : ${l.name}`, Montant: l.stock })),
    ]),
    'Stock et crédits',
  )

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  triggerDownload(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${data.fileBase}.xlsx`,
  )
}

/* ---------------- CSV ---------------- */

function downloadCsv(data: FicheData): void {
  const esc = csvCell
  const lines: string[] = []
  lines.push(['Fiche de résultats'].map(esc).join(';'))
  lines.push(['Boutique', data.shopLabel].map(esc).join(';'))
  lines.push(['Période', data.periodLabel].map(esc).join(';'))
  lines.push(['Générée le', formatDateShort(data.generatedAt)].map(esc).join(';'))
  lines.push('')
  lines.push(['Résumé', 'Montant'].map(esc).join(';'))
  lines.push(['Chiffre d’affaires', data.stats.revenue].map(esc).join(';'))
  lines.push(['Bénéfice', data.stats.profit].map(esc).join(';'))
  lines.push(['Dépenses de réappro', data.stats.spent].map(esc).join(';'))
  lines.push(['Nombre de ventes', data.stats.salesCount].map(esc).join(';'))
  lines.push(['Bénéfice encaissé', data.stats.profitEncaisse].map(esc).join(';'))
  lines.push(['Bénéfice en attente', data.stats.profitAttente].map(esc).join(';'))
  lines.push([`Comparaison ${data.compareLabel}`, pctText(data.comparePct)].map(esc).join(';'))
  if (!data.hasSales) {
    lines.push('')
    lines.push(['Aucune vente sur cette période'].map(esc).join(';'))
  }
  lines.push('')
  lines.push(['Article', 'Qté vendue', 'Chiffre d’affaires', 'Bénéfice', 'Marge %', 'Stock'].map(esc).join(';'))
  for (const r of data.perArticle) {
    lines.push([r.name, r.quantity, r.revenue, r.profit, Math.round(r.marginPct), r.stock].map(esc).join(';'))
  }
  lines.push('')
  lines.push(['Crédits', 'Montant'].map(esc).join(';'))
  lines.push(['Accordés', data.credits.granted].map(esc).join(';'))
  lines.push(['Remboursés', data.credits.refunded].map(esc).join(';'))
  lines.push(['Reste à récupérer', data.credits.outstanding].map(esc).join(';'))
  lines.push(['Clients débiteurs', data.credits.debtors].map(esc).join(';'))

  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, `${data.fileBase}.csv`)
}

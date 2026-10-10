import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable, { type RowInput } from 'jspdf-autotable'
import type { Credit, Customer, DB, Item, Sale } from './types'
import { creditRest, computeCreditStatus } from './calc'
import { formatDateShort, fcfa, num, todayISO } from './format'
import { formatMoney } from './currency'
import { buildStockSheet, type StockSheet } from './stockSheet'
import { safeCell, csvCell } from './sanitize'
import { drawLogoTopRight } from './fiche'
import { triggerDownload } from './fiche'

/** Nettoie des lignes avant export Excel (anti injection de formules) */
function safeRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'string' ? safeCell(v) : v
    return out as T
  })
}

const sheetName = (s: string) => s.slice(0, 31)

export function exportSalesExcel(sales: Sale[], credits: Credit[], items: Item[], db: DB): void {
  const today = todayISO()
  const shopName = (id: string) => db.shops.find((s) => s.id === id)?.name ?? '—'
  const customerName = (id: string | null) =>
    id ? (db.customers.find((c) => c.id === id)?.name ?? '—') : '—'

  const ventes = sales
    .slice()
    .sort((a, b) => b.sale_date.localeCompare(a.sale_date))
    .map((s) => ({
      Date: formatDateShort(s.sale_date),
      Boutique: shopName(s.shop_id),
      Article: s.item_name,
      Quantité: s.quantity,
      'Prix de vente unitaire': s.unit_price,
      'Prix d’achat unitaire': s.unit_cost,
      Total: s.unit_price * s.quantity,
      Bénéfice: (s.unit_price - s.unit_cost) * s.quantity,
      Paiement: s.payment_type,
      Client: customerName(s.customer_id),
    }))

  const cred = credits.map((c) => {
    const sale = db.sales.find((s) => s.id === c.sale_id)
    return {
      Client: customerName(c.customer_id),
      Téléphone: db.customers.find((x) => x.id === c.customer_id)?.phone ?? '—',
      Article: sale?.item_name ?? '—',
      'Date d’achat': formatDateShort(c.sale_date),
      'Montant total': c.total_amount,
      'Déjà payé': c.amount_paid,
      'Reste à payer': creditRest(c),
      Échéance: c.due_date ? formatDateShort(c.due_date) : '—',
      Statut: computeCreditStatus(c, today),
    }
  })

  const stock = items.map((i) => ({
    Boutique: shopName(i.shop_id),
    Article: i.name,
    Stock: i.stock,
    'Prix d’achat moyen': i.cost_price,
    'Prix de vente': i.price,
    'Marge unitaire': i.price - i.cost_price,
    'Marge %': i.cost_price > 0 ? Math.round(((i.price - i.cost_price) / i.cost_price) * 100) : 0,
    'Valeur au prix d’achat': i.stock * i.cost_price,
    'Valeur au prix de vente': i.stock * i.price,
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeRows(ventes)), sheetName('Ventes'))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeRows(cred)), sheetName('Crédits'))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeRows(stock)), sheetName('Stock'))
  const date = todayISO()
  XLSX.writeFile(wb, `ventes-${date}.xlsx`)
}

/* ------------------------------------------------------------------ */
/* Fiche de stock : fiche A (une boutique) ou B (toutes, par section) */
/* ------------------------------------------------------------------ */

export interface StockSheetOptions {
  showMoney: boolean
  businessName: string
}

const sheetOpts = (opts: StockSheetOptions): Required<StockSheetOptions> => ({
  showMoney: opts.showMoney,
  businessName: opts.businessName ?? '',
})

/** Valeur brute d'une cellule (Excel/CSV : nombres, pas de devise). */
function sheetCellValue(col: string, row: { name: string; stock: number; cost: number; price: number; marginUnit: number; valueCost: number; valuePrice: number; potential: number }): string | number {
  switch (col) {
    case 'Article':
      return row.name
    case 'Stock':
      return row.stock
    case 'Prix achat':
      return row.cost
    case 'Prix vente':
      return row.price
    case 'Marge unitaire':
      return row.marginUnit
    case 'Valeur (achat)':
      return row.valueCost
    case 'Valeur (vente)':
      return row.valuePrice
    case 'Bénéfice potentiel':
      return row.potential
    default:
      return ''
  }
}

/** Texte affiché d'une cellule (PDF : montants formatés). */
function sheetCellText(col: string, row: Parameters<typeof sheetCellValue>[1], currency: string): string {
  const v = sheetCellValue(col, row)
  if (col === 'Article') return row.name
  if (col === 'Stock') return row.stock <= 0 ? `${row.stock} (Rupture)` : String(row.stock)
  return formatMoney(typeof v === 'number' ? v : 0, currency)
}

/** Lignes PDF : en-têtes de section, articles, sous-totaux, total général. */
export function stockPdfTables(sheet: StockSheet): { head: string[]; body: RowInput[] } {
  const head = [...sheet.columns]
  const money = (n: number, currency: string) => formatMoney(n, currency)
  const body: RowInput[] = []
  const totalRow = (label: string, t: { units: number; valueCost: number; valuePrice: number; potential: number }, currency: string, accent: boolean): RowInput[] => {
    type RGB = [number, number, number]
    const bg: RGB = accent ? [224, 242, 238] : [241, 245, 249]
    const cells: RowInput = sheet.columns.map((c) => {
      const bold = { fontStyle: 'bold' as const, fillColor: bg, lineWidth: { top: 0.8 } }
      switch (c) {
        case 'Article':
          return { content: label, styles: bold }
        case 'Stock':
          return { content: String(t.units), styles: bold }
        case 'Valeur (achat)':
          return { content: money(t.valueCost, currency), styles: bold }
        case 'Valeur (vente)':
          return { content: money(t.valuePrice, currency), styles: bold }
        case 'Bénéfice potentiel':
          return {
            content: `${t.potential > 0 ? '+' : t.potential < 0 ? '−' : ''}${money(Math.abs(t.potential), currency)}`,
            styles: {
              ...bold,
              textColor: (t.potential > 0 ? [5, 122, 72] : t.potential < 0 ? [185, 28, 28] : [71, 85, 105]) as RGB,
            },
          }
        default:
          return ''
      }
    })
    return [cells]
  }

  for (const section of sheet.sections) {
    if (sheet.kind === 'B') {
      body.push([
        {
          content: `${section.shopName} · Devise : ${section.currency}`,
          colSpan: head.length,
          styles: { fontStyle: 'bold', fillColor: [13, 148, 136], textColor: [255, 255, 255], fontSize: 10 },
        },
      ])
    }
    if (section.empty) {
      body.push([
        {
          content: 'Aucun article',
          colSpan: head.length,
          styles: { textColor: [130, 140, 155], fontStyle: 'italic' },
        },
      ])
    }
    for (const r of section.rows) {
      body.push(
        sheet.columns.map((c) => {
          if (c === 'Article') return r.name
          if (c === 'Stock') {
            return r.rupture
              ? { content: `${r.stock} (Rupture)`, styles: { textColor: [185, 28, 28] as unknown as [number, number, number] } }
              : String(r.stock)
          }
          if (c === 'Bénéfice potentiel') {
            return {
              content: `${r.potential > 0 ? '+' : r.potential < 0 ? '−' : ''}${money(Math.abs(r.potential), section.currency)}`,
              styles: {
                textColor: (r.potential > 0 ? [5, 122, 72] : r.potential < 0 ? [185, 28, 28] : [71, 85, 105]) as unknown as [number, number, number],
              },
            }
          }
          return sheetCellText(c, r, section.currency)
        }),
      )
    }
    body.push(...totalRow(`Sous-total : ${section.shopName}`, section.subtotal, section.currency, false))
  }
  if (sheet.kind === 'B' && sheet.grandTotal) {
    body.push(...totalRow(sheet.totalLabel.replace('TOTAL', 'TOTAL GÉNÉRAL'), sheet.grandTotal, sheet.currency, true))
  } else if (sheet.kind === 'A' && sheet.sections[0]) {
    // Remplace le sous-total unique par la ligne TOTAL de la fiche
    body.pop()
    body.push(...totalRow(sheet.totalLabel, sheet.sections[0].subtotal, sheet.sections[0].currency, true))
  }
  return { head, body }
}

export function exportStockSheetPDF(db: DB, scope: string, opts: StockSheetOptions): void {
  const sheet = buildStockSheet({ db, scope, ...sheetOpts(opts) })
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const titleLines = doc.splitTextToSize(sheet.title, pageWidth - 58) as string[]
  doc.setFontSize(16)
  doc.text(titleLines, 14, 16)
  drawLogoTopRight(doc, 18)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(sheet.subtitle, 14, 16 + titleLines.length * 7 + 1)

  const { head, body } = stockPdfTables(sheet)
  autoTable(doc, {
    startY: 16 + titleLines.length * 7 + 6,
    head: [head],
    body,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [13, 148, 136] },
    columnStyles: Object.fromEntries(head.map((_, i) => [i, i === 0 ? { cellWidth: 'auto' } : { halign: 'right' as const }])),
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
  })

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(140)
    doc.text(`Page ${i} / ${pages}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' })
  }
  doc.save(`${sheet.filenameBase}.pdf`)
}

const colLetter = (i: number): string => {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
};

/** Classeur Excel : mêmes colonnes, totaux en formules SUM (testable). */
export function buildStockExcel(sheet: StockSheet): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const ficheCols = [...sheet.columns]
  const withBoutique = sheet.kind === 'B'
  // Ligne de titre + sous-titre, puis en-tête
  const headers = [...ficheCols, ...(withBoutique ? ['Boutique'] : []), 'Devise']
  const colIndex = (name: string) => headers.indexOf(name)
  /** Colonnes sommables (les prix unitaires et la marge restent vides en total) */
  const sumCols = ficheCols.filter((c) => c === 'Stock' || c === 'Valeur (achat)' || c === 'Valeur (vente)' || c === 'Bénéfice potentiel')
  /** Valeur du sous-total pour une colonne sommable */
  const subValue = (c: string, t: { units: number; valueCost: number; valuePrice: number; potential: number }): number => {
    switch (c) {
      case 'Stock':
        return t.units
      case 'Valeur (achat)':
        return t.valueCost
      case 'Valeur (vente)':
        return t.valuePrice
      default:
        return t.potential
    }
  }
  const ws: XLSX.WorkSheet = {}
  const put = (r: number, c: number, v: string | number | XLSX.CellObject) => {
    ws[colLetter(c) + String(r)] = typeof v === 'object' ? v : { t: typeof v === 'number' ? 'n' : 's', v } as XLSX.CellObject
  }
  /** Cellule de total : formule + valeur en cache (affichage sans recalcul). */
  const sumCell = (ci: number, from: number, to: number, cached: number): XLSX.CellObject =>
    (from <= to
      ? { t: 'n', v: cached, f: `SUM(${colLetter(ci)}${from}:${colLetter(ci)}${to})` }
      : { t: 'n', v: 0 }) as XLSX.CellObject

  put(1, 0, { t: 's', v: sheet.title } as XLSX.CellObject)
  put(2, 0, { t: 's', v: sheet.subtitle } as XLSX.CellObject)
  headers.forEach((h, c) => put(3, c, { t: 's', v: h } as XLSX.CellObject))

  let r = 4
  for (const section of sheet.sections) {
    if (withBoutique) {
      put(r, 0, { t: 's', v: `${section.shopName} · Devise : ${section.currency}` } as XLSX.CellObject)
      r += 1
    }
    const from = r
    for (const row of section.rows) {
      ficheCols.forEach((c, ci) => put(r, ci, sheetCellValue(c, row)))
      if (withBoutique) put(r, ficheCols.length, section.shopName)
      put(r, headers.length - 1, section.currency)
      r += 1
    }
    if (section.empty) {
      put(r, 0, { t: 's', v: 'Aucun article' } as XLSX.CellObject)
      r += 1
    }
    const to = r - 1
    // Sous-total avec SUM sur les lignes de données (jamais sur d'autres totaux)
    put(r, colIndex('Article'), { t: 's', v: sheet.kind === 'A' ? sheet.totalLabel : `Sous-total : ${section.shopName}` } as XLSX.CellObject)
    for (const c of sumCols) {
      const ci = colIndex(c)
      const addr = `${colLetter(ci)}${r}`
      ws[addr] = sumCell(ci, from, to, subValue(c, section.subtotal))
    }
    r += 1
  }

  if (sheet.kind === 'B') {
    // Récapitulatif par boutique : addition exacte des sous-totaux (aucun mélange)
    r += 1
    put(r, 0, { t: 's', v: 'Récapitulatif par boutique' } as XLSX.CellObject)
    r += 1
    const recapCols = ['Boutique', 'Unités', 'Valeur (achat)', 'Valeur (vente)', 'Bénéfice potentiel', 'Devise']
    recapCols.forEach((h, c) => put(r, c, { t: 's', v: h } as XLSX.CellObject))
    const recapFrom = r + 1
    r += 1
    // Lignes des sous-totaux du tableau principal ( Addition exacte, jamais de SUMIF
    // sur la colonne entière qui compterait deux fois)
    let cursor = 4
    const subRows: number[] = []
    for (const section of sheet.sections) {
      if (withBoutique) cursor += 1
      cursor += Math.max(section.rows.length, 1)
      subRows.push(cursor)
      cursor += 1
    }
    sheet.sections.forEach((section, i) => {
      const sr = subRows[i]
      const ref = (name: string) => `${colLetter(colIndex(name))}${sr}`
      put(r, 0, section.shopName)
      put(r, 1, { t: 'n', v: section.subtotal.units, f: ref('Stock') } as XLSX.CellObject)
      if (sheet.showMoney) {
        put(r, 2, { t: 'n', v: section.subtotal.valueCost, f: ref('Valeur (achat)') } as XLSX.CellObject)
        put(r, 3, { t: 'n', v: section.subtotal.valuePrice, f: ref('Valeur (vente)') } as XLSX.CellObject)
        put(r, 4, { t: 'n', v: section.subtotal.potential, f: ref('Bénéfice potentiel') } as XLSX.CellObject)
      }
      put(r, 5, section.currency)
      r += 1
    })
    if (sheet.grandTotal) {
      const g = sheet.grandTotal
      put(r, 0, { t: 's', v: 'TOTAL GÉNÉRAL' } as XLSX.CellObject)
      const recapTo = r - 1
      const sumCol = (c: number, cached: number) =>
        ({ t: 'n', v: cached, f: `SUM(${colLetter(c)}${recapFrom}:${colLetter(c)}${recapTo})` }) as XLSX.CellObject
      put(r, 1, sumCol(1, g.units))
      if (sheet.showMoney) {
        put(r, 2, sumCol(2, g.valueCost))
        put(r, 3, sumCol(3, g.valuePrice))
        put(r, 4, sumCol(4, g.potential))
      }
      r += 1
    }
  }

  ws['!ref'] = `A1:${colLetter(headers.length - 1)}${r - 1}`
  ws['!cols'] = headers.map((h) => ({ wch: h === 'Article' || h === 'Boutique' ? 28 : 16 }))
  XLSX.utils.book_append_sheet(wb, ws, 'Fiche de stock')
  return wb
}

export function exportStockSheetExcel(db: DB, scope: string, opts: StockSheetOptions): void {
  const sheet = buildStockSheet({ db, scope, ...sheetOpts(opts) })
  const wb = buildStockExcel(sheet)
  XLSX.writeFile(wb, `${sheet.filenameBase}.xlsx`)
}

/** CSV : données seulement, montants bruts, colonne Devise (+ Boutique en fiche B). */
export function stockSheetCSV(sheet: StockSheet): string {
  const ficheCols = [...sheet.columns]
  const headers = [...ficheCols, ...(sheet.kind === 'B' ? ['Boutique'] : []), 'Devise']
  const lines = [headers.map((h) => csvCell(h)).join(';')]
  for (const section of sheet.sections) {
    for (const row of section.rows) {
      const cells: string[] = ficheCols.map((c) => {
        const v = sheetCellValue(c, row)
        return csvCell(typeof v === 'number' ? String(v) : safeCell(v))
      })
      if (sheet.kind === 'B') cells.push(csvCell(section.shopName))
      cells.push(csvCell(section.currency))
      lines.push(cells.join(';'))
    }
  }
  return '\uFEFF' + lines.join('\n')
}
export function exportStockSheetCSV(db: DB, scope: string, opts: StockSheetOptions): void {
  const sheet = buildStockSheet({ db, scope, ...sheetOpts(opts) })
  triggerDownload(new Blob([stockSheetCSV(sheet)], { type: 'text/csv;charset=utf-8' }), `${sheet.filenameBase}.csv`)
}

export function exportCustomerPDF(
  customer: Customer,
  credits: Credit[],
  payments: DB['credit_payments'],
  db: DB,
): void {
  const doc = new jsPDF()
  doc.setFontSize(15)
  doc.text(`Fiche client : ${customer.name}`, 14, 16)
  drawLogoTopRight(doc)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`Téléphone : ${customer.phone || '—'}`, 14, 22)
  const totalDue = credits.reduce((a, c) => a + creditRest(c), 0)
  doc.text(`Total dû : ${fcfa(totalDue)}`, 14, 28)

  const rows = credits.map((c) => {
    const sale = db.sales.find((s) => s.id === c.sale_id)
    return [
      formatDateShort(c.sale_date),
      sale?.item_name ?? '—',
      fcfa(c.total_amount),
      fcfa(c.amount_paid),
      fcfa(creditRest(c)),
      c.due_date ? formatDateShort(c.due_date) : '—',
      computeCreditStatus(c, todayISO()),
    ]
  })
  autoTable(doc, {
    startY: 33,
    head: [['Achat', 'Article', 'Total', 'Payé', 'Reste', 'Échéance', 'Statut']],
    body: rows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [13, 148, 136] },
  })

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  doc.setFontSize(12)
  doc.setTextColor(0)
  doc.text('Remboursements', 14, y)
  y += 5
  autoTable(doc, {
    startY: y,
    head: [['Date', 'Montant', 'Note']],
    body: payments.map((p) => [formatDateShort(p.payment_date), num(p.amount) + ' F', p.note ?? '']),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [13, 148, 136] },
  })
  doc.save(`client-${customer.name.replace(/\s+/g, '-').toLowerCase()}.pdf`)
}

/* ------------------------------------------------------------------ */
/* Export global « toutes mes données »                                 */
/* ------------------------------------------------------------------ */

function allSheets(db: DB): { ventes: Record<string, unknown>[]; credits: Record<string, unknown>[]; stock: Record<string, unknown>[]; clients: Record<string, unknown>[]; boutiques: Record<string, unknown>[] } {
  const shopName = (id: string) => db.shops.find((s) => s.id === id)?.name ?? '—'
  const customerName = (id: string | null) =>
    id ? (db.customers.find((c) => c.id === id)?.name ?? '—') : '—'
  const today = todayISO()

  const ventes = db.sales
    .slice()
    .sort((a, b) => b.sale_date.localeCompare(a.sale_date))
    .map((s) => ({
      Date: formatDateShort(s.sale_date),
      Boutique: shopName(s.shop_id),
      Article: s.item_name,
      Quantité: s.quantity,
      'Prix de vente': s.unit_price,
      "Prix d'achat": s.unit_cost,
      Total: s.unit_price * s.quantity,
      Bénéfice: (s.unit_price - s.unit_cost) * s.quantity,
      Paiement: s.payment_type,
      Client: customerName(s.customer_id),
    }))

  const credits = db.credits.map((c) => ({
    Client: customerName(c.customer_id),
    Téléphone: db.customers.find((x) => x.id === c.customer_id)?.phone ?? '—',
    "Date d'achat": formatDateShort(c.sale_date),
    Montant: c.total_amount,
    Payé: c.amount_paid,
    Reste: creditRest(c),
    Échéance: c.due_date ? formatDateShort(c.due_date) : '—',
    Statut: computeCreditStatus(c, today),
  }))

  const stock = db.items.map((i) => ({
    Boutique: shopName(i.shop_id),
    Article: i.name,
    Stock: i.stock,
    "Prix d'achat moyen": i.cost_price,
    'Prix de vente': i.price,
    'Marge unitaire': i.price - i.cost_price,
    'Valeur achat': i.stock * i.cost_price,
    'Valeur vente': i.stock * i.price,
    Supprimé: i.deleted_at ? 'Oui' : 'Non',
  }))

  const clients = db.customers.map((c) => ({
    Nom: c.name,
    Téléphone: c.phone,
    'Crédit en cours': db.credits.filter((cr) => cr.customer_id === c.id).reduce((a, cr) => a + creditRest(cr), 0),
    Anonymisé: c.anonymized ? 'Oui' : 'Non',
  }))

  const boutiques = db.shops.map((s) => ({
    Boutique: s.name,
    Articles: db.items.filter((i) => i.shop_id === s.id).length,
    Ventes: db.sales.filter((x) => x.shop_id === s.id).length,
    'Créée le': formatDateShort(s.created_at),
    Supprimée: s.deleted_at ? 'Oui' : 'Non',
  }))

  return { ventes, credits, stock, clients, boutiques }
}

/** Toutes les données du propriétaire dans un seul classeur Excel. */
export function exportAllExcel(db: DB): void {
  const d = allSheets(db)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeRows(d.boutiques)), sheetName('Boutiques'))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeRows(d.stock)), sheetName('Stock'))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeRows(d.ventes)), sheetName('Ventes'))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeRows(d.credits)), sheetName('Crédits'))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeRows(d.clients)), sheetName('Clients'))
  XLSX.writeFile(wb, `ma-boutique-donnees-${todayISO()}.xlsx`)
}

/** Toutes les données en un seul CSV (séparateur ;, en-têtes FR). */
export function exportAllCSV(db: DB): void {
  const d = allSheets(db)
  const blocks: string[] = []
  for (const [title, rows] of Object.entries(d)) {
    if (rows.length === 0) continue
    const headers = Object.keys(rows[0])
    const lines = rows.map((r) =>
      headers
        .map((h) => csvCell(String((r as Record<string, unknown>)[h] ?? '')))
        .join(';'),
    )
    blocks.push([`# ${title}`, headers.map((h) => csvCell(h)).join(';'), ...lines].join('\n'))
  }
  const csv = '\uFEFF' + blocks.join('\n\n')
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `ma-boutique-donnees-${todayISO()}.csv`)
}

/** Sauvegarde JSON brute (réimportable / archivage). */
export function exportAllJSON(db: DB): void {
  const json = JSON.stringify(db, null, 2)
  triggerDownload(new Blob([json], { type: 'application/json' }), `ma-boutique-sauvegarde-${todayISO()}.json`)
}

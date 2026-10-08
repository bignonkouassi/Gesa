import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Credit, Customer, DB, Item, Sale } from './types'
import { creditRest, computeCreditStatus } from './calc'
import { formatDateShort, fcfa, num, todayISO } from './format'
import { safeCell, csvCell } from './sanitize'
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

export function exportStockPDF(items: Item[], db: DB, shopLabel: string): void {
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(16)
  doc.text('Fiche de stock', 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`${shopLabel} — éditée le ${formatDateShort(todayISO())}`, 14, 22)

  const rows = items.map((i) => [
    db.shops.find((s) => s.id === i.shop_id)?.name ?? '—',
    i.name,
    String(i.stock),
    fcfa(i.cost_price),
    fcfa(i.price),
    fcfa(i.price - i.cost_price),
    fcfa(i.stock * i.cost_price),
    fcfa(i.stock * i.price),
  ])
  autoTable(doc, {
    startY: 26,
    head: [['Boutique', 'Article', 'Stock', 'Prix achat', 'Prix vente', 'Marge', 'Valeur (achat)', 'Valeur (vente)']],
    body: rows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [13, 148, 136] },
  })
  doc.save(`stock-${todayISO()}.pdf`)
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

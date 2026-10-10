import { describe, expect, it } from 'vitest'
import { emptyDB, type DB, type Item, type Shop } from './types'
import { buildStockSheet, totalLabelFor } from './stockSheet'
import { buildStockExcel, stockPdfTables, stockSheetCSV } from './exports'
import { cleanFileName, formatMoney } from './currency'

/* Jeux de données construits pour le test (aucune valeur d'exemple en dur) */

let n = 0
const shop = (over: Partial<Shop> = {}): Shop => {
  n += 1
  return { id: `s${n}`, user_id: 'u', name: `Boutique ${n}`, created_at: '2026-01-01T00:00:00.000Z', deleted_at: null, ...over }
}
const item = (shopId: string, over: Partial<Item> = {}): Item => {
  n += 1
  return {
    id: `i${n}`,
    shop_id: shopId,
    name: `Article ${n}`,
    cost_price: 0,
    price: 0,
    stock: 0,
    low_stock_threshold: 5,
    opening_stock: 0,
    opening_cost: 0,
    tiered_pricing: false,
    tier_mode: 'palier',
    created_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ...over,
  }
}
const dbOf = (shops: Shop[], items: Item[]): DB => ({ ...emptyDB(), shops, items })

describe('currency seam', () => {
  it('XOF sans décimale, suffixe F CFA', () => {
    expect(formatMoney(12500, 'XOF')).toBe('12 500 F CFA')
    expect(formatMoney(0, 'XOF')).toBe('0 F CFA')
  })
  it('devise à 2 décimales : virgule et 2 chiffres', () => {
    expect(formatMoney(1500.5, 'GHS')).toBe('1 500,50 GHS')
  })
  it('nom de fichier nettoyé (accents, espaces, apostrophe)', () => {
    expect(cleanFileName("Boutique Épicerie d'Awa")).toBe('Boutique-Epicerie-d-Awa')
    expect(cleanFileName('Toutes-les-boutiques')).toBe('Toutes-les-boutiques')
  })
})

describe('fiche A', () => {
  it('titre avec le nom, pas de colonne Boutique, date JJ/MM/AAAA', () => {
    const s = shop({ name: 'Ma Boutique Test' })
    const sheet = buildStockSheet({ db: dbOf([s], []), scope: s.id, showMoney: true, businessName: 'Mon Commerce', date: '2026-10-10' })
    expect(sheet.kind).toBe('A')
    expect(sheet.title).toBe('Fiche de stock : Ma Boutique Test')
    expect(sheet.columns).not.toContain('Boutique')
    expect(sheet.subtitle).toContain('Éditée le 10/10/2026')
    expect(sheet.subtitle).toContain('Devise : XOF')
    expect(sheet.subtitle).toContain('Mon Commerce')
    expect(sheet.filenameBase).toBe('Fiche-de-stock_Ma-Boutique-Test_2026-10-10')
  })

  it('lignes exactes : valeurs, totaux et cohérence', () => {
    const s = shop()
    const db = dbOf(
      [s],
      [
        item(s.id, { name: 'B', stock: 10, cost_price: 400, price: 600 }),
        item(s.id, { name: 'A', stock: 5, cost_price: 100, price: 300 }),
        item(s.id, { name: 'C perte', stock: 4, cost_price: 500, price: 400 }),
        item(s.id, { name: 'D rupture', stock: 0, cost_price: 200, price: 350 }),
      ],
    )
    const sheet = buildStockSheet({ db, scope: s.id, showMoney: true, businessName: '' })
    const sec = sheet.sections[0]
    // Tri alphabétique
    expect(sec.rows.map((r) => r.name)).toEqual(['A', 'B', 'C perte', 'D rupture'])
    const a = sec.rows[0]
    expect(a.marginUnit).toBe(200)
    expect(a.valueCost).toBe(500)
    expect(a.valuePrice).toBe(1500)
    expect(a.potential).toBe(1000)
    // Perte et rupture
    const c = sec.rows[2]
    expect(c.potential).toBe(4 * (400 - 500))
    expect(c.loss).toBe(true)
    const d = sec.rows[3]
    expect(d.potential).toBe(0)
    expect(d.rupture).toBe(true)
    // Totaux = sommes exactes, cohérence bénéfice = vente − achat
    expect(sec.subtotal).toEqual({
      count: 4,
      units: 10 + 5 + 4 + 0,
      valueCost: 10 * 400 + 5 * 100 + 4 * 500 + 0,
      valuePrice: 10 * 600 + 5 * 300 + 4 * 400 + 0,
      potential: 10 * 200 + 5 * 200 + 4 * -100 + 0,
    })
    expect(sec.subtotal.potential).toBe(sec.subtotal.valuePrice - sec.subtotal.valueCost)
  })

  it('un seul article → singulier ; boutique vide → zéros', () => {
    const s1 = shop()
    const one = buildStockSheet({
      db: dbOf([s1], [item(s1.id, { stock: 2, cost_price: 100, price: 150 })]),
      scope: s1.id,
      showMoney: true,
      businessName: '',
    })
    expect(one.totalLabel).toBe('TOTAL (1 article)')
    const s2 = shop()
    const empty = buildStockSheet({ db: dbOf([s2], []), scope: s2.id, showMoney: true, businessName: '' })
    expect(empty.sections[0].empty).toBe(true)
    expect(empty.sections[0].subtotal).toEqual({ count: 0, units: 0, valueCost: 0, valuePrice: 0, potential: 0 })
    expect(empty.totalLabel).toBe('TOTAL (0 article)')
  })

  it('vendeur : colonnes réduites, sans achat ni marge ni bénéfice', () => {
    const s = shop()
    const sheet = buildStockSheet({
      db: dbOf([s], [item(s.id, { stock: 3, cost_price: 100, price: 200 })]),
      scope: s.id,
      showMoney: false,
      businessName: '',
    })
    expect([...sheet.columns]).toEqual(['Article', 'Stock', 'Prix vente', 'Valeur (vente)'])
  })
})

describe('fiche B', () => {
  it('sections, sous-totaux et total général exacts (même devise)', () => {
    const s1 = shop({ name: 'Nord' })
    const s2 = shop({ name: 'Sud' })
    const db = dbOf(
      [s1, s2],
      [
        item(s1.id, { stock: 10, cost_price: 100, price: 200 }),
        item(s1.id, { stock: 5, cost_price: 50, price: 150 }),
        item(s2.id, { stock: 7, cost_price: 300, price: 500 }),
      ],
    )
    const sheet = buildStockSheet({ db, scope: 'all', showMoney: true, businessName: '' })
    expect(sheet.kind).toBe('B')
    expect(sheet.title).toBe('Fiche de stock : Toutes les boutiques')
    expect(sheet.sections.map((s) => s.shopName)).toEqual(['Nord', 'Sud'])
    expect(sheet.sections[0].subtotal).toEqual({ count: 2, units: 15, valueCost: 1250, valuePrice: 2750, potential: 1500 })
    expect(sheet.sections[1].subtotal).toEqual({ count: 1, units: 7, valueCost: 2100, valuePrice: 3500, potential: 1400 })
    expect(sheet.grandTotal).toEqual({ count: 3, units: 22, valueCost: 3350, valuePrice: 6250, potential: 2900 })
    expect(sheet.grandTotal!.potential).toBe(sheet.grandTotal!.valuePrice - sheet.grandTotal!.valueCost)
    expect(totalLabelFor(3)).toBe('TOTAL (3 articles)')
  })

  it('une seule boutique au total → fiche A même depuis « Toutes »', () => {
    const s = shop()
    const sheet = buildStockSheet({ db: dbOf([s], [item(s.id)]), scope: 'all', showMoney: true, businessName: '' })
    expect(sheet.kind).toBe('A')
    expect(sheet.grandTotal).toBeNull()
  })
})

describe('rendus', () => {
  it('PDF A : pas de Boutique, ligne TOTAL unique en fin', () => {
    const s = shop({ name: 'Pdf' })
    const sheet = buildStockSheet({
      db: dbOf([s], [item(s.id, { name: 'X', stock: 2, cost_price: 100, price: 250 })]),
      scope: s.id,
      showMoney: true,
      businessName: '',
    })
    const { head, body } = stockPdfTables(sheet)
    expect(head).not.toContain('Boutique')
    expect(head).toContain('Bénéfice potentiel')
    const last = body[body.length - 1] as { content: string }[]
    expect(last[0]).toMatchObject({ content: 'TOTAL (1 article)' })
    expect(body.filter((r) => Array.isArray(r) && typeof (r[0] as { content?: string })?.content === 'string' && ((r[0] as { content: string }).content as string).startsWith('TOTAL')).length).toBe(1)
  })

  it('PDF B : sections, sous-totaux et total général', () => {
    const s1 = shop({ name: 'N' })
    const s2 = shop({ name: 'S' })
    const sheet = buildStockSheet({
      db: dbOf([s1, s2], [item(s1.id, { stock: 1, cost_price: 10, price: 20 }), item(s2.id, { stock: 2, cost_price: 30, price: 40 })]),
      scope: 'all',
      showMoney: true,
      businessName: '',
    })
    const { body } = stockPdfTables(sheet)
    const texts = body.map((r) => (Array.isArray(r) ? (r[0] as { content?: string })?.content ?? '' : ''))
    expect(texts.filter((t) => typeof t === 'string' && t.startsWith('Sous-total')).length).toBe(2)
    expect(texts.some((t) => typeof t === 'string' && t.startsWith('TOTAL GÉNÉRAL'))).toBe(true)
  })

  it('Excel A : formules SUM exactes sur les lignes de données', () => {
    const s = shop()
    const sheet = buildStockSheet({
      db: dbOf(
        [s],
        [
          item(s.id, { name: 'A', stock: 10, cost_price: 100, price: 200 }),
          item(s.id, { name: 'B', stock: 5, cost_price: 50, price: 150 }),
          item(s.id, { name: 'C', stock: 0, cost_price: 20, price: 30 }),
        ],
      ),
      scope: s.id,
      showMoney: true,
      businessName: '',
    })
    const wb = buildStockExcel(sheet)
    const ws = wb.Sheets['Fiche de stock']
    // Titre L1, sous-titre L2, en-tête L3, données L4-L6, total L7
    expect((ws['A1'] as { v: string }).v).toContain('Fiche de stock')
    expect((ws['A7'] as { v: string }).v).toBe('TOTAL (3 articles)')
    const sub = sheet.sections[0].subtotal
    expect((ws['B7'] as { f: string }).f).toBe('SUM(B4:B6)')
    expect((ws['B7'] as { v: number }).v).toBe(15)
    expect((ws['F7'] as { f: string }).f).toBe('SUM(F4:F6)')
    expect((ws['G7'] as { f: string }).f).toBe('SUM(G4:G6)')
    expect((ws['H7'] as { f: string }).f).toBe('SUM(H4:H6)')
    expect((ws['H7'] as { v: number }).v).toBe(sub.potential)
    // Prix unitaires et marge : vides sur la ligne de total
    expect(ws['C7']).toBeUndefined()
    expect(ws['D7']).toBeUndefined()
    expect(ws['E7']).toBeUndefined()
    expect((ws['B4'] as { v: number }).v).toBe(10)
    // Évaluation manuelle des formules = totaux du builder
    expect(sub.units).toBe(15)
    expect(sub.valueCost).toBe(10 * 100 + 5 * 50 + 0)
    expect(sub.valuePrice).toBe(10 * 200 + 5 * 150 + 0)
    expect(sub.potential).toBe(sub.valuePrice - sub.valueCost)
  })

  it('Excel B : sous-totaux SUM, récap par addition, grand SUM du récap', () => {
    const s1 = shop({ name: 'N' })
    const s2 = shop({ name: 'S' })
    const sheet = buildStockSheet({
      db: dbOf([s1, s2], [item(s1.id, { stock: 10, cost_price: 100, price: 200 }), item(s2.id, { stock: 5, cost_price: 50, price: 150 })]),
      scope: 'all',
      showMoney: true,
      businessName: '',
    })
    const wb = buildStockExcel(sheet)
    const ws = wb.Sheets['Fiche de stock']
    const formulas = Object.entries(ws)
      .filter(([k, v]) => !k.startsWith('!') && typeof (v as { f?: string }).f === 'string')
      .map(([, v]) => (v as { f: string }).f)
    // Sous-totaux SUM sur leurs données (L5 et L8), récap par addition exacte,
    // grand total SUM sur le récap — aucun mélange entre boutiques
    expect(formulas).toContain('SUM(B5:B5)')
    expect(formulas).toContain('SUM(B8:B8)')
    expect(formulas).toContain('B6')
    expect(formulas).toContain('B9')
    expect(formulas).toContain('SUM(B13:B14)')
  })

  it('CSV : données seules, colonnes fiche + Devise (+ Boutique en B)', () => {
    const s = shop()
    const a = buildStockSheet({
      db: dbOf([s], [item(s.id, { name: 'X', stock: 2, cost_price: 100, price: 250 })]),
      scope: s.id,
      showMoney: true,
      businessName: '',
    })
    const csvA = stockSheetCSV(a).replace(/^\uFEFF/, '')
    const linesA = csvA.split('\n')
    expect(linesA[0]).toBe('Article;Stock;Prix achat;Prix vente;Marge unitaire;Valeur (achat);Valeur (vente);Bénéfice potentiel;Devise')
    expect(linesA[1]).toBe('X;2;100;250;150;200;500;300;XOF')
    expect(linesA.length).toBe(2)

    const s2 = shop()
    const b = buildStockSheet({ db: dbOf([s, s2], [item(s.id, { name: 'X', stock: 1, cost_price: 1, price: 2 })]), scope: 'all', showMoney: true, businessName: '' })
    const linesB = stockSheetCSV(b).replace(/^\uFEFF/, '').split('\n')
    expect(linesB[0]).toContain(';Boutique;Devise')
  })
})

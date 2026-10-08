import { describe, expect, it } from 'vitest'
import {
  computeCreditStatus,
  creditRest,
  inRange,
  isoWeek,
  previousRange,
  rangeFor,
  recomputeItem,
} from './calc'
import { emptyDB, type Credit, type DB, type Item, type Restock, type Sale } from './types'

/* ------------------------------------------------------------------ */
/* Constructeurs de fixtures                                           */
/* ------------------------------------------------------------------ */

const makeItem = (over: Partial<Item> = {}): Item => ({
  id: 'i1',
  shop_id: 's1',
  name: 'Article',
  cost_price: 0,
  price: 1000,
  stock: 0,
  low_stock_threshold: 5,
  opening_stock: 0,
  opening_cost: 0,
  created_at: '2026-01-01T08:00:00.000Z',
  deleted_at: null,
  ...over,
})

const makeRestock = (over: Partial<Restock> = {}): Restock => ({
  id: 'r1',
  item_id: 'i1',
  shop_id: 's1',
  quantity: 0,
  unit_cost: 0,
  restock_date: '2026-01-02',
  supplier: null,
  created_at: '2026-01-02T09:00:00.000Z',
  ...over,
})

const makeSale = (over: Partial<Sale> = {}): Sale => ({
  id: 'v1',
  shop_id: 's1',
  item_id: 'i1',
  item_name: 'Article',
  quantity: 1,
  unit_price: 1000,
  unit_cost: 500,
  payment_type: 'comptant',
  customer_id: null,
  sale_date: '2026-01-03',
  created_at: '2026-01-03T10:00:00.000Z',
  ...over,
})

const makeCredit = (over: Partial<Credit> = {}): Credit => ({
  id: 'c1',
  shop_id: 's1',
  customer_id: 'cl1',
  sale_id: 'v1',
  total_amount: 10000,
  amount_paid: 0,
  due_date: null,
  status: 'en cours',
  created_at: '2026-01-03T10:00:00.000Z',
  sale_date: '2026-01-03',
  ...over,
})

const dbWith = (
  item: Item,
  rows: { restocks?: Restock[]; sales?: Sale[] } = {},
): DB => ({
  ...emptyDB(),
  items: [item],
  restocks: rows.restocks ?? [],
  sales: rows.sales ?? [],
})

/* ------------------------------------------------------------------ */
/* Coût moyen pondéré (rejeu des événements)                          */
/* ------------------------------------------------------------------ */

describe('recomputeItem — coût moyen pondéré', () => {
  it('moyenne pondérée entre stock initial et nouveau lot', () => {
    // 10 @ 100 + 5 @ 120 = (1000 + 600) / 15 = 106.6667
    const db = dbWith(makeItem({ opening_stock: 10, opening_cost: 100, stock: 99 }), {
      restocks: [makeRestock({ quantity: 5, unit_cost: 120 })],
    })
    const r = recomputeItem(db, 'i1')
    expect(r.stock).toBe(15)
    expect(r.cost_price).toBeCloseTo(106.6667, 3)
  })

  it('les ventes réduisent le stock sans toucher au coût', () => {
    const db = dbWith(
      makeItem({ opening_stock: 10, opening_cost: 100 }),
      {
        restocks: [makeRestock({ quantity: 5, unit_cost: 120 })],
        sales: [makeSale({ quantity: 3 })],
      },
    )
    const r = recomputeItem(db, 'i1')
    expect(r.stock).toBe(12)
    expect(r.cost_price).toBeCloseTo(106.6667, 3)
  })

  it('stock à zéro : le nouveau lot fixe le coût (remise à zéro)', () => {
    const db = dbWith(makeItem({ opening_stock: 4, opening_cost: 200 }), {
      sales: [makeSale({ quantity: 4, sale_date: '2026-01-03' })],
      restocks: [makeRestock({ quantity: 6, unit_cost: 300, restock_date: '2026-01-05' })],
    })
    const r = recomputeItem(db, 'i1')
    expect(r.stock).toBe(6)
    expect(r.cost_price).toBe(300)
  })

  it('le stock ne descend jamais sous zéro', () => {
    const db = dbWith(makeItem({ opening_stock: 2, opening_cost: 100 }), {
      sales: [makeSale({ quantity: 5 })],
    })
    expect(recomputeItem(db, 'i1').stock).toBe(0)
  })

  it('respecte l’ordre chronologique des événements', () => {
    // Vente du 02 (avant le réappro du 03) : 10 - 4 = 6 puis + 10 = 16
    const db = dbWith(makeItem({ opening_stock: 10, opening_cost: 100 }), {
      sales: [makeSale({ quantity: 4, sale_date: '2026-01-02', created_at: '2026-01-02T09:00:00.000Z' })],
      restocks: [makeRestock({ quantity: 10, unit_cost: 150, restock_date: '2026-01-03' })],
    })
    const r = recomputeItem(db, 'i1')
    expect(r.stock).toBe(16)
    // coût = (10×100 − déjà vendu ne change pas le coût) → (6×100 + 10×150)/16
    expect(r.cost_price).toBeCloseTo(131.25, 3)
  })
})

/* ------------------------------------------------------------------ */
/* Crédits                                                            */
/* ------------------------------------------------------------------ */

describe('creditRest', () => {
  it('reste à payer', () => {
    expect(creditRest(makeCredit({ total_amount: 10000, amount_paid: 3000 }))).toBe(7000)
  })
  it('ne passe jamais sous zéro', () => {
    expect(creditRest(makeCredit({ total_amount: 10000, amount_paid: 12000 }))).toBe(0)
  })
})

describe('computeCreditStatus', () => {
  const today = '2026-10-08'
  it('soldé quand tout est payé (tolérance 0.001)', () => {
    expect(computeCreditStatus(makeCredit({ amount_paid: 10000 }), today)).toBe('soldé')
    expect(computeCreditStatus(makeCredit({ amount_paid: 9999.9995 }), today)).toBe('soldé')
  })
  it('en retard quand la date d’échéance est passée', () => {
    expect(
      computeCreditStatus(makeCredit({ due_date: '2026-10-01', amount_paid: 0 }), today),
    ).toBe('en retard')
    // même partiellement payé, l'échéance dépassée prime
    expect(
      computeCreditStatus(makeCredit({ due_date: '2026-10-01', amount_paid: 5000 }), today),
    ).toBe('en retard')
  })
  it('partiellement payé quand un acompte existe', () => {
    expect(
      computeCreditStatus(makeCredit({ due_date: '2026-12-31', amount_paid: 5000 }), today),
    ).toBe('partiellement payé')
  })
  it('en cours sans paiement ni échéance dépassée', () => {
    expect(computeCreditStatus(makeCredit({ due_date: '2026-12-31' }), today)).toBe('en cours')
    expect(computeCreditStatus(makeCredit(), today)).toBe('en cours')
  })
})

/* ------------------------------------------------------------------ */
/* Périodes                                                            */
/* ------------------------------------------------------------------ */

describe('rangeFor', () => {
  const base = new Date(2026, 9, 8, 23, 30) // jeudi 8 octobre 2026, 23h30
  it('jour', () => {
    expect(rangeFor('jour', base)).toEqual({ from: '2026-10-08', to: '2026-10-09' })
  })
  it('semaine (du lundi au lundi)', () => {
    expect(rangeFor('semaine', base)).toEqual({ from: '2026-10-05', to: '2026-10-12' })
  })
  it('mois', () => {
    expect(rangeFor('mois', base)).toEqual({ from: '2026-10-01', to: '2026-11-01' })
  })
  it('année', () => {
    expect(rangeFor('année', base)).toEqual({ from: '2026-01-01', to: '2027-01-01' })
  })
})

describe('previousRange', () => {
  it('jour précédent', () => {
    expect(previousRange('jour', { from: '2026-10-08', to: '2026-10-09' })).toEqual({
      from: '2026-10-07',
      to: '2026-10-08',
    })
  })
  it('semaine précédente de même longueur', () => {
    expect(previousRange('semaine', { from: '2026-10-05', to: '2026-10-12' })).toEqual({
      from: '2026-09-28',
      to: '2026-10-05',
    })
  })
  it('mois précédent', () => {
    expect(previousRange('mois', { from: '2026-10-01', to: '2026-11-01' })).toEqual({
      from: '2026-09-01',
      to: '2026-10-01',
    })
  })
  it('année précédente', () => {
    expect(previousRange('année', { from: '2026-01-01', to: '2027-01-01' })).toEqual({
      from: '2025-01-01',
      to: '2026-01-01',
    })
  })
})

describe('inRange', () => {
  const r = { from: '2026-10-08', to: '2026-10-09' }
  it('inclusif à gauche, exclusif à droite', () => {
    expect(inRange('2026-10-07', r)).toBe(false)
    expect(inRange('2026-10-08', r)).toBe(true)
    expect(inRange('2026-10-09', r)).toBe(false)
  })
})

describe('isoWeek', () => {
  it('jeudi 1er janvier 2026 ouvre la semaine 1', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toEqual({ week: 1, year: 2026 })
  })
  it('lundi 29 décembre 2025 appartient déjà à la semaine 1 de 2026', () => {
    expect(isoWeek(new Date(2025, 11, 29))).toEqual({ week: 1, year: 2026 })
  })
  it('dimanche 27 décembre 2026 est en semaine 52', () => {
    expect(isoWeek(new Date(2026, 11, 27))).toEqual({ week: 52, year: 2026 })
  })
  it('jeudi 31 décembre 2026 ouvre la semaine 53', () => {
    expect(isoWeek(new Date(2026, 11, 31))).toEqual({ week: 53, year: 2026 })
  })
})

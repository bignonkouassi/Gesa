import { describe, expect, it } from 'vitest'
import {
  nextTier,
  pctToPrice,
  previewLine,
  priceToPct,
  summaryRanges,
  tierMargin,
} from './tiers'

/* Huile à 1 000 F, paliers 3 → 900 F et 10 → 850 F */
const HUILE = [
  { min_quantity: 3, unit_price: 900 },
  { min_quantity: 10, unit_price: 850 },
]

describe('previewLine mode palier (chiffres exacts de la spec)', () => {
  it('quantité 1 → 1 000 F', () => {
    expect(previewLine(1000, HUILE, 'palier', 1, true)).toEqual({ unitPrice: 1000, total: 1000, tierMin: null })
  })
  it('quantité 2 → 2 000 F', () => {
    expect(previewLine(1000, HUILE, 'palier', 2, true)).toEqual({ unitPrice: 1000, total: 2000, tierMin: null })
  })
  it('quantité 3 → 2 700 F (palier 3)', () => {
    expect(previewLine(1000, HUILE, 'palier', 3, true)).toEqual({ unitPrice: 900, total: 2700, tierMin: 3 })
  })
  it('quantité 9 → 8 100 F (palier 3)', () => {
    expect(previewLine(1000, HUILE, 'palier', 9, true)).toEqual({ unitPrice: 900, total: 8100, tierMin: 3 })
  })
  it('quantité 10 → 8 500 F (palier 10)', () => {
    expect(previewLine(1000, HUILE, 'palier', 10, true)).toEqual({ unitPrice: 850, total: 8500, tierMin: 10 })
  })
})

describe('previewLine mode tranche (chiffres exacts de la spec)', () => {
  it('quantité 4 → 2 × 1 000 + 2 × 900 = 3 800 F', () => {
    expect(previewLine(1000, HUILE, 'tranche', 4, true)).toEqual({ unitPrice: 950, total: 3800, tierMin: 3 })
  })
  it('quantité 10 → 2 × 1 000 + 7 × 900 + 1 × 850 = 9 150 F', () => {
    expect(previewLine(1000, HUILE, 'tranche', 10, true)).toEqual({ unitPrice: 915, total: 9150, tierMin: 10 })
  })
})

describe('cas limites', () => {
  it('option désactivée → toujours le prix normal', () => {
    expect(previewLine(1000, HUILE, 'palier', 10, false)).toEqual({ unitPrice: 1000, total: 10000, tierMin: null })
  })
  it('option active sans palier → prix normal', () => {
    expect(previewLine(1000, [], 'palier', 10, true)).toEqual({ unitPrice: 1000, total: 10000, tierMin: null })
  })
  it('bénéfice de la vente de 3 unités = (900 − 700) × 3 = 600 F', () => {
    const line = previewLine(1000, HUILE, 'palier', 3, true)
    expect((line.unitPrice - 700) * 3).toBe(600)
  })
})

describe('mode de vente cumul vs un seul client (Huile 1 000 F, coût 700 F)', () => {
  it('cumul, 6 unités → 6 000 F, bénéfice 1 800 F (jamais de palier)', () => {
    const line = previewLine(1000, HUILE, 'palier', 6, false)
    expect(line).toEqual({ unitPrice: 1000, total: 6000, tierMin: null })
    expect((line.unitPrice - 700) * 6).toBe(1800)
  })
  it('un seul client, 6 unités → 5 400 F, bénéfice 1 200 F', () => {
    const line = previewLine(1000, HUILE, 'palier', 6, true)
    expect(line).toEqual({ unitPrice: 900, total: 5400, tierMin: 3 })
    expect((line.unitPrice - 700) * 6).toBe(1200)
  })
  it('un seul client, 2 unités → 2 000 F (palier non atteint)', () => {
    expect(previewLine(1000, HUILE, 'palier', 2, true)).toEqual({ unitPrice: 1000, total: 2000, tierMin: null })
  })
  it('un seul client, 3 unités → 2 700 F', () => {
    expect(previewLine(1000, HUILE, 'palier', 3, true)).toEqual({ unitPrice: 900, total: 2700, tierMin: 3 })
  })
})

describe('nextTier', () => {
  it('signale le palier suivant et le manque', () => {
    expect(nextTier(HUILE, 2)).toEqual({ min_quantity: 3, unit_price: 900, missing: 1 })
    expect(nextTier(HUILE, 9)).toEqual({ min_quantity: 10, unit_price: 850, missing: 1 })
    expect(nextTier(HUILE, 10)).toBeNull()
  })
})

describe('conversions remise ↔ prix', () => {
  it('−5 % de 1 000 F = 950 F', () => {
    expect(pctToPrice(1000, 5)).toBe(950)
  })
  it('900 F sur 1 000 F = −10 %', () => {
    expect(priceToPct(1000, 900)).toBe(10)
  })
})

describe('résumé et marges', () => {
  it('résumé lisible des plages', () => {
    expect(
      summaryRanges(1000, [
        { id: 'a', item_id: 'i', min_quantity: 3, unit_price: 900, created_at: '' },
        { id: 'b', item_id: 'i', min_quantity: 10, unit_price: 850, created_at: '' },
      ]),
    ).toBe('1 à 2 : 1 000 F · 3 à 9 : 900 F · 10 et plus : 850 F')
  })
  it('marge du palier 900 F face à un coût de 700 F', () => {
    expect(tierMargin(900, 700)).toEqual({ unit: 200, pct: expect.closeTo(22.2, 1) })
  })
})

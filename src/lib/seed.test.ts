import { describe, expect, it } from 'vitest'
import { createDemoDB } from './seed'

describe('démo prix par paliers (spec section 8)', () => {
  it('Boutique Gros : seule l’Huile a l’option, paliers 3 → 900 et 10 → 850', () => {
    const db = createDemoDB()
    expect(db.shops.some((s) => s.name === 'Boutique Gros')).toBe(true)
    const huile = db.items.find((i) => i.name === 'Huile' && i.shop_id === 'shop_gros')
    expect(huile?.tiered_pricing).toBe(true)
    expect(huile?.tier_mode).toBe('palier')
    const tiers = db.price_tiers
      .filter((t) => t.item_id === huile?.id)
      .sort((a, b) => a.min_quantity - b.min_quantity)
    expect(tiers.map((t) => [t.min_quantity, t.unit_price])).toEqual([
      [3, 900],
      [10, 850],
    ])
    for (const name of ['Savon', 'Riz']) {
      const item = db.items.find((i) => i.name === name && i.shop_id === 'shop_gros')
      expect(item?.tiered_pricing).toBe(false)
    }
  })

  it('ventes d’huile de 1, 2, 3, 5 et 10 unités aux trois niveaux de prix', () => {
    const db = createDemoDB()
    const huile = db.items.find((i) => i.name === 'Huile' && i.shop_id === 'shop_gros')
    const sales = db.sales
      .filter((s) => s.item_id === huile?.id)
      .sort((a, b) => a.quantity - b.quantity)
    expect(sales.map((s) => [s.quantity, s.unit_price, s.tier_min_quantity])).toEqual([
      [1, 1000, null],
      [2, 1000, null],
      [3, 900, 3],
      [5, 900, 3],
      [10, 850, 10],
    ])
    expect(sales.map((s) => s.sale_mode)).toEqual([null, null, 'un_client', 'un_client', 'un_client'])
    const s3 = sales.find((s) => s.quantity === 3)
    expect(s3 && (s3.unit_price - s3.unit_cost) * 3).toBe(600)
  })
})

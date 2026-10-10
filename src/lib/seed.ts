import type {
  Credit,
  CreditPayment,
  Customer,
  DB,
  Item,
  PriceTier,
  Restock,
  Sale,
  Shop,
  StockMovement,
} from './types'
import { addDays, toISO } from './format'
import { previewLine } from './tiers'

/** Générateur déterministe pour des données de démonstration reproductibles */
function makeRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

let counter = 0
export function uid(prefix = 'id'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

interface SeedItem {
  name: string
  cost: number
  price: number
  finalStock: number
  daily: number
}

/** 2 boutiques × 4 articles, prix d'achat et prix de vente inclus */
const CATALOG: Record<'eau' | 'cuisine', SeedItem[]> = {
  eau: [
    { name: 'Eau minérale 1,5 L', cost: 350, price: 500, finalStock: 45, daily: 7 },
    { name: 'Eau minérale 5 L', cost: 1100, price: 1500, finalStock: 18, daily: 3 },
    { name: 'Pack 6 × 1,5 L', cost: 2200, price: 2800, finalStock: 12, daily: 1.5 },
    { name: 'Bidon 10 L', cost: 1800, price: 2500, finalStock: 6, daily: 1 },
  ],
  cuisine: [
    { name: 'Poêle antiadhésive 26 cm', cost: 4500, price: 6500, finalStock: 8, daily: 0.5 },
    { name: 'Couteau de cuisine', cost: 1500, price: 2500, finalStock: 14, daily: 0.8 },
    { name: 'Bols en inox (lot de 4)', cost: 3000, price: 4500, finalStock: 10, daily: 0.6 },
    { name: 'Spatule silicone', cost: 900, price: 1600, finalStock: 20, daily: 1 },
  ],
}

/** 3 clients, répartis entre les deux boutiques */
const CUSTOMERS: { name: string; phone: string; shop: 'eau' | 'cuisine' }[] = [
  { name: 'Aminata Diallo', phone: '+225 07 11 22 33 44', shop: 'eau' },
  { name: 'Karim Traoré', phone: '+225 05 66 77 88 99', shop: 'cuisine' },
  { name: 'Fatou Ndiaye', phone: '+225 01 23 45 67 89', shop: 'eau' },
]

interface Plan {
  itemId: string
  shopId: string
  key: 'eau' | 'cuisine'
  name: string
  price: number
  cost: number
  daily: number
  opening: number
  qty: number
  restocked: number
}

export function createDemoDB(): DB {
  const now = new Date()
  const rng = makeRng(20261007)
  const ts = (d: Date) => d.toISOString()

  const shops: Shop[] = [
    { id: 'shop_eau', user_id: 'demo-user', name: 'Boutique Eau', created_at: ts(addDays(now, -380)), deleted_at: null },
    { id: 'shop_cuisine', user_id: 'demo-user', name: 'Boutique Cuisine', created_at: ts(addDays(now, -380)), deleted_at: null },
  ]

  const items: Item[] = []
  const plans: Plan[] = []
  const mkItems = (shopId: string, key: 'eau' | 'cuisine') => {
    CATALOG[key].forEach((s, i) => {
      const id = `item_${key}_${i}`
      const opening = Math.round(s.daily * 30) + s.finalStock
      plans.push({
        itemId: id,
        shopId,
        key,
        name: s.name,
        price: s.price,
        cost: s.cost,
        daily: s.daily,
        opening,
        qty: opening,
        restocked: 0,
      })
      items.push({
        id,
        shop_id: shopId,
        name: s.name,
        cost_price: s.cost,
        price: s.price,
        stock: s.finalStock,
        low_stock_threshold: 5,
        opening_stock: opening,
        opening_cost: s.cost,
        tiered_pricing: false,
        tier_mode: 'palier',
        created_at: ts(addDays(now, -380)),
        deleted_at: null,
      })
    })
  }
  mkItems('shop_eau', 'eau')
  mkItems('shop_cuisine', 'cuisine')

  /* Démo prix par paliers : Boutique Gros (Savon, Riz, Huile).
     Seule l'Huile a l'option : 1 000 F, coût 700 F, paliers 3 → 900 F et 10 → 850 F.
     Ventes de 1, 2, 3, 5 et 10 unités : les trois niveaux de prix. */
  const GROS_SHOP = 'shop_gros'
  shops.push({ id: GROS_SHOP, user_id: 'demo-user', name: 'Boutique Gros', created_at: ts(addDays(now, -60)), deleted_at: null })
  const grosCatalog = [
    { id: 'item_gros_savon', name: 'Savon', cost: 400, price: 600, stock: 30, tiered: false },
    { id: 'item_gros_riz', name: 'Riz', cost: 2200, price: 3000, stock: 25, tiered: false },
    { id: 'item_gros_huile', name: 'Huile', cost: 700, price: 1000, stock: 40, tiered: true },
  ]
  for (const g of grosCatalog) {
    items.push({
      id: g.id,
      shop_id: GROS_SHOP,
      name: g.name,
      cost_price: g.cost,
      price: g.price,
      stock: g.stock,
      low_stock_threshold: 5,
      opening_stock: g.stock,
      opening_cost: g.cost,
      tiered_pricing: g.tiered,
      tier_mode: 'palier',
      created_at: ts(addDays(now, -60)),
      deleted_at: null,
    })
  }
  const price_tiers: PriceTier[] = [
    { id: 'tier_gros_huile_3', item_id: 'item_gros_huile', min_quantity: 3, unit_price: 900, created_at: ts(addDays(now, -60)) },
    { id: 'tier_gros_huile_10', item_id: 'item_gros_huile', min_quantity: 10, unit_price: 850, created_at: ts(addDays(now, -60)) },
  ]
  const huilePlan: Plan = {
    itemId: 'item_gros_huile', shopId: GROS_SHOP, key: 'eau', name: 'Huile',
    price: 1000, cost: 700, daily: 0, opening: 40, qty: 40, restocked: 0,
  }
  const HUILE_TIERS = [{ min_quantity: 3, unit_price: 900 }, { min_quantity: 10, unit_price: 850 }]

  const customers: Customer[] = CUSTOMERS.map((c, i) => ({
    id: `cust_${i}`,
    shop_id: c.shop === 'eau' ? 'shop_eau' : 'shop_cuisine',
    name: c.name,
    phone: c.phone,
    created_at: ts(addDays(now, -370)),
    deleted_at: null,
    anonymized: false,
  }))
  const customerOf = (key: 'eau' | 'cuisine', i: number) => {
    const list = customers.filter((c) => (key === 'eau' ? c.id === 'cust_0' || c.id === 'cust_2' : c.id === 'cust_1'))
    return list[i % list.length]
  }

  const restocks: Restock[] = []
  const sales: Sale[] = []
  const credits: Credit[] = []
  const credit_payments: CreditPayment[] = []
  const movements: StockMovement[] = []

  const addRestock = (plan: Plan, date: Date, qty: number, unitCost: number, supplier: string) => {
    // Coût moyen pondéré exact, identique au recalcul de l'application
    plan.cost = plan.qty <= 0 ? unitCost : (plan.qty * plan.cost + qty * unitCost) / (plan.qty + qty)
    plan.qty += qty
    plan.restocked += qty
    restocks.push({
      id: uid('restock'),
      item_id: plan.itemId,
      shop_id: plan.shopId,
      quantity: qty,
      unit_cost: unitCost,
      restock_date: toISO(date),
      supplier,
      created_at: ts(date),
    })
  }

  const addSale = (plan: Plan, date: Date, qty: number, credit?: { customer: Customer; due?: string; paid?: number }, tier?: { tiers: { min_quantity: number; unit_price: number }[]; mode: 'palier' | 'tranche'; enabled: boolean }) => {
    plan.qty -= qty
    const saleId = uid('sale')
    const line = tier ? previewLine(plan.price, tier.tiers, tier.mode, qty, tier.enabled) : { unitPrice: plan.price, total: plan.price * qty, tierMin: null as number | null }
    const sale: Sale = {
      id: saleId,
      shop_id: plan.shopId,
      item_id: plan.itemId,
      item_name: plan.name,
      quantity: qty,
      unit_price: line.unitPrice,
      unit_cost: plan.cost,
      payment_type: credit ? 'crédit' : 'comptant',
      customer_id: credit ? credit.customer.id : null,
      sale_date: toISO(date),
      created_at: ts(date),
      tier_min_quantity: line.tierMin,
      sale_mode: tier && tier.enabled && line.tierMin !== null ? 'un_client' : null,
      price_overridden: false,
      override_note: null,
    }
    sales.push(sale)
    if (credit) {
      const total = line.total
      // Crédit forcé : acompte imposé. Crédit aléatoire : ~40 % ont un premier versement
      const amountPaid =
        credit.paid !== undefined
          ? Math.min(total, credit.paid)
          : rng() < 0.4
            ? Math.round((total * (0.2 + rng() * 0.4)) / 100) * 100
            : 0
      const creditId = uid('credit')
      const due = credit.due ?? toISO(addDays(date, 20))
      const status =
        amountPaid >= total ? 'soldé' : due < toISO(now) ? 'en retard' : amountPaid > 0 ? 'partiellement payé' : 'en cours'
      credits.push({
        id: creditId,
        shop_id: plan.shopId,
        customer_id: credit.customer.id,
        sale_id: saleId,
        total_amount: total,
        amount_paid: amountPaid,
        due_date: due,
        status,
        created_at: ts(date),
        sale_date: toISO(date),
      })
      if (amountPaid > 0) {
        const payDate = addDays(date, 8)
        credit_payments.push({
          id: uid('cpay'),
          credit_id: creditId,
          shop_id: plan.shopId,
          amount: amountPaid,
          payment_date: toISO(payDate > now ? now : payDate),
          note: amountPaid >= total ? 'Remboursement total' : 'Acompte',
          created_at: ts(payDate > now ? now : payDate),
        })
      }
    }
    return sale
  }

  /* ---------------- 12 mois de ventes ---------------- */
  // Démo paliers : ventes d'huile de 1, 2, 3, 5 et 10 unités (prix 1000/1000/900/900/850)
  ;[1, 2, 3, 5, 10].forEach((q, k) => {
    addSale(huilePlan, addDays(now, -(9 - k * 2)), q, undefined, { tiers: HUILE_TIERS, mode: 'palier', enabled: true })
  })
  const FORCE: Record<number, () => void> = {
    // un crédit soldé
    60: () => {
      const plan = plans.find((p) => p.itemId === 'item_eau_1')
      if (plan && plan.qty >= 4) addSale(plan, addDays(now, -60), 4, { customer: customerOf('eau', 0), paid: 6000 })
    },
    // un crédit partiellement payé
    40: () => {
      const plan = plans.find((p) => p.itemId === 'item_cuisine_0')
      if (plan && plan.qty >= 2) addSale(plan, addDays(now, -40), 2, { customer: customerOf('cuisine', 0), paid: 5000 })
    },
    // un crédit en retard (échéance dépassée)
    25: () => {
      const plan = plans.find((p) => p.itemId === 'item_eau_2')
      if (plan && plan.qty >= 5) {
        addSale(plan, addDays(now, -25), 5, {
          customer: customerOf('eau', 1),
          due: toISO(addDays(now, -8)),
          paid: 0,
        })
      }
    },
    // un crédit récemment soldé (remboursement encaissé ce mois-ci)
    6: () => {
      const plan = plans.find((p) => p.itemId === 'item_cuisine_3')
      if (plan && plan.qty >= 6) {
        addSale(plan, addDays(now, -6), 6, {
          customer: customerOf('cuisine', 0),
          due: toISO(addDays(now, 4)),
          paid: 6 * plan.price,
        })
      }
    },
  }

  for (let back = 365; back >= 0; back--) {
    const day = addDays(now, -back)
    const weekend = day.getDay() === 0 || day.getDay() === 6
    const factor = weekend ? 1.3 : 1

    // Réapprovisionnements à dates variées, quand un article approche du seuil
    for (const plan of plans) {
      if (plan.qty < plan.daily * 12 && rng() < 0.85) {
        const qty = Math.max(5, Math.round(plan.daily * 45))
        const unitCost = Math.round(plan.cost * (0.96 + rng() * 0.16))
        addRestock(plan, day, qty, unitCost, rng() < 0.5 ? 'Grossiste du marché' : 'Fournisseur Central')
      }
    }

    for (const plan of plans) {
      const draws = Math.floor(rng() * plan.daily * 1.2 * factor)
      for (let k = 0; k < draws; k++) {
        const wanted = 1 + Math.floor(rng() * (plan.daily > 4 ? 3 : 1))
        const qty = Math.min(wanted, plan.qty)
        if (qty <= 0) continue
        const onCredit = rng() < 0.1 && back < 60
        if (onCredit) {
          const cust = customerOf(plan.key, Math.floor(rng() * 3))
          addSale(plan, day, qty, { customer: cust, due: toISO(addDays(day, 45)) })
        } else {
          addSale(plan, day, qty)
        }
      }
    }

    FORCE[back]?.()
  }

  // États de stock visibles dès le départ (avec de vraies ventes, donc
  // l'historique et le recalcul restent exacts) : une rupture, un stock bas
  const drain = (itemId: string, target: number) => {
    const plan = plans.find((p) => p.itemId === itemId)
    if (!plan) return
    let back = 1
    while (plan.qty > target && back <= 90) {
      addSale(plan, addDays(now, -back), 1)
      back += 1
    }
  }
  drain('item_eau_3', 0) // Bidon 10 L : rupture
  drain('item_cuisine_1', 3) // Couteau de cuisine : stock bas

  // Stock et coût moyen finaux après le rejeu chronologique
  for (const plan of plans) {
    const item = items.find((i) => i.id === plan.itemId)
    if (item) {
      item.stock = plan.qty
      item.cost_price = plan.cost
    }
  }
  const huileItem = items.find((i) => i.id === 'item_gros_huile')
  if (huileItem) {
    huileItem.stock = huilePlan.qty
    huileItem.cost_price = huilePlan.cost
  }

  /* ---------------- Mouvements de stock (stock avant / après exact) ---------------- */
  type Ev = { date: string; kind: 'r' | 's'; r?: Restock; s?: Sale }
  const events: Ev[] = [
    ...restocks.map((r) => ({ date: r.restock_date, kind: 'r' as const, r })),
    ...sales.map((s) => ({ date: s.sale_date, kind: 's' as const, s })),
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    // même jour : les réapproventements précèdent les ventes (comme dans le rejeu)
    if (a.kind !== b.kind) return a.kind === 'r' ? -1 : 1
    return 0
  })

  const running = new Map<string, number>()
  plans.forEach((p) => running.set(p.itemId, p.opening))
  const recentFrom = toISO(addDays(now, -45))

  for (const ev of events) {
    if (ev.kind === 'r' && ev.r) {
      const before = running.get(ev.r.item_id) ?? 0
      const after = before + ev.r.quantity
      running.set(ev.r.item_id, after)
      movements.push({
        id: uid('mov'),
        item_id: ev.r.item_id,
        shop_id: ev.r.shop_id,
        type: 'réappro',
        quantity: ev.r.quantity,
        stock_before: before,
        stock_after: after,
        ref_id: ev.r.id,
        created_at: ev.r.created_at,
      })
    } else if (ev.s) {
      const before = running.get(ev.s.item_id) ?? 0
      const after = before - ev.s.quantity
      running.set(ev.s.item_id, after)
      if (ev.s.sale_date >= recentFrom) {
        movements.push({
          id: uid('mov'),
          item_id: ev.s.item_id,
          shop_id: ev.s.shop_id,
          type: 'vente',
          quantity: ev.s.quantity,
          stock_before: before,
          stock_after: after,
          ref_id: ev.s.id,
          created_at: ev.s.created_at,
        })
      }
    }
  }

  return {
    shops,
    items,
    price_tiers,
    restocks,
    customers,
    sales,
    credits,
    credit_payments,
    stock_movements: movements,
    audit_log: [],
    shop_members: shops.map((s) => ({
      id: `member_${s.id}_owner`,
      shop_id: s.id,
      user_id: 'demo-user',
      email: 'demo@local',
      role: 'proprietaire' as const,
      created_at: s.created_at,
    })),
  }
}

import type { Item, PriceTier, TierMode } from './types'
import { fcfa } from './format'

/* ------------------------------------------------------------------ */
/* Prix par paliers : miroir CLIENT de compute_sale_line (aperçu seul, */
/* le prix définitif est calculé par le serveur dans record_sale).     */
/* ------------------------------------------------------------------ */

export interface TierPreview {
  /** Prix unitaire appliqué (arrondi au franc en mode tranche) */
  unitPrice: number
  /** Total de la ligne */
  total: number
  /** Seuil du palier atteint, null si prix normal */
  tierMin: number | null
}

export const MAX_TIERS = 10

export const isTiered = (item: Pick<Item, 'tiered_pricing'>): boolean => item.tiered_pricing === true

export const tierModeOf = (item: Pick<Item, 'tier_mode'>): TierMode =>
  item.tier_mode === 'tranche' ? 'tranche' : 'palier'

export const tiersOf = (tiers: PriceTier[], itemId: string): PriceTier[] =>
  tiers.filter((t) => t.item_id === itemId).sort((a, b) => a.min_quantity - b.min_quantity)

/** Aperçu du prix pour une quantité (même formule que le serveur). */
export function previewLine(
  normalPrice: number,
  tiers: { min_quantity: number; unit_price: number }[],
  mode: TierMode,
  quantity: number,
  enabled: boolean,
): TierPreview {
  const sorted = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity)
  const qty = Math.floor(quantity)
  if (!enabled || qty <= 0 || sorted.length === 0) {
    return { unitPrice: normalPrice, total: normalPrice * Math.max(0, qty), tierMin: null }
  }
  const reached = sorted.filter((t) => t.min_quantity <= qty)
  if (reached.length === 0) {
    return { unitPrice: normalPrice, total: normalPrice * qty, tierMin: null }
  }
  const best = reached[reached.length - 1]
  if (mode === 'tranche') {
    let total = 0
    let bound = 1
    let prev = normalPrice
    for (const t of reached) {
      total += (t.min_quantity - bound) * prev
      bound = t.min_quantity
      prev = t.unit_price
    }
    total += (qty - bound + 1) * prev
    return { unitPrice: Math.round(total / qty), total, tierMin: best.min_quantity }
  }
  return { unitPrice: best.unit_price, total: best.unit_price * qty, tierMin: best.min_quantity }
}

/** Palier suivant : utilisé pour la suggestion « Plus que N unités… ». */
export function nextTier(
  tiers: { min_quantity: number; unit_price: number }[],
  quantity: number,
): { min_quantity: number; unit_price: number; missing: number } | null {
  const sorted = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity)
  const next = sorted.find((t) => t.min_quantity > quantity) ?? null
  return next ? { ...next, missing: next.min_quantity - quantity } : null
}

/** Résumé lisible : « 1 à 2 : 1 000 F · 3 à 9 : 900 F · 10 et plus : 850 F ». */
export function summaryRanges(normalPrice: number, tiers: PriceTier[]): string {
  const sorted = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  if (sorted[0].min_quantity > 1) {
    parts.push(`1 à ${sorted[0].min_quantity - 1} : ${fcfa(normalPrice)}`)
  }
  sorted.forEach((t, i) => {
    const last = i === sorted.length - 1
    parts.push(
      last
        ? `${t.min_quantity} et plus : ${fcfa(t.unit_price)}`
        : `${t.min_quantity} à ${sorted[i + 1].min_quantity - 1} : ${fcfa(t.unit_price)}`,
    )
  })
  return parts.join(' · ')
}

/** Marge unitaire et taux de marge d'un palier face au coût moyen. */
export function tierMargin(tierPrice: number, avgCost: number): { unit: number; pct: number | null } {
  const unit = tierPrice - avgCost
  return { unit, pct: tierPrice > 0 ? (unit / tierPrice) * 100 : null }
}

/** Conversion remise ↔ prix, base = prix normal. */
export const pctToPrice = (basePrice: number, discountPct: number): number =>
  Math.max(0, Math.round(basePrice * (1 - discountPct / 100)))
export const priceToPct = (basePrice: number, tierPrice: number): number =>
  basePrice > 0 ? Math.round(((basePrice - tierPrice) / basePrice) * 1000) / 10 : 0

/** Suggestion du premier palier : seuil et remise par défaut, sinon 3 unités −5 %. */
export function suggestFirstTier(
  basePrice: number,
  shopDefault: { min_quantity: number; discount_pct: number } | null,
): { min_quantity: number; unit_price: number } {
  if (shopDefault) {
    return { min_quantity: shopDefault.min_quantity, unit_price: pctToPrice(basePrice, shopDefault.discount_pct) }
  }
  return { min_quantity: 3, unit_price: pctToPrice(basePrice, 5) }
}

/* ------------------------------------------------------------------ */
/* Règle par défaut d'une boutique (préremplissage seul, par appareil) */
/* ------------------------------------------------------------------ */

const defaultKey = (shopId: string) => `ma-boutique-tier-default-${shopId}`

export function readShopTierDefault(shopId: string): { min_quantity: number; discount_pct: number } | null {
  try {
    const raw = localStorage.getItem(defaultKey(shopId))
    if (!raw) return null
    const v = JSON.parse(raw) as { min_quantity?: unknown; discount_pct?: unknown }
    if (
      typeof v.min_quantity === 'number' &&
      Number.isInteger(v.min_quantity) &&
      v.min_quantity >= 2 &&
      typeof v.discount_pct === 'number' &&
      v.discount_pct > 0 &&
      v.discount_pct <= 90
    ) {
      return { min_quantity: v.min_quantity, discount_pct: v.discount_pct }
    }
    return null
  } catch {
    return null
  }
}

export function saveShopTierDefault(shopId: string, value: { min_quantity: number; discount_pct: number }): void {
  localStorage.setItem(defaultKey(shopId), JSON.stringify(value))
}

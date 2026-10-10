import type { DB } from './types'
import { todayISO } from './format'
import { cleanFileName, shopCurrency, type CurrencyCode } from './currency'

/* ------------------------------------------------------------------ */
/* Fiche de stock : construction PURE (testable) à partir des données  */
/* réelles. Aucune valeur d'exemple codée en dur.                      */
/* Fiche A : une boutique · Fiche B : toutes, regroupées par boutique */
/* ------------------------------------------------------------------ */

export const SHEET_COLUMNS_FULL = [
  'Article',
  'Stock',
  'Prix achat',
  'Prix vente',
  'Marge unitaire',
  'Valeur (achat)',
  'Valeur (vente)',
  'Bénéfice potentiel',
] as const

/** Colonnes réduites pour le vendeur (ni achat, ni marge, ni bénéfice). */
export const SHEET_COLUMNS_SELLER = ['Article', 'Stock', 'Prix vente', 'Valeur (vente)'] as const

export interface SheetItemRow {
  name: string
  stock: number
  cost: number
  price: number
  marginUnit: number
  valueCost: number
  valuePrice: number
  /** = Valeur (vente) − Valeur (achat) : gain si tout le stock est vendu */
  potential: number
  rupture: boolean
  /** Bénéfice négatif (vendu à perte) */
  loss: boolean
}

export interface SheetTotals {
  count: number
  units: number
  valueCost: number
  valuePrice: number
  potential: number
}

export interface SheetSection {
  shopId: string
  shopName: string
  currency: CurrencyCode
  empty: boolean
  rows: SheetItemRow[]
  subtotal: SheetTotals
}

export interface StockSheet {
  kind: 'A' | 'B'
  title: string
  subtitle: string
  filenameBase: string
  /** Devise unique quand toutes les sections la partagent (toujours vrai aujourd'hui) */
  currency: CurrencyCode
  multiCurrency: boolean
  showMoney: boolean
  columns: readonly string[]
  sections: SheetSection[]
  /** Total général (fiche B, devise unique) ; null sinon */
  grandTotal: SheetTotals | null
  totalLabel: string
}

const zeroTotals = (): SheetTotals => ({ count: 0, units: 0, valueCost: 0, valuePrice: 0, potential: 0 })

export function totalLabelFor(count: number): string {
  return `TOTAL (${count} article${count > 1 ? 's' : ''})`
}

export function sheetDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function buildStockSheet({
  db,
  scope,
  showMoney,
  businessName,
  date = todayISO(),
}: {
  db: DB
  /** 'all' ou id de boutique */
  scope: string
  /** false pour le vendeur : colonnes réduites, sans achat/marge/bénéfice */
  showMoney: boolean
  /** Nom du commerce (profil), ajouté au sous-titre s'il est renseigné */
  businessName: string
  date?: string
}): StockSheet {
  const activeShops = db.shops.filter((s) => !s.deleted_at)
  const scoped =
    scope === 'all' ? activeShops : activeShops.filter((s) => s.id === scope)
  // Une seule boutique au total : directement la fiche A
  const kind: 'A' | 'B' = activeShops.length <= 1 ? 'A' : scope === 'all' ? 'B' : 'A'
  const sections: SheetSection[] = scoped.map((shop) => {
    const rows: SheetItemRow[] = db.items
      .filter((i) => i.shop_id === shop.id && !i.deleted_at)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((i) => {
        const marginUnit = i.price - i.cost_price
        const valueCost = i.stock * i.cost_price
        const valuePrice = i.stock * i.price
        const potential = valuePrice - valueCost
        return {
          name: i.name,
          stock: i.stock,
          cost: i.cost_price,
          price: i.price,
          marginUnit,
          valueCost,
          valuePrice,
          potential,
          rupture: i.stock <= 0,
          loss: potential < 0,
        }
      })
    const subtotal = rows.reduce(
      (a, r) => ({
        count: a.count + 1,
        units: a.units + r.stock,
        valueCost: a.valueCost + r.valueCost,
        valuePrice: a.valuePrice + r.valuePrice,
        potential: a.potential + r.potential,
      }),
      zeroTotals(),
    )
    return {
      shopId: shop.id,
      shopName: shop.name,
      currency: shopCurrency(shop as { currency_code?: string }),
      empty: rows.length === 0,
      rows,
      subtotal,
    }
  })

  const currencies = [...new Set(sections.map((s) => s.currency))]
  const multiCurrency = currencies.length > 1
  const currency = currencies[0] ?? 'XOF'
  const grandTotal =
    kind === 'B' && !multiCurrency
      ? sections.reduce(
          (a, s) => ({
            count: a.count + s.subtotal.count,
            units: a.units + s.subtotal.units,
            valueCost: a.valueCost + s.subtotal.valueCost,
            valuePrice: a.valuePrice + s.subtotal.valuePrice,
            potential: a.potential + s.subtotal.potential,
          }),
          zeroTotals(),
        )
      : null

  const firstName = sections[0]?.shopName ?? 'Boutique'
  const title = kind === 'A' ? `Fiche de stock : ${firstName}` : 'Fiche de stock : Toutes les boutiques'
  const dateLabel = sheetDateLabel(date)
  const subtitle =
    `Éditée le ${dateLabel} · Devise : ${multiCurrency ? 'multiples' : currency}` +
    (businessName.trim() ? ` · ${businessName.trim()}` : '')
  const filenameBase = `Fiche-de-stock_${cleanFileName(kind === 'A' ? firstName : 'Toutes-les-boutiques')}_${date.slice(0, 10)}`
  const totalCount = grandTotal?.count ?? sections[0]?.subtotal.count ?? 0

  return {
    kind,
    title,
    subtitle,
    filenameBase,
    currency,
    multiCurrency,
    showMoney,
    columns: showMoney ? SHEET_COLUMNS_FULL : SHEET_COLUMNS_SELLER,
    sections,
    grandTotal,
    totalLabel: totalLabelFor(totalCount),
  }
}

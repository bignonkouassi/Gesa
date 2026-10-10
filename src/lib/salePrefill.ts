/* ------------------------------------------------------------------ */
/* Ressaisie après correction : le formulaire de vente rouvre        */
/* prérempli (article, quantité, date) dans l'onglet Ventes.          */
/* ------------------------------------------------------------------ */

export interface SalePrefill {
  item_id: string
  quantity: number
  sale_date: string
}

const KEY = 'ma-boutique-sale-prefill'

export function writeSalePrefill(p: SalePrefill): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* best effort */
  }
}

/** Lit puis efface (consommation unique). */
export function takeSalePrefill(): SalePrefill | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    localStorage.removeItem(KEY)
    const v = JSON.parse(raw) as Partial<SalePrefill>
    if (typeof v.item_id !== 'string' || !Number.isInteger(v.quantity) || (v.quantity as number) <= 0) return null
    if (typeof v.sale_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.sale_date)) return null
    return { item_id: v.item_id, quantity: v.quantity as number, sale_date: v.sale_date }
  } catch {
    return null
  }
}

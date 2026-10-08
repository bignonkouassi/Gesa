import type { DB, Role, ShopMember } from './types'

/**
 * Rôles par boutique (source de vérité : table shop_members).
 * - proprietaire : accès total
 * - gerant : ventes, stock, crédits, historiques (pas de suppression de boutique)
 * - vendeur : ventes et stock uniquement, SANS prix d'achat, bénéfices, dépenses ni bilans
 */

export const ROLE_LABEL: Record<Role, string> = {
  proprietaire: 'Propriétaire',
  gerant: 'Gérant',
  vendeur: 'Vendeur',
}

/**
 * Rôle de `userId` sur `shopId` ; null = aucun accès.
 * L'invitation par e-mail est reconnue même si user_id est encore vide
 * (membre invité avant création de compte) — miroir de my_shop_role().
 */
export function roleOf(db: DB, userId: string, shopId: string, email?: string): Role | null {
  const m = db.shop_members.find(
    (x) =>
      x.shop_id === shopId &&
      (x.user_id === userId ||
        (email !== undefined && x.email.toLowerCase() === email.toLowerCase())),
  )
  if (m) return m.role
  // Le propriétaire de la ligne shop est toujours propriétaire
  const shop = db.shops.find((s) => s.id === shopId)
  if (shop && shop.user_id === userId) return 'proprietaire'
  return null
}

/** Niveau d'autorité (plus haut = plus de droits) pour comparer. */
const RANK: Record<Role, number> = { vendeur: 1, gerant: 2, proprietaire: 3 }

export const atLeast = (role: Role | null, min: Role): boolean =>
  role !== null && RANK[role] >= RANK[min]

/* ---------------- Permissions fonctionnelles ---------------- */

/** Voit les prix d'achat, bénéfices, dépenses et bilans. */
export const canSeeFinances = (role: Role | null): boolean => atLeast(role, 'gerant')

/** Saisit des ventes et consulte le stock. */
export const canSell = (role: Role | null): boolean => atLeast(role, 'vendeur')

/** Gère le stock : articles, réappros, seuils. */
export const canManageStock = (role: Role | null): boolean => atLeast(role, 'gerant')

/** Gère les crédits et clients. */
export const canManageCredits = (role: Role | null): boolean => atLeast(role, 'gerant')

/** Supprime (en douceur) articles/clients/boutiques. */
export const canDelete = (role: Role | null): boolean => atLeast(role, 'gerant')
export const canDeleteShop = (role: Role | null): boolean => role === 'proprietaire'

/** Invite ou retire des employés, exporte, change le nom de la boutique. */
export const canManageMembers = (role: Role | null): boolean => role === 'proprietaire'
export const canExport = (role: Role | null): boolean => atLeast(role, 'gerant')
export const canSeeAudit = (role: Role | null): boolean => atLeast(role, 'gerant')
export const canRenameShop = (role: Role | null): boolean => role === 'proprietaire'

/** Rôle le plus bas parmi toutes les boutiques visibles (scope). */
export function weakestRole(db: DB, userId: string, scope: string, email?: string): Role | null {
  const shops = scope === 'all' ? db.shops.filter((s) => !s.deleted_at) : db.shops.filter((s) => s.id === scope)
  if (shops.length === 0) return null
  let weakest: Role | null = null
  for (const s of shops) {
    const r = roleOf(db, userId, s.id, email)
    if (!r) continue
    if (!weakest || RANK[r] < RANK[weakest]) weakest = r
  }
  return weakest
}

export function membersOf(db: DB, shopId: string): ShopMember[] {
  return db.shop_members.filter((m) => m.shop_id === shopId)
}

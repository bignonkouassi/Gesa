export type ID = string

export interface Shop {
  id: ID
  user_id: string
  name: string
  created_at: string
  /** Suppression douce : 30 jours pour annuler */
  deleted_at: string | null
}

export type TierMode = 'palier' | 'tranche'

/** Cumul de la journée (prix normal) ou achat d'un seul client (palier) */
export type SaleMode = 'cumul_jour' | 'un_client'

export interface Item {
  id: ID
  shop_id: string
  name: string
  /** Coût moyen pondéré actuel (prix d'achat) */
  cost_price: number
  /** Prix de vente actuel */
  price: number
  stock: number
  low_stock_threshold: number
  /** Stock initial à la création (sert à recalculer après suppression d'un réappro) */
  opening_stock: number
  /** Coût initial à la création */
  opening_cost: number
  /** Prix par quantité activé (paliers conservés même si désactivé) */
  tiered_pricing: boolean
  /** 'palier' : tout au prix du palier · 'tranche' : prix par tranche */
  tier_mode: TierMode
  created_at: string
  deleted_at: string | null
}

export interface Restock {
  id: ID
  item_id: string
  shop_id: string
  quantity: number
  unit_cost: number
  restock_date: string
  supplier: string | null
  created_at: string
}

export interface Customer {
  id: ID
  shop_id: string
  name: string
  phone: string
  created_at: string
  /** Suppression douce ; nom et téléphone anonymisés lors d'une suppression RGPD */
  deleted_at: string | null
  anonymized: boolean
}

export type PaymentType = 'comptant' | 'crédit'

export interface Sale {
  id: ID
  shop_id: string
  item_id: ID
  item_name: string
  quantity: number
  /** Prix de vente au moment de la vente (jamais modifié ensuite) */
  unit_price: number
  /** Prix d'achat moyen au moment de la vente (jamais modifié ensuite) */
  unit_cost: number
  payment_type: PaymentType
  customer_id: ID | null
  sale_date: string
  created_at: string
  /** Annulation douce : la vente est conservée (jamais supprimée) mais exclue des calculs et de l'écran */
  cancelled_at?: string | null
  /** Palier appliqué (seuil), vide si prix normal ou modifié */
  tier_min_quantity: number | null
  /** Cumul du jour ou un seul client ; null pour les articles sans option */
  sale_mode: SaleMode | null
  /** Vrai si le prix a été modifié à la main (gérant+, note obligatoire) */
  price_overridden: boolean
  /** Motif du prix modifié */
  override_note: string | null
}

/** Palier de prix : à partir de min_quantity, prix unitaire dégressif */
export interface PriceTier {
  id: ID
  item_id: ID
  min_quantity: number
  unit_price: number
  created_at: string
}

export type CreditStatus = 'en cours' | 'partiellement payé' | 'soldé' | 'en retard'

export interface Credit {
  id: ID
  shop_id: string
  customer_id: ID
  sale_id: ID
  total_amount: number
  amount_paid: number
  due_date: string | null
  status: CreditStatus
  created_at: string
  /** Date de la vente d'origine (copie pour l'affichage) */
  sale_date: string
}

export interface CreditPayment {
  id: ID
  credit_id: ID
  shop_id: string
  amount: number
  payment_date: string
  note: string | null
  created_at: string
}

export type MovementType = 'vente' | 'réappro' | 'ajustement' | 'annulation'

export interface StockMovement {
  id: ID
  item_id: ID
  shop_id: string
  type: MovementType
  quantity: number
  stock_before: number
  stock_after: number
  /** Lien vers la vente ou le réappro concerné */
  ref_id: ID | null
  created_at: string
}

/** Journal d'audit : qui a fait quoi et quand (non modifiable) */
export interface AuditEntry {
  id: ID
  shop_id: string | null
  action: string
  target: string
  details: string | null
  created_at: string
  /** utilisateur local (ou Supabase Auth en mode connecté) */
  author: string
}

export type Role = 'proprietaire' | 'gerant' | 'vendeur'

/** Accès d'un utilisateur à une boutique (source de vérité des permissions) */
export interface ShopMember {
  id: ID
  shop_id: string
  /** uuid Supabase, ou identifiant local */
  user_id: string
  email: string
  role: Role
  created_at: string
}

export interface DB {
  shops: Shop[]
  items: Item[]
  price_tiers: PriceTier[]
  restocks: Restock[]
  customers: Customer[]
  sales: Sale[]
  credits: Credit[]
  credit_payments: CreditPayment[]
  stock_movements: StockMovement[]
  audit_log: AuditEntry[]
  shop_members: ShopMember[]
}

export const emptyDB = (): DB => ({
  shops: [],
  items: [],
  price_tiers: [],
  restocks: [],
  customers: [],
  sales: [],
  credits: [],
  credit_payments: [],
  stock_movements: [],
  audit_log: [],
  shop_members: [],
})

export type TableName = keyof DB

export const TABLES: TableName[] = [
  'shops',
  'items',
  'price_tiers',
  'restocks',
  'customers',
  'sales',
  'credits',
  'credit_payments',
  'stock_movements',
  'audit_log',
  'shop_members',
]

export interface RowMap {
  shops: Shop
  items: Item
  price_tiers: PriceTier
  restocks: Restock
  customers: Customer
  sales: Sale
  credits: Credit
  credit_payments: CreditPayment
  stock_movements: StockMovement
  audit_log: AuditEntry
  shop_members: ShopMember
}

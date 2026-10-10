import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AuditEntry,
  Credit,
  CreditPayment,
  DB,
  Item,
  PaymentType,
  PriceTier,
  Restock,
  Sale,
} from '../lib/types'
import { emptyDB } from '../lib/types'
import {
  LocalRepo,
  SupabaseRepo,
  restoreSupabaseSession,
  rpcCall,
  signInLocal,
  signInSupabase,
  requestPasswordReset,
  signOut as signOutRepo,
  signUpSupabase,
  supabaseEnabled,
  type AuthUser,
  type Repo,
} from '../lib/repo'
import { computeCreditStatus, creditRest, recomputeItem } from '../lib/calc'
import { isTiered, MAX_TIERS, previewLine, tierModeOf, tiersOf } from '../lib/tiers'
import { atLeast, weakestRole } from '../lib/permissions'
import type { Role } from '../lib/types'
import { todayISO } from '../lib/format'
import { uid } from '../lib/seed'
import {
  creditPaymentInput,
  customerInput,
  emailInput,
  itemInput,
  parseOrThrow,
  restockInput,
  saleInput,
  shopInput,
  tierInput,
} from '../lib/validation'
import { ensureUserProfile } from '../lib/profile'

export type Scope = string | 'all'

export interface ToastMsg {
  id: string
  text: string
  kind: 'ok' | 'error' | 'warn'
}

export interface SaleInput {
  itemId: string
  quantity: number
  payment: PaymentType
  customerId?: string
  deposit?: number
  dueDate?: string | null
  date: string
  /** Prix saisi à la main (gérant+, note obligatoire) ; sinon palier serveur */
  overridePrice?: number
  overrideNote?: string
  /** Cumul du jour (défaut, prix normal) ou un seul client (palier) */
  saleMode?: 'cumul_jour' | 'un_client'
}

export interface RestockInput {
  itemId: string
  quantity: number
  unitCost: number
  date: string
  supplier?: string
}

interface StoreValue {
  ready: boolean
  mode: 'local' | 'supabase'
  user: AuthUser | null
  db: DB
  scope: Scope
  setScope: (s: Scope) => void
  /** Rôle le plus bas dans la portée active (masque finances et suppressions) */
  role: Role | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<string>
  resetPassword: (email: string) => Promise<string>
  logout: () => Promise<void>
  toasts: ToastMsg[]
  notify: (text: string, kind?: ToastMsg['kind']) => void
  dismissToast: (id: string) => void

  addShop: (name: string) => Promise<string>
  renameShop: (id: string, name: string) => Promise<void>
  deleteShop: (id: string) => Promise<void>

  setTieredPricing: (itemId: string, enabled: boolean) => Promise<void>
  setTierMode: (itemId: string, mode: 'palier' | 'tranche') => Promise<void>
  saveTier: (itemId: string, input: { id?: string; min_quantity: number; unit_price: number }) => Promise<void>
  deleteTier: (itemId: string, tierId: string) => Promise<void>
  copyTiers: (fromItemId: string, toItemId: string) => Promise<void>
  bulkSetTiered: (itemIds: string[], enabled: boolean) => Promise<void>

  addItem: (input: { shopId: string; name: string; cost: number; price: number; stock: number }) => Promise<void>
  updateItem: (id: string, patch: Partial<Item>) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  deleteCustomer: (id: string) => Promise<void>
  restore: (kind: 'items' | 'shops' | 'customers', id: string) => Promise<void>
  purge: (kind: 'items' | 'shops' | 'customers', id: string) => Promise<void>

  recordSale: (input: SaleInput) => Promise<void>
  undoLastSale: () => Promise<boolean>
  cancelSaleById: (saleId: string, opts?: { doneMsg?: string; auditDetail?: string }) => Promise<boolean>

  addRestock: (input: RestockInput) => Promise<string | null>
  updateRestock: (id: string, patch: Partial<Restock>) => Promise<void>
  deleteRestock: (id: string) => Promise<void>

  addCustomer: (shopId: string, name: string, phone: string) => Promise<string>
  inviteMember: (shopId: string, email: string, role: 'gerant' | 'vendeur') => Promise<void>
  setMemberRole: (memberId: string, role: 'gerant' | 'vendeur') => Promise<void>
  removeMember: (memberId: string) => Promise<void>
  addPayment: (creditId: string, amount: number, date: string, note?: string) => Promise<void>
  updateCredit: (id: string, patch: Partial<Credit>) => Promise<void>

  resetDemo: () => Promise<void>
}

const StoreCtx = createContext<StoreValue | null>(null)

const SCOPE_KEY = 'ma-boutique-scope'

/**
 * Vues de travail : une vente annulée reste en base à vie (aucune
 * suppression définitive) mais disparaît de l'état affiché — et donc
 * de tous les calculs, exports et écrans.
 */
const activeOnly = (d: DB): DB => ({ ...d, sales: d.sales.filter((s) => !s.cancelled_at) })

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [db, setDbState] = useState<DB>(emptyDB)
  /** Miroir synchrone de l'état : sert de point de restauration (rollback) */
  const dbRef = useRef<DB>(emptyDB())
  const setDb = useCallback((next: DB) => {
    dbRef.current = next
    setDbState(next)
  }, [])
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const [scope, setScopeState] = useState<Scope>(() => localStorage.getItem(SCOPE_KEY) ?? 'all')
  const role = useMemo(
    () => (user ? weakestRole(db, user.id, scope, user.email) : null),
    [db, scope, user],
  )
  const repoRef = useRef<Repo>(supabaseEnabled ? new SupabaseRepo() : new LocalRepo())

  const notify = useCallback((text: string, kind: ToastMsg['kind'] = 'ok') => {
    const id = uid('toast')
    setToasts((t) => [...t, { id, text, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const setScope = useCallback((s: Scope) => {
    setScopeState(s)
    localStorage.setItem(SCOPE_KEY, s)
  }, [])

  const boot = useCallback(async (auth: AuthUser | null) => {
    try {
      const data = await repoRef.current.loadAll()
      setDb(activeOnly(data))
      // Première entrée : le nom saisi à l'inscription est déjà prêt
      if (auth) await ensureUserProfile(auth)
      setUser(auth)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur de chargement des données', 'error')
      setDb(emptyDB())
      setUser(auth)
    } finally {
      setReady(true)
    }
  }, [notify, setDb])

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (supabaseEnabled) {
        const session = await restoreSupabaseSession()
        if (alive && session) await boot(session)
        else if (alive) {
          setUser(null)
          setReady(true)
        }
      } else {
        await boot(await signInLocal())
      }
    })()
    return () => {
      alive = false
    }
  }, [boot])

  /** Construit une entrée de journal d'audit (non modifiable) */
  const newAudit = useCallback(
    (shopId: string | null, action: string, target: string, details?: string): AuditEntry => ({
      id: uid('audit'),
      shop_id: shopId,
      action,
      target,
      details: details ?? null,
      created_at: new Date().toISOString(),
      author: user?.email ?? 'local',
    }),
    [user],
  )

  /**
   * Applique un nouvel état (optimiste), persiste puis journalise.
   * Si la sauvegarde échoue, l'état optimiste est ANNULÉ : on ne
   * garde jamais à l'écran une opération que le serveur a refusée.
   */
  const commit = useCallback(
    async (next: DB, ops: () => Promise<void>, audit?: AuditEntry) => {
      const withAudit = audit ? { ...next, audit_log: [...next.audit_log, audit] } : next
      const prev = dbRef.current
      setDb(withAudit)
      try {
        await ops()
      } catch (e) {
        setDb(prev)
        notify(e instanceof Error ? e.message : 'Erreur de sauvegarde', 'error')
        return
      }
      if (audit) {
        try {
          await repoRef.current.insert('audit_log', audit)
        } catch {
          // Journalisation secondaire : elle n'annule pas l'opération
          notify('Opération enregistrée, mais journalisation impossible', 'warn')
        }
      }
    },
    [notify, setDb],
  )

  /* ---------------- Auth ---------------- */

  const signIn = useCallback(
    async (email: string, password: string) => {
      const u = await signInSupabase(email, password)
      await boot(u)
    },
    [boot],
  )

  const signUp = useCallback(
    async (email: string, password: string, fullName: string) => signUpSupabase(email, password, fullName),
    [],
  )

  const resetPassword = useCallback(async (email: string) => requestPasswordReset(email), [])

  const logout = useCallback(async () => {
    await signOutRepo()
    setUser(null)
    setDb(emptyDB())
  }, [setDb])

  /* ---------------- Boutiques ---------------- */

  const addShop = useCallback(
    async (name: string) => {
      const trimmed = parseOrThrow(shopInput, { name }, 'Boutique').name
      const shop = {
        id: uid('shop'),
        user_id: user?.id ?? 'demo-user',
        name: trimmed,
        created_at: new Date().toISOString(),
        deleted_at: null,
      }
      await commit({ ...db, shops: [...db.shops, shop] }, () => repoRef.current.insert('shops', shop))
      notify(`Boutique « ${trimmed} » créée`)
      return shop.id
    },
    [commit, db, notify, user],
  )

  const renameShop = useCallback(
    async (id: string, name: string) => {
      const trimmed = parseOrThrow(shopInput, { name }, 'Boutique').name
      const next = { ...db, shops: db.shops.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) }
      await commit(next, () => repoRef.current.update('shops', id, { name: trimmed }))
      notify('Boutique renommée')
    },
    [commit, db, notify],
  )

  const deleteShop = useCallback(
    async (id: string) => {
      const shop = db.shops.find((s) => s.id === id)
      if (!shop) return
      const now = new Date().toISOString()
      const next: DB = {
        ...db,
        shops: db.shops.map((s) => (s.id === id ? { ...s, deleted_at: now } : s)),
      }
      await commit(
        next,
        () => repoRef.current.update('shops', id, { deleted_at: now }),
        newAudit(id, 'suppression_boutique', shop.name, 'Suppression douce, restaurable sous 30 jours'),
      )
      if (scope === id) setScope('all')
      notify('Boutique supprimée : données conservées (corbeille 30 jours)')
    },
    [commit, db, notify, newAudit, scope, setScope],
  )

  /* ---------------- Membres (rôles par boutique) ---------------- */

  const inviteMember = useCallback(
    async (shopId: string, email: string, role: 'gerant' | 'vendeur') => {
      const addr = parseOrThrow(emailInput, email, 'E-mail').trim()
      if (db.shop_members.some((m) => m.shop_id === shopId && m.email.toLowerCase() === addr.toLowerCase())) {
        throw new Error('Cet e-mail a déjà accès à cette boutique.')
      }
      const member = {
        id: uid('member'),
        shop_id: shopId,
        // En mode hors ligne l'invitation est en attente d'activation par lien
        user_id: `pending:${addr.toLowerCase()}`,
        email: addr,
        role,
        created_at: new Date().toISOString(),
      }
      await commit(
        { ...db, shop_members: [...db.shop_members, member] },
        () => repoRef.current.insert('shop_members', member),
        newAudit(shopId, 'invitation_membre', addr, `Rôle : ${role}`),
      )
      notify(`Invitation envoyée à ${addr} (${role})`)
    },
    [commit, db, notify, newAudit],
  )

  const setMemberRole = useCallback(
    async (memberId: string, role: 'gerant' | 'vendeur') => {
      const m = db.shop_members.find((x) => x.id === memberId)
      if (!m) return
      await commit(
        { ...db, shop_members: db.shop_members.map((x) => (x.id === memberId ? { ...x, role } : x)) },
        () => repoRef.current.update('shop_members', memberId, { role }),
        newAudit(m.shop_id, 'changement_role', m.email, `Nouveau rôle : ${role}`),
      )
      notify(`Rôle de ${m.email} : ${role}`)
    },
    [commit, db, notify, newAudit],
  )

  const removeMember = useCallback(
    async (memberId: string) => {
      const m = db.shop_members.find((x) => x.id === memberId)
      if (!m) return
      const next: DB = { ...db, shop_members: db.shop_members.filter((x) => x.id !== memberId) }
      await commit(
        next,
        async () => repoRef.current.remove('shop_members', [memberId]),
        newAudit(m.shop_id, 'retrait_acces', m.email, 'Accès retiré'),
      )
      notify(`Accès retiré à ${m.email}`)
    },
    [commit, db, notify, newAudit],
  )

  /* ---------------- Articles ---------------- */

  const addItem = useCallback(
    async (input: {
      shopId: string
      name: string
      cost: number
      price: number
      stock: number
      tiered?: boolean
      tiers?: { min_quantity: number; unit_price: number }[]
    }) => {
      const v = parseOrThrow(itemInput, input, 'Article')
      const now = new Date().toISOString()
      const item: Item = {
        id: uid('item'),
        shop_id: input.shopId,
        name: v.name,
        cost_price: v.cost,
        price: v.price,
        stock: v.stock,
        low_stock_threshold: 5,
        opening_stock: v.stock,
        opening_cost: v.cost,
        tiered_pricing: input.tiered === true,
        tier_mode: 'palier',
        created_at: now,
        deleted_at: null,
      }
      const tiers: PriceTier[] = (input.tiered === true ? (input.tiers ?? []) : []).map((t) => {
        const clean = parseOrThrow(tierInput, t, 'Palier')
        return { id: uid('tier'), item_id: item.id, min_quantity: clean.min_quantity, unit_price: clean.unit_price, created_at: now }
      })
      await commit(
        { ...db, items: [...db.items, item], price_tiers: [...db.price_tiers, ...tiers] },
        async () => {
          await repoRef.current.insert('items', item)
          for (const t of tiers) await repoRef.current.insert('price_tiers', t)
        },
        newAudit(item.shop_id, 'creation_article', v.name, input.tiered === true ? 'Prix par quantité activé' : undefined),
      )
      notify(`Article « ${v.name} » ajouté`)
    },
    [commit, db, notify, newAudit],
  )

  const updateItem = useCallback(
    async (id: string, patch: Partial<Item>) => {
      const next = { ...db, items: db.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }
      const before = db.items.find((i) => i.id === id)
      await commit(
        next,
        () => repoRef.current.update('items', id, patch),
        patch.price !== undefined && before && patch.price !== before.price
          ? newAudit(before.shop_id, 'changement_prix', before.name, `${before.price} F → ${patch.price} F`)
          : undefined,
      )
    },
    [commit, db, newAudit],
  )

  const deleteItem = useCallback(
    async (id: string) => {
      const item = db.items.find((i) => i.id === id)
      if (!item) return
      const now = new Date().toISOString()
      const next: DB = {
        ...db,
        items: db.items.map((i) => (i.id === id ? { ...i, deleted_at: now } : i)),
      }
      await commit(
        next,
        () => repoRef.current.update('items', id, { deleted_at: now }),
        newAudit(item.shop_id, 'suppression_article', item.name, 'Suppression douce, historique conservé'),
      )
      notify(`Article « ${item.name} » retiré : historique conservé (corbeille 30 jours)`)
    },
    [commit, db, notify, newAudit],
  )

  /** Suppression RGPD : les données personnelles sont anonymisées, les montants restent */
  const deleteCustomer = useCallback(
    async (id: string) => {
      const customer = db.customers.find((c) => c.id === id)
      if (!customer) return
      const now = new Date().toISOString()
      const next: DB = {
        ...db,
        customers: db.customers.map((c) =>
          c.id === id ? { ...c, name: 'Client supprimé', phone: '', deleted_at: now, anonymized: true } : c,
        ),
      }
      await commit(
        next,
        () =>
          repoRef.current.update('customers', id, {
            name: 'Client supprimé',
            phone: '',
            deleted_at: now,
            anonymized: true,
          }),
        newAudit(customer.shop_id, 'suppression_client', customer.name, 'Données personnelles anonymisées, montants conservés'),
      )
      notify('Client supprimé : ses données personnelles sont anonymisées')
    },
    [commit, db, notify, newAudit],
  )

  /** Restaure une suppression douce (30 jours) */
  const restore = useCallback(
    async (kind: 'items' | 'shops' | 'customers', id: string) => {
      const row =
        kind === 'items'
          ? db.items.find((i) => i.id === id)
          : kind === 'shops'
            ? db.shops.find((s) => s.id === id)
            : db.customers.find((c) => c.id === id)
      if (!row) return
      const next: DB = {
        ...db,
        items: kind === 'items' ? db.items.map((i) => (i.id === id ? { ...i, deleted_at: null } : i)) : db.items,
        shops: kind === 'shops' ? db.shops.map((s) => (s.id === id ? { ...s, deleted_at: null } : s)) : db.shops,
        customers:
          kind === 'customers'
            ? db.customers.map((c) => (c.id === id ? { ...c, deleted_at: null, anonymized: false } : c))
            : db.customers,
      }
      await commit(
        next,
        async () => {
          await repoRef.current.update(kind, id, { deleted_at: null, ...(kind === 'customers' ? { anonymized: false } : {}) } as never)
        },
        newAudit('shop_id' in row ? row.shop_id : null, 'restauration', row.name ?? id, `Restauration depuis la corbeille (${kind})`),
      )
      notify('Élément restauré')
    },
    [commit, db, notify, newAudit],
  )

  /** Purge définitive depuis la corbeille (irréversible).
   * Côté serveur les cascades FK s'appliquent ; en local on les rejoue
   * à la main pour garder les deux copies identiques. */
  const purge = useCallback(async (kind: 'items' | 'shops' | 'customers', id: string) => {
    const r = repoRef.current
    if (kind === 'items') {
      const item = db.items.find((i) => i.id === id)
      if (!item) return
      if (!atLeast(role, 'gerant')) throw new Error('Seuls les gérants purgent la corbeille.')
      const tierIds = db.price_tiers.filter((t) => t.item_id === id).map((t) => t.id)
      await commit(
        { ...db, items: db.items.filter((i) => i.id !== id), price_tiers: db.price_tiers.filter((t) => t.item_id !== id) },
        async () => {
          // Supabase : la suppression de l'article cascade paliers et réappros
          if (r.mode !== 'supabase' && tierIds.length > 0) await r.remove('price_tiers', tierIds)
          await r.remove('items', [id])
        },
        newAudit(item.shop_id, 'purge_article', item.name, 'Suppression définitive (ventes conservées).'),
      )
      notify(`« ${item.name} » définitivement supprimé.`)
      return
    }
    if (kind === 'customers') {
      const customer = db.customers.find((c) => c.id === id)
      if (!customer) return
      if (!atLeast(role, 'gerant')) throw new Error('Seuls les gérants purgent la corbeille.')
      await commit(
        { ...db, customers: db.customers.filter((c) => c.id !== id) },
        () => r.remove('customers', [id]),
        newAudit(customer.shop_id, 'purge_client', customer.name, 'Suppression définitive (historique conservé).'),
      )
      notify('Client définitivement supprimé.')
      return
    }
    const shop = db.shops.find((s) => s.id === id)
    if (!shop) return
    if (role !== 'proprietaire') throw new Error('Seul le propriétaire supprime définitivement une boutique.')
    const itemIds = db.items.filter((i) => i.shop_id === id).map((i) => i.id)
    const tierIds = db.price_tiers.filter((t) => itemIds.includes(t.item_id)).map((t) => t.id)
    const restockIds = db.restocks.filter((x) => x.shop_id === id).map((x) => x.id)
    const customerIds = db.customers.filter((x) => x.shop_id === id).map((x) => x.id)
    const memberIds = db.shop_members.filter((x) => x.shop_id === id).map((x) => x.id)
    const saleIds = db.sales.filter((x) => x.shop_id === id).map((x) => x.id)
    const creditIds = db.credits.filter((x) => x.shop_id === id).map((x) => x.id)
    const paymentIds = db.credit_payments.filter((x) => creditIds.includes(x.credit_id)).map((x) => x.id)
    const movementIds = db.stock_movements.filter((x) => x.shop_id === id).map((x) => x.id)
    const auditIds = db.audit_log.filter((x) => x.shop_id === id).map((x) => x.id)
    await commit(
      {
        ...db,
        shops: db.shops.filter((s) => s.id !== id),
        items: db.items.filter((i) => i.shop_id !== id),
        price_tiers: db.price_tiers.filter((t) => !itemIds.includes(t.item_id)),
        restocks: db.restocks.filter((x) => x.shop_id !== id),
        customers: db.customers.filter((x) => x.shop_id !== id),
        shop_members: db.shop_members.filter((x) => x.shop_id !== id),
        sales: db.sales.filter((x) => x.shop_id !== id),
        credits: db.credits.filter((x) => x.shop_id !== id),
        credit_payments: db.credit_payments.filter((x) => !creditIds.includes(x.credit_id)),
        stock_movements: db.stock_movements.filter((x) => x.shop_id !== id),
        audit_log: db.audit_log.filter((x) => x.shop_id !== id),
      },
      async () => {
        // Supabase : la suppression de la boutique cascade tout (articles,
        // ventes, crédits, membres, journal) via les FK
        if (r.mode === 'supabase') {
          await r.remove('shops', [id])
          return
        }
        if (tierIds.length > 0) await r.remove('price_tiers', tierIds)
        if (itemIds.length > 0) await r.remove('items', itemIds)
        if (restockIds.length > 0) await r.remove('restocks', restockIds)
        if (customerIds.length > 0) await r.remove('customers', customerIds)
        if (memberIds.length > 0) await r.remove('shop_members', memberIds)
        if (saleIds.length > 0) await r.remove('sales', saleIds)
        if (creditIds.length > 0) await r.remove('credits', creditIds)
        if (paymentIds.length > 0) await r.remove('credit_payments', paymentIds)
        if (movementIds.length > 0) await r.remove('stock_movements', movementIds)
        if (auditIds.length > 0) await r.remove('audit_log', auditIds)
        await r.remove('shops', [id])
      },
      newAudit(id, 'purge_boutique', shop.name, 'Suppression définitive de la boutique et de ses données.'),
    )
    if (scope === id) setScope('all')
    notify(`Boutique « ${shop.name} » définitivement supprimée.`)
  }, [commit, db, notify, newAudit, role, scope, setScope])

  /* ---------------- Paliers de prix (gérant+, vendeur lecture seule) ---------------- */

  const requireTierManager = useCallback(
    (item: Item) => {
      if (!atLeast(role, 'gerant')) throw new Error('Seuls les gérants modifient les prix par quantité.')
      return item
    },
    [role],
  )

  /** Interrupteur : les paliers sont conservés mais inactifs quand éteint. */
  const setTieredPricing = useCallback(
    async (id: string, enabled: boolean) => {
      const item = db.items.find((i) => i.id === id)
      if (!item || item.tiered_pricing === enabled) return
      requireTierManager(item)
      const next = { ...db, items: db.items.map((i) => (i.id === id ? { ...i, tiered_pricing: enabled } : i)) }
      await commit(
        next,
        () => repoRef.current.update('items', id, { tiered_pricing: enabled }),
        newAudit(
          item.shop_id,
          enabled ? 'activation_paliers' : 'desactivation_paliers',
          item.name,
          enabled
            ? `Mode ${tierModeOf(item)}`
            : 'Les paliers sont conservés mais ne s’appliqueront plus. Les ventes passées ne changent pas.',
        ),
      )
      notify(
        enabled
          ? `Prix par quantité activé pour « ${item.name} ».`
          : 'Option désactivée : paliers conservés mais inactifs.',
      )
    },
    [commit, db, notify, newAudit, requireTierManager],
  )

  const setTierMode = useCallback(
    async (id: string, mode: 'palier' | 'tranche') => {
      const item = db.items.find((i) => i.id === id)
      if (!item || tierModeOf(item) === mode) return
      requireTierManager(item)
      const next = { ...db, items: db.items.map((i) => (i.id === id ? { ...i, tier_mode: mode } : i)) }
      await commit(
        next,
        () => repoRef.current.update('items', id, { tier_mode: mode }),
        newAudit(item.shop_id, 'changement_mode_paliers', item.name, `${tierModeOf(item)} → ${mode}`),
      )
      notify(`Mode de calcul : ${mode === 'palier' ? 'tout au palier' : 'par tranche'}.`)
    },
    [commit, db, notify, newAudit, requireTierManager],
  )

  const saveTier = useCallback(
    async (itemId: string, input: { id?: string; min_quantity: number; unit_price: number }) => {
      const item = db.items.find((i) => i.id === itemId)
      if (!item) throw new Error('Article introuvable.')
      requireTierManager(item)
      const v = parseOrThrow(tierInput, input, 'Palier')
      const others = tiersOf(db.price_tiers, itemId).filter((t) => t.id !== input.id)
      if (others.some((t) => t.min_quantity === v.min_quantity)) {
        throw new Error('Ce seuil existe déjà pour cet article.')
      }
      if (!input.id && others.length >= MAX_TIERS) {
        throw new Error('Un article peut avoir 10 paliers au maximum.')
      }
      const now = new Date().toISOString()
      if (input.id) {
        const before = db.price_tiers.find((t) => t.id === input.id)
        const next = {
          ...db,
          price_tiers: db.price_tiers.map((t) =>
            t.id === input.id ? { ...t, min_quantity: v.min_quantity, unit_price: v.unit_price } : t,
          ),
        }
        await commit(
          next,
          () => repoRef.current.update('price_tiers', input.id as string, { min_quantity: v.min_quantity, unit_price: v.unit_price }),
          newAudit(
            item.shop_id,
            'modification_palier',
            item.name,
            `Dès ${before?.min_quantity} : ${before?.unit_price} F → dès ${v.min_quantity} : ${v.unit_price} F`,
          ),
        )
      } else {
        const tier: PriceTier = { id: uid('tier'), item_id: itemId, min_quantity: v.min_quantity, unit_price: v.unit_price, created_at: now }
        await commit(
          { ...db, price_tiers: [...db.price_tiers, tier] },
          () => repoRef.current.insert('price_tiers', tier),
          newAudit(item.shop_id, 'creation_palier', item.name, `Dès ${v.min_quantity} unités : ${v.unit_price} F l’unité`),
        )
      }
      notify('Palier enregistré.')
    },
    [commit, db, notify, newAudit, requireTierManager],
  )

  const deleteTier = useCallback(
    async (itemId: string, tierId: string) => {
      const item = db.items.find((i) => i.id === itemId)
      const tier = db.price_tiers.find((t) => t.id === tierId)
      if (!item || !tier) return
      requireTierManager(item)
      await commit(
        { ...db, price_tiers: db.price_tiers.filter((t) => t.id !== tierId) },
        () => repoRef.current.remove('price_tiers', [tierId]),
        newAudit(item.shop_id, 'suppression_palier', item.name, `Palier dès ${tier.min_quantity} supprimé. Ventes passées inchangées.`),
      )
      notify('Palier supprimé : les ventes passées ne changent pas.')
    },
    [commit, db, notify, newAudit, requireTierManager],
  )

  /** Copie les paliers d'un article vers un autre (remplace ceux de la cible). */
  const copyTiers = useCallback(
    async (fromItemId: string, toItemId: string) => {
      const from = db.items.find((i) => i.id === fromItemId)
      const to = db.items.find((i) => i.id === toItemId)
      if (!from || !to || fromItemId === toItemId) return
      requireTierManager(to)
      const source = tiersOf(db.price_tiers, fromItemId)
      if (source.length === 0) throw new Error('L’article source n’a aucun palier.')
      const now = new Date().toISOString()
      const copies: PriceTier[] = source.map((t) => ({
        id: uid('tier'),
        item_id: toItemId,
        min_quantity: t.min_quantity,
        unit_price: t.unit_price,
        created_at: now,
      }))
      const oldIds = tiersOf(db.price_tiers, toItemId).map((t) => t.id)
      await commit(
        { ...db, price_tiers: [...db.price_tiers.filter((t) => t.item_id !== toItemId), ...copies] },
        async () => {
          if (oldIds.length > 0) await repoRef.current.remove('price_tiers', oldIds)
          for (const t of copies) await repoRef.current.insert('price_tiers', t)
        },
        newAudit(to.shop_id, 'copie_paliers', to.name, `Paliers copiés depuis « ${from.name} » (${copies.length})`),
      )
      notify(`Paliers copiés vers « ${to.name} ».`)
    },
    [commit, db, notify, newAudit, requireTierManager],
  )

  /** Active ou désactive l'option sur plusieurs articles à la fois. */
  const bulkSetTiered = useCallback(
    async (itemIds: string[], enabled: boolean) => {
      const targets = db.items.filter((i) => itemIds.includes(i.id) && i.tiered_pricing !== enabled)
      if (targets.length === 0) return
      if (!atLeast(role, 'gerant')) throw new Error('Seuls les gérants modifient les prix par quantité.')
      const set = new Set(targets.map((i) => i.id))
      await commit(
        { ...db, items: db.items.map((i) => (set.has(i.id) ? { ...i, tiered_pricing: enabled } : i)) },
        async () => {
          for (const t of targets) {
            await repoRef.current.update('items', t.id, { tiered_pricing: enabled })
            await repoRef.current.insert('audit_log', newAudit(
              t.shop_id,
              enabled ? 'activation_paliers' : 'desactivation_paliers',
              t.name,
              'Activation groupée',
            ))
          }
        },
      )
      notify(enabled ? `Prix par quantité activé sur ${targets.length} article(s).` : `Option désactivée sur ${targets.length} article(s).`)
    },
    [commit, db, notify, newAudit, role],
  )

  /* ---------------- Ventes ---------------- */

  const recordSale = useCallback(
    async (raw: SaleInput) => {
      const input = parseOrThrow(saleInput, raw, 'Vente')
      const item = db.items.find((i) => i.id === input.itemId)
      if (!item) throw new Error('Article introuvable.')
      const qty = input.quantity
      if (qty > item.stock) {
        throw new Error(
          `Stock insuffisant : il ne reste que ${item.stock} « ${item.name} » (demandé : ${qty}).`,
        )
      }
      if (input.payment === 'crédit' && !input.customerId) {
        throw new Error('Choisis un client (ou crée-le) pour une vente à crédit.')
      }
      const deposit = input.payment === 'crédit' ? Math.max(0, input.deposit ?? 0) : 0
      // Mode de vente : un palier ne se déclenche que pour UN client en UNE fois.
      // Par défaut (cumul de la journée) : prix normal, jamais de palier.
      // Le serveur recalcule et fait foi (record_sale ne reçoit jamais le prix).
      const tiered = isTiered(item)
      const saleMode = tiered ? (input.saleMode ?? 'cumul_jour') : null
      const applyTier = tiered && saleMode === 'un_client'
      if (tiered && saleMode === 'cumul_jour' && input.payment === 'crédit') {
        throw new Error('Le crédit n’est possible que pour une vente à un seul client.')
      }
      const line = previewLine(item.price, tiersOf(db.price_tiers, item.id), tierModeOf(item), qty, applyTier)
      let unitPrice = line.unitPrice
      let total = line.total
      let tierMin: number | null = line.tierMin
      let overridden = false
      let overrideNote: string | null = null
      if (input.overridePrice !== undefined) {
        if (!atLeast(role, 'gerant')) throw new Error('Seuls les gérants peuvent modifier le prix.')
        const note = (input.overrideNote ?? '').trim()
        if (!note) throw new Error('Une note est obligatoire pour un prix modifié.')
        unitPrice = input.overridePrice
        total = input.overridePrice * qty
        tierMin = null
        overridden = true
        overrideNote = note
      }
      if (deposit > total + 0.001) throw new Error('L’acompte ne peut pas dépasser le montant de la vente.')

      const now = new Date().toISOString()
      const sale: Sale = {
        id: uid('sale'),
        shop_id: item.shop_id,
        item_id: item.id,
        item_name: item.name,
        quantity: qty,
        unit_price: unitPrice,
        unit_cost: item.cost_price,
        payment_type: input.payment,
        customer_id: input.payment === 'crédit' ? input.customerId ?? null : null,
        sale_date: input.date,
        created_at: now,
        tier_min_quantity: tierMin,
        sale_mode: saleMode,
        price_overridden: overridden,
        override_note: overrideNote,
      }
      const movement = {
        id: uid('mov'),
        item_id: item.id,
        shop_id: item.shop_id,
        type: 'vente' as const,
        quantity: qty,
        stock_before: item.stock,
        stock_after: item.stock - qty,
        ref_id: sale.id,
        created_at: now,
      }
      const items = db.items.map((i) => (i.id === item.id ? { ...i, stock: i.stock - qty } : i))

      let credit: Credit | null = null
      let payment: CreditPayment | null = null
      if (input.payment === 'crédit') {
        credit = {
          id: uid('credit'),
          shop_id: item.shop_id,
          customer_id: input.customerId as string,
          sale_id: sale.id,
          total_amount: total,
          amount_paid: deposit,
          due_date: input.dueDate || null,
          status: computeCreditStatus(
            {
              id: '',
              shop_id: '',
              customer_id: '',
              sale_id: '',
              total_amount: total,
              amount_paid: deposit,
              due_date: input.dueDate || null,
              status: 'en cours',
              created_at: now,
              sale_date: input.date,
            },
            todayISO(),
          ),
          created_at: now,
          sale_date: input.date,
        }
        if (deposit > 0) {
          payment = {
            id: uid('cpay'),
            credit_id: credit.id,
            shop_id: item.shop_id,
            amount: deposit,
            payment_date: input.date,
            note: 'Acompte à la vente',
            created_at: now,
          }
        }
      }

      const next: DB = {
        ...db,
        items,
        sales: [...db.sales, sale],
        stock_movements: [...db.stock_movements, movement],
        credits: credit ? [...db.credits, credit] : db.credits,
        credit_payments: payment ? [...db.credit_payments, payment] : db.credit_payments,
      }

      await commit(
        next,
        async () => {
          const r = repoRef.current
          if (r.mode === 'supabase') {
            // Une seule requête SQL transactionnelle : le serveur
            // revérifie stock, rôles et montants sous verrou.
            await rpcCall('record_sale', {
              p_sale_id: sale.id,
              p_movement_id: movement.id,
              p_item_id: item.id,
              p_quantity: qty,
              p_payment_type: input.payment,
              p_customer_id: sale.customer_id,
              p_sale_date: input.date,
              p_deposit: deposit,
              p_due_date: input.dueDate || null,
              p_credit_id: credit?.id ?? null,
              p_payment_id: payment?.id ?? null,
              p_override_price: overridden ? unitPrice : null,
              p_override_note: overrideNote,
              p_sale_mode: saleMode,
            })
            return
          }
          await r.insert('sales', sale)
          await r.insert('stock_movements', movement)
          await r.update('items', item.id, { stock: item.stock - qty })
          if (credit) await r.insert('credits', credit)
          if (payment) await r.insert('credit_payments', payment)
        },
        newAudit(
          item.shop_id,
          'vente',
          `${qty} × ${item.name}`,
          `${sale.unit_price} F l’unité · ${input.payment}${credit ? ` · client ${credit.customer_id}` : ''}`,
        ),
      )
      notify(
        input.payment === 'crédit'
          ? `Vente à crédit enregistrée : ${qty} × ${item.name}`
          : `Vente enregistrée : ${qty} × ${item.name}`,
      )
    },
    [commit, db, notify, newAudit, role],
  )

  /** Annule une vente quelconque (correction) : stock remis, crédit non réglé
   * retiré, vente conservée côté serveur (annulation douce). */
  const cancelSaleById = useCallback(async (saleId: string, opts?: { doneMsg?: string; auditDetail?: string }): Promise<boolean> => {
    const target = db.sales.find((s) => s.id === saleId)
    if (!target) {
      notify('Vente introuvable.', 'error')
      return false
    }
    const credit = db.credits.find((c) => c.sale_id === target.id) ?? null
    if (credit && credit.amount_paid > 0.001) {
      // Jamais de perte de paiements : le crédit doit d'abord être remboursé
      notify(
        `Impossible d'annuler : ce crédit a déjà reçu ${Math.round(credit.amount_paid)} F de remboursements. Rembourse d'abord le client.`,
        'error',
      )
      return false
    }
    const item = db.items.find((i) => i.id === target.item_id)
    const items = item
      ? db.items.map((i) => (i.id === item.id ? { ...i, stock: i.stock + target.quantity } : i))
      : db.items

    const now = new Date().toISOString()
    const annulation = item
      ? {
          id: uid('mov'),
          item_id: item.id,
          shop_id: target.shop_id,
          type: 'annulation' as const,
          quantity: target.quantity,
          stock_before: item.stock,
          stock_after: item.stock + target.quantity,
          ref_id: target.id,
          created_at: now,
        }
      : null

    const next: DB = {
      ...db,
      items,
      // Sortie de la vue seulement : la vente reste stockée (annulation douce)
      sales: db.sales.filter((s) => s.id !== target.id),
      credits: credit ? db.credits.filter((c) => c.id !== credit.id) : db.credits,
      credit_payments: credit
        ? db.credit_payments.filter((p) => p.credit_id !== credit.id)
        : db.credit_payments,
      // Les écritures d'origine sont conservées : le journal de stock
      // reste une piste complète (vente puis annulation)
      stock_movements: annulation ? [...db.stock_movements, annulation] : db.stock_movements,
    }

    await commit(
      next,
      async () => {
        const r = repoRef.current
        if (r.mode === 'supabase') {
          // Le serveur marque cancelled_at, restaure le stock et retire
          // le crédit non réglé — sans jamais supprimer de vente.
          await rpcCall('cancel_sale', {
            p_sale_id: target.id,
            p_movement_id: annulation?.id ?? null,
          })
          return
        }
        // Mode hors ligne : même logique, appliquée localement
        await r.update('sales', target.id, { cancelled_at: now })
        if (credit) await r.remove('credits', [credit.id])
        if (item) await r.update('items', item.id, { stock: item.stock + target.quantity })
        if (annulation) await r.insert('stock_movements', annulation)
      },
      newAudit(target.shop_id, 'annulation_vente', `${target.quantity} × ${target.item_name}`, opts?.auditDetail ?? 'Annulation de la dernière vente'),
    )
    notify(opts?.doneMsg ?? `Vente annulée : ${target.quantity} × ${target.item_name}`)
    return true
  }, [commit, db, notify, newAudit])

  const undoLastSale = useCallback(async () => {
    const scoped = scope === 'all' ? db.sales : db.sales.filter((s) => s.shop_id === scope)
    if (scoped.length === 0) {
      notify('Aucune vente à annuler.', 'warn')
      return false
    }
    const last = [...scoped].sort((a, b) =>
      a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at),
    ).pop() as Sale

    return cancelSaleById(last.id, {
      doneMsg: `Dernière vente annulée : ${last.quantity} × ${last.item_name}`,
      auditDetail: 'Annulation de la dernière vente',
    })
  }, [db.sales, scope, notify, cancelSaleById])

  /* ---------------- Réapprovisionnements ---------------- */

  const addRestock = useCallback(
    async (raw: RestockInput): Promise<string | null> => {
      const input = parseOrThrow(restockInput, raw, 'Réapprovisionnement')
      const item = db.items.find((i) => i.id === input.itemId)
      if (!item) throw new Error('Article introuvable.')
      const qty = input.quantity

      const newCost =
        item.stock <= 0
          ? input.unitCost
          : (item.stock * item.cost_price + qty * input.unitCost) / (item.stock + qty)

      const now = new Date().toISOString()
      const restock: Restock = {
        id: uid('restock'),
        item_id: item.id,
        shop_id: item.shop_id,
        quantity: qty,
        unit_cost: input.unitCost,
        restock_date: input.date,
        supplier: input.supplier?.trim() || null,
        created_at: now,
      }
      const movement = {
        id: uid('mov'),
        item_id: item.id,
        shop_id: item.shop_id,
        type: 'réappro' as const,
        quantity: qty,
        stock_before: item.stock,
        stock_after: item.stock + qty,
        ref_id: restock.id,
        created_at: now,
      }
      const patch = { stock: item.stock + qty, cost_price: newCost }
      const next: DB = {
        ...db,
        items: db.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
        restocks: [...db.restocks, restock],
        stock_movements: [...db.stock_movements, movement],
      }
      await commit(
        next,
        async () => {
          const r = repoRef.current
          if (r.mode === 'supabase') {
            await rpcCall('record_restock', {
              p_restock_id: restock.id,
              p_movement_id: movement.id,
              p_item_id: item.id,
              p_quantity: qty,
              p_unit_cost: input.unitCost,
              p_restock_date: input.date,
              p_supplier: input.supplier?.trim() || null,
            })
            return
          }
          await r.insert('restocks', restock)
          await r.insert('stock_movements', movement)
          await r.update('items', item.id, patch)
        },
        newAudit(item.shop_id, 'réapprovisionnement', `${qty} × ${item.name}`, `${input.unitCost} F l’unité · stock ${item.stock} → ${item.stock + qty}`),
      )
      notify(`Réapprovisionnement : +${qty} « ${item.name} » (stock : ${item.stock + qty})`)

      let warning: string | null = null
      if (item.cost_price > 0) {
        const delta = ((input.unitCost - item.cost_price) / item.cost_price) * 100
        if (delta >= 10) {
          warning = `Le prix d’achat a augmenté de ${Math.round(delta)} % pour « ${item.name} », pense à vérifier ton prix de vente.`
        }
      }
      return warning
    },
    [commit, db, notify, newAudit],
  )

  const refreshItemState = (base: DB, itemId: string) => {
    const r = recomputeItem(base, itemId)
    return base.items.map((i) => (i.id === itemId ? { ...i, ...r } : i))
  }

  const updateRestock = useCallback(
    async (id: string, patch: Partial<Restock>) => {
      const restock = db.restocks.find((r) => r.id === id)
      if (!restock) return
      const updated: Restock = { ...restock, ...patch }
      const base: DB = { ...db, restocks: db.restocks.map((r) => (r.id === id ? updated : r)) }
      const itemId = restock.item_id
      const next: DB = { ...base, items: refreshItemState(base, itemId) }
      const item = next.items.find((i) => i.id === itemId)
      await commit(
        next,
        async () => {
          const r = repoRef.current
          if (r.mode === 'supabase') {
            await rpcCall('update_restock', {
              p_restock_id: id,
              p_quantity: updated.quantity,
              p_unit_cost: updated.unit_cost,
              p_restock_date: updated.restock_date,
              p_supplier: updated.supplier,
            })
            return
          }
          await r.update('restocks', id, patch)
          if (item) await r.update('items', item.id, { stock: item.stock, cost_price: item.cost_price })
        },
        newAudit(item?.shop_id ?? null, 'correction_réappro', item?.name ?? id, 'Stock et coût moyen recalculés'),
      )
      notify('Réapprovisionnement corrigé : stock et coût moyen recalculés')
    },
    [commit, db, notify, newAudit],
  )

  const deleteRestock = useCallback(
    async (id: string) => {
      const restock = db.restocks.find((r) => r.id === id)
      if (!restock) return
      const base: DB = { ...db, restocks: db.restocks.filter((r) => r.id !== id) }
      const next: DB = {
        ...base,
        items: refreshItemState(base, restock.item_id),
        stock_movements: db.stock_movements.filter((m) => m.ref_id !== id),
      }
      const item = next.items.find((i) => i.id === restock.item_id)
      await commit(
        next,
        async () => {
          const r = repoRef.current
          if (r.mode === 'supabase') {
            await rpcCall('delete_restock', { p_restock_id: id })
            return
          }
          await r.remove('restocks', [id])
          await r.remove(
            'stock_movements',
            db.stock_movements.filter((m) => m.ref_id === id).map((m) => m.id),
          )
          if (item) await r.update('items', item.id, { stock: item.stock, cost_price: item.cost_price })
        },
        newAudit(item?.shop_id ?? null, 'suppression_réappro', item?.name ?? id, 'Stock et coût moyen recalculés'),
      )
      notify('Réapprovisionnement supprimé : stock et coût moyen recalculés')
    },
    [commit, db, notify, newAudit],
  )

  /* ---------------- Clients & crédits ---------------- */

  const addCustomer = useCallback(
    async (shopId: string, name: string, phone: string): Promise<string> => {
      const v = parseOrThrow(customerInput, { name, phone }, 'Client')
      const customer = {
        id: uid('cust'),
        shop_id: shopId,
        name: v.name,
        phone: v.phone,
        created_at: new Date().toISOString(),
        deleted_at: null,
        anonymized: false,
      }
      await commit({ ...db, customers: [...db.customers, customer] }, () =>
        repoRef.current.insert('customers', customer),
      )
      notify(`Client « ${v.name} » créé`)
      return customer.id
    },
    [commit, db, notify],
  )

  const addPayment = useCallback(
    async (creditId: string, rawAmount: number, rawDate: string, rawNote?: string) => {
      const { amount, date, note } = parseOrThrow(
        creditPaymentInput,
        { amount: rawAmount, date: rawDate, note: rawNote },
        'Remboursement',
      )
      const credit = db.credits.find((c) => c.id === creditId)
      if (!credit) throw new Error('Crédit introuvable.')
      const rest = creditRest(credit)
      if (amount > rest + 0.001) {
        throw new Error(`Le remboursement dépasse le reste à payer (${Math.round(rest)} F).`)
      }
      const paid = credit.amount_paid + amount
      const status = computeCreditStatus({ ...credit, amount_paid: paid }, todayISO())
      const payment: CreditPayment = {
        id: uid('cpay'),
        credit_id: credit.id,
        shop_id: credit.shop_id,
        amount,
        payment_date: date,
        note: note?.trim() || null,
        created_at: new Date().toISOString(),
      }
      const next: DB = {
        ...db,
        credits: db.credits.map((c) =>
          c.id === creditId ? { ...c, amount_paid: paid, status } : c,
        ),
        credit_payments: [...db.credit_payments, payment],
      }
      await commit(
        next,
        async () => {
          const r = repoRef.current
          if (r.mode === 'supabase') {
            await rpcCall('record_credit_payment', {
              p_credit_id: creditId,
              p_payment_id: payment.id,
              p_amount: amount,
              p_payment_date: date,
              p_note: note?.trim() || null,
            })
            return
          }
          await r.insert('credit_payments', payment)
          await r.update('credits', creditId, { amount_paid: paid, status })
        },
        newAudit(credit.shop_id, 'remboursement', `crédit de ${credit.total_amount} F`, `${amount} F le ${date}${note ? ` · ${note}` : ''}`),
      )
      notify(`Remboursement de ${Math.round(amount)} F enregistré : reste ${Math.round(creditRest({ ...credit, amount_paid: paid }))} F`)
    },
    [commit, db, notify, newAudit],
  )

  const updateCredit = useCallback(
    async (id: string, patch: Partial<Credit>) => {
      const next = { ...db, credits: db.credits.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
      await commit(next, () => repoRef.current.update('credits', id, patch))
    },
    [commit, db],
  )

  const resetDemo = useCallback(async () => {
    const repo = repoRef.current
    if (repo.mode !== 'local') throw new Error('Réinitialisation disponible uniquement en mode hors ligne.')
    await (repo as LocalRepo).reset()
    const fresh = await repo.loadAll()
    setDb(activeOnly(fresh))
    notify('Données de démonstration réinitialisées')
  }, [notify, setDb])

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      mode: repoRef.current.mode,
      user,
      db,
      scope,
      role,
      setScope,
      signIn,
      signUp,
      resetPassword,
      logout,
      toasts,
      notify,
      dismissToast,
      addShop,
      renameShop,
      deleteShop,
      setTieredPricing,
      setTierMode,
      saveTier,
      deleteTier,
      copyTiers,
      bulkSetTiered,
      addItem,
      updateItem,
      deleteItem,
      deleteCustomer,
      restore,
      purge,
      recordSale,
      undoLastSale,
      cancelSaleById,
      addRestock,
      updateRestock,
      deleteRestock,
      addCustomer,
      addPayment,
      updateCredit,
      inviteMember,
      setMemberRole,
      removeMember,
      resetDemo,
    }),
    [
      ready, user, db, scope, role, setScope, signIn, signUp, resetPassword, logout, toasts, notify, dismissToast,
      addShop, renameShop, deleteShop, setTieredPricing, setTierMode, saveTier, deleteTier, copyTiers, bulkSetTiered, addItem, updateItem, deleteItem, deleteCustomer, restore, purge, recordSale, undoLastSale, cancelSaleById,
      addRestock, updateRestock, deleteRestock, addCustomer, addPayment, updateCredit,
      inviteMember, setMemberRole, removeMember, resetDemo,
    ],
  )

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore doit être utilisé dans StoreProvider')
  return ctx
}

/** Données filtrées par la boutique sélectionnée */
export function useScopedDB(): { db: DB; items: Item[]; sales: Sale[]; restocks: Restock[]; customers: DB['customers']; credits: Credit[]; payments: CreditPayment[] } {
  const { db, scope } = useStore()
  return useMemo(() => {
    const ok = <T extends { shop_id: string }>(rows: T[]) =>
      scope === 'all' ? rows : rows.filter((r) => r.shop_id === scope)
    return {
      db,
      items: ok(db.items.filter((i) => !i.deleted_at)),
      sales: ok(db.sales),
      restocks: ok(db.restocks),
      customers: ok(db.customers.filter((c) => !c.deleted_at)),
      credits: ok(db.credits),
      payments: ok(db.credit_payments),
    }
  }, [db, scope])
}

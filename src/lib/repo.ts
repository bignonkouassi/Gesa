import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DB, TableName } from './types'
import { TABLES } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseEnabled = Boolean(url && anonKey)

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!supabaseEnabled) return null
  if (!client) client = createClient(url as string, anonKey as string)
  return client
}

export interface AuthUser {
  id: string
  email: string
}

/* ------------------------------------------------------------------ */
/* Dépôt : couche de données interchangeable (locale ou Supabase)      */
/* ------------------------------------------------------------------ */

export interface Repo {
  mode: 'local' | 'supabase'
  loadAll(): Promise<DB>
  insert<K extends TableName>(table: K, row: DB[K][number]): Promise<void>
  update<K extends TableName>(table: K, id: string, patch: Partial<DB[K][number]>): Promise<void>
  remove<K extends TableName>(table: K, ids: string[]): Promise<void>
}

const STORAGE_KEY = 'ma-boutique-db-v1'
const USER_KEY = 'ma-boutique-user-v1'

function readLocal(): DB | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const db = JSON.parse(raw) as DB
    // Migration douce : les anciennes sauvegardes n'ont pas les dernières tables
    const base = emptyLike()
    for (const k of Object.keys(base) as (keyof DB)[]) {
      if (!Array.isArray(db[k])) (db as unknown as Record<string, unknown[]>)[k] = base[k]
    }
    return db
  } catch {
    return null
  }
}

function writeLocal(db: DB): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

export class LocalRepo implements Repo {
  mode = 'local' as const
  private db: DB | null = null

  async loadAll(): Promise<DB> {
    this.db = readLocal()
    if (!this.db) {
      const { createDemoDB } = await import('./seed')
      this.db = createDemoDB()
      writeLocal(this.db)
    }
    return structuredClone(this.db)
  }

  private ensure(): DB {
    if (!this.db) this.db = readLocal() ?? { ...emptyLike() }
    return this.db
  }

  async insert<K extends TableName>(table: K, row: DB[K][number]): Promise<void> {
    const db = this.ensure()
    ;(db as unknown as Record<string, unknown[]>)[table].push(row)
    writeLocal(db)
  }

  async update<K extends TableName>(table: K, id: string, patch: Partial<DB[K][number]>): Promise<void> {
    const db = this.ensure()
    const arr = (db as unknown as Record<string, { id: string }[]>)[table]
    const idx = arr.findIndex((r) => r.id === id)
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], ...patch }
      writeLocal(db)
    }
  }

  async remove<K extends TableName>(table: K, ids: string[]): Promise<void> {
    const db = this.ensure()
    const set = new Set(ids)
    const store = db as unknown as Record<string, { id: string }[]>
    const arr = store[table]
    const next = arr.filter((r) => !set.has(r.id))
    if (next.length !== arr.length) {
      store[table] = next
      writeLocal(db)
    }
  }

  async reset(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY)
    this.db = null
  }
}

function emptyLike(): DB {
  return {
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
  }
}

/* Tables dont la lecture Supabase passe par une RPC SQL : les grants de
   colonnes masquent les prix d'achat pour les vendeurs, select('*')
   échouerait (ou révélerait les coûts) sur ces tables. */
const READ_RPC: Partial<Record<TableName, string>> = {
  items: 'get_items',
  sales: 'get_sales',
  restocks: 'get_restocks',
}

/**
 * Appel RPC transactionnel : une seule requête SQL pour une opération
 * complète (vente, réappro, remboursement, annulation). Le serveur
 * reverrouille et revérifie tout (stock, rôles, montants) — les
 * messages d'erreur remontés sont déjà en français.
 */
export async function rpcCall(name: string, args: Record<string, unknown>): Promise<void> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase non configuré')
  const { error } = await sb.rpc(name, args)
  if (error) throw new Error(error.message)
}

export class SupabaseRepo implements Repo {
  mode = 'supabase' as const

  async loadAll(): Promise<DB> {
    const sb = getSupabase()
    if (!sb) throw new Error('Supabase non configuré')
    const result = {} as Record<string, unknown[]>
    await Promise.all(
      TABLES.map(async (t) => {
        // Les tables portant des prix d'achat sont lues via des fonctions
        // SQL security definer qui masquent les coûts pour un vendeur
        // (les grants de colonnes bloqueraient select('*')).
        const rpc = READ_RPC[t]
        const { data, error } = rpc
          ? await sb.rpc(rpc)
          : await sb.from(t).select('*')
        if (error) throw new Error(`Erreur Supabase (${t}) : ${error.message}`)
        result[t] = (data as unknown[]) ?? []
      }),
    )
    return result as unknown as DB
  }

  async insert<K extends TableName>(table: K, row: DB[K][number]): Promise<void> {
    const sb = getSupabase()
    if (!sb) throw new Error('Supabase non configuré')
    const { error } = await sb.from(table).insert(row as unknown as Record<string, unknown>)
    if (error) throw new Error(`Erreur Supabase (${table}) : ${error.message}`)
  }

  async update<K extends TableName>(table: K, id: string, patch: Partial<DB[K][number]>): Promise<void> {
    const sb = getSupabase()
    if (!sb) throw new Error('Supabase non configuré')
    const { error } = await sb
      .from(table)
      .update(patch as unknown as Record<string, unknown>)
      .eq('id', id)
    if (error) throw new Error(`Erreur Supabase (${table}) : ${error.message}`)
  }

  async remove<K extends TableName>(table: K, ids: string[]): Promise<void> {
    const sb = getSupabase()
    if (!sb) throw new Error('Supabase non configuré')
    const { error } = await sb.from(table).delete().in('id', ids)
    if (error) throw new Error(`Erreur Supabase (${table}) : ${error.message}`)
  }
}

/* ------------------------------------------------------------------ */
/* Session utilisateur                                                  */
/* ------------------------------------------------------------------ */

export async function signInLocal(): Promise<AuthUser> {
  const raw = localStorage.getItem(USER_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as AuthUser
    } catch {
      /* ignore */
    }
  }
  const user: AuthUser = { id: 'demo-user', email: 'demo@local' }
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  return user
}

export async function signInSupabase(email: string, password: string): Promise<AuthUser> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase non configuré')
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(translateAuthError(error.message))
  const u = data.user
  if (!u) throw new Error('Connexion impossible')
  return { id: u.id, email: u.email ?? email }
}

export async function signUpSupabase(email: string, password: string, fullName = ''): Promise<string> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase non configuré')
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName || undefined } },
  })
  if (error) throw new Error(translateAuthError(error.message))
  if (!data.session) return 'Un e-mail de confirmation vient d’être envoyé. Confirme-le puis connecte-toi.'
  return ''
}

export async function requestPasswordReset(email: string): Promise<string> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase non configuré')
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname}#/reinitialisation`,
  })
  if (error) throw new Error(translateAuthError(error.message))
  return 'Si un compte existe pour cet e-mail, un lien de réinitialisation vient d’être envoyé (valable quelques heures).'
}

export async function restoreSupabaseSession(): Promise<AuthUser | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  const u = data.session?.user
  return u ? { id: u.id, email: u.email ?? '' } : null
}

/** Changement de mot de passe : vérifie d'abord l'identité avec le mot de passe actuel. */
export async function changePasswordSupabase(currentPassword: string, newPassword: string): Promise<void> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase non configuré')
  const email = (await sb.auth.getUser()).data.user?.email
  if (!email) throw new Error('Session expirée. Reconnecte-toi.')
  const { error: loginErr } = await sb.auth.signInWithPassword({ email, password: currentPassword })
  if (loginErr) throw new Error('Mot de passe actuel incorrect.')
  const { error } = await sb.auth.updateUser({ password: newPassword })
  if (error) throw new Error(translateAuthError(error.message))
}

/** Suppression du compte : efface les données puis la session. */
export async function deleteAccountSupabase(): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  // Les données sont protégées par RLS : on les supprime ligne à ligne puis la session.
  const uid = (await sb.auth.getUser()).data.user?.id
  if (uid) {
    for (const table of ['credit_payments', 'credits', 'sales', 'restocks', 'stock_movements', 'items', 'customers', 'shops', 'audit_log'] as const) {
      await sb.from(table).delete().eq('user_id', uid).then(() => undefined)
    }
  }
  await sb.auth.signOut()
}

export async function signOut(): Promise<void> {
  if (supabaseEnabled) {
    const sb = getSupabase()
    await sb?.auth.signOut()
  }
  localStorage.removeItem(USER_KEY)
}

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return 'E-mail ou mot de passe incorrect.'
  if (m.includes('already registered')) return 'Cet e-mail est déjà inscrit.'
  if (m.includes('password')) return 'Mot de passe trop faible (8 caractères minimum).'
  if (m.includes('rate limit') || m.includes('too many')) return 'Trop de tentatives. Réessaie dans quelques instants.'
  return 'Opération impossible pour le moment. Réessaie plus tard.'
}

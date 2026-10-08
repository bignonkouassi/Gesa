import { useMemo, useState } from 'react'
import { useScopedDB, useStore } from '../state/store'
import type { Restock } from '../lib/types'
import { fcfa, formatDateShort } from '../lib/format'
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  SectionTitle,
  StatCard,
} from '../components/ui'
import { exportSalesExcel, exportStockPDF } from '../lib/exports'
import { ROLE_LABEL, canManageMembers, canRenameShop, canDeleteShop, canSeeFinances, canExport, roleOf } from '../lib/permissions'

export function Boutiques() {
  const {
    db,
    scope,
    mode,
    user,
    addShop,
    renameShop,
    deleteShop,
    inviteMember,
    setMemberRole,
    removeMember,
    deleteRestock,
    updateRestock,
    restore,
    notify,
    resetDemo,
    logout,
  } = useStore()
  const { items, restocks } = useScopedDB()

  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [editRestock, setEditRestock] = useState<Restock | null>(null)
  const [deleteRestockTarget, setDeleteRestockTarget] = useState<Restock | null>(null)

  const restockRows = useMemo(
    () => [...restocks].sort((a, b) => b.restock_date.localeCompare(a.restock_date)),
    [restocks],
  )
  const shopLabel =
    scope === 'all' ? 'Toutes les boutiques' : (db.shops.find((s) => s.id === scope)?.name ?? 'Boutique')

  const myRole = user ? roleOf(db, user.id, scope === 'all' ? (db.shops.find((s) => !s.deleted_at)?.id ?? '') : scope) : null
  const seeMoney = canSeeFinances(myRole)
  const [invite, setInvite] = useState<{ shopId: string; email: string; role: 'gerant' | 'vendeur' } | null>(null)

  // Suppressions douces des 30 derniers jours (restaurables)
  const trash = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000
    const rows: { key: string; id: string; kind: 'items' | 'shops' | 'customers'; label: string; type: string; date: string }[] = []
    const push = (kind: 'items' | 'shops' | 'customers', type: string, r: { id: string; name: string; deleted_at: string | null }) => {
      if (!r.deleted_at) return
      const ts = Date.parse(r.deleted_at)
      if (Number.isNaN(ts) || ts < cutoff) return
      rows.push({ key: `${kind}-${r.id}`, id: r.id, kind, label: r.name, type, date: r.deleted_at.slice(0, 10) })
    }
    db.items.forEach((i) => push('items', 'Article', i))
    db.shops.forEach((s) => push('shops', 'Boutique', s))
    db.customers.forEach((c) => push('customers', 'Client', c))
    return rows
  }, [db])

  return (
    <div className="space-y-6">
      {/* Boutiques */}
      <section>
        <SectionTitle>Mes boutiques</SectionTitle>
        <div className="space-y-3">
          {db.shops.filter((s) => !s.deleted_at).map((s) => (
            <Card key={s.id} className={scope === s.id ? 'border-emerald-300' : ''}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{s.name}</p>
                  <p className="text-xs text-slate-500">
                    {db.items.filter((i) => i.shop_id === s.id && !i.deleted_at).length} article(s) ·{' '}
                    {db.sales.filter((x) => x.shop_id === s.id).length} vente(s)
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {canRenameShop(roleOf(db, user?.id ?? '', s.id)) && (
                    <Button variant="secondary" onClick={() => setRenaming({ id: s.id, name: s.name })}>
                      Renommer
                    </Button>
                  )}
                  {canDeleteShop(roleOf(db, user?.id ?? '', s.id)) && (
                    <Button variant="ghost" onClick={() => setDeleting({ id: s.id, name: s.name })}>
                      Supprimer
                    </Button>
                  )}
                  {canManageMembers(roleOf(db, user?.id ?? '', s.id)) && (
                    <Button
                      variant="secondary"
                      onClick={() => setInvite({ shopId: s.id, email: '', role: 'vendeur' })}
                    >
                      Employés
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="mt-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nom de la nouvelle boutique (ex. Boutique Épicerie)"
            />
            <Button
              onClick={() => {
                void addShop(newName)
                  .then(() => setNewName(''))
                  .catch((e: Error) => notify(e.message, 'error'))
              }}
            >
              Créer
            </Button>
          </div>
        </Card>
      </section>

      {/* Équipe (rôles par boutique) */}
      <section>
        <SectionTitle>Équipe — {shopLabel}</SectionTitle>
        <Card>
          {scope === 'all' ? (
            <p className="text-sm text-slate-500">
              Sélectionne une boutique pour gérer son accès (propriétaire uniquement).
            </p>
          ) : !canManageMembers(myRole) && myRole !== null ? (
            <p className="text-sm text-slate-500">
              Ton rôle : <b>{ROLE_LABEL[myRole]}</b>. Seul le propriétaire peut gérer les employés.
            </p>
          ) : myRole === null ? (
            <p className="text-sm text-slate-500">Aucun accès à cette boutique.</p>
          ) : (
            <div className="space-y-3">
              <ul className="divide-y divide-slate-100">
                {db.shop_members
                  .filter((m) => m.shop_id === scope)
                  .map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{m.email}</p>
                        <p className="text-xs text-slate-400">Invité le {formatDateShort(m.created_at.slice(0, 10))}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700"
                          value={m.role}
                          disabled={m.role === 'proprietaire'}
                          onChange={(e) => {
                            const r = e.target.value
                            if (r === 'gerant' || r === 'vendeur') void setMemberRole(m.id, r)
                          }}
                        >
                          <option value="proprietaire">Propriétaire</option>
                          <option value="gerant">Gérant</option>
                          <option value="vendeur">Vendeur</option>
                        </select>
                        {m.role !== 'proprietaire' && (
                          <Button variant="ghost" onClick={() => void removeMember(m.id)}>
                            Retirer
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
              <p className="text-xs text-slate-400">
                Le vendeur saisit les ventes et voit le stock, mais jamais les prix d’achat ni les bénéfices.
                En production, ces droits sont aussi appliqués en base (RLS).
              </p>
              <Button onClick={() => setInvite({ shopId: scope, email: '', role: 'vendeur' })}>
                Inviter un employé
              </Button>
            </div>
          )}
        </Card>
      </section>

      {/* Réapprovisionnements */}
      <section>
        <SectionTitle>Réapprovisionnements — {shopLabel}</SectionTitle>
        <Card className="p-0">
          {restockRows.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">
              Aucun réapprovisionnement enregistré. Utilise le bouton « Réapprovisionner » d’un article.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {restockRows.map((r) => {
                const item = items.find((i) => i.id === r.item_id) ?? db.items.find((i) => i.id === r.item_id)
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700">
                        {item?.name ?? 'Article supprimé'} ·{' '}
                        <b>+{r.quantity}</b>{seeMoney ? ` à ${fcfa(r.unit_cost)}` : ''}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDateShort(r.restock_date)}
                        {r.supplier ? ` · ${r.supplier}` : ''}
                        {seeMoney ? ` · Total ${fcfa(r.quantity * r.unit_cost)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {seeMoney && (
                        <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setEditRestock(r)}>
                          Corriger
                        </Button>
                      )}
                      {seeMoney && (
                        <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => setDeleteRestockTarget(r)}>
                          Supprimer
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        <p className="mt-2 text-xs text-slate-500">
          Corriger ou supprimer un réappro recalculle automatiquement le stock et le coût moyen de l’article concerné,
          sans impacter les autres articles.
        </p>
      </section>

      {/* Exports */}
      {canExport(myRole) && (
      <section>
        <SectionTitle>Exporter — {shopLabel}</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              try {
                exportSalesExcel(
                  scope === 'all' ? db.sales : db.sales.filter((s) => s.shop_id === scope),
                  scope === 'all' ? db.credits : db.credits.filter((c) => c.shop_id === scope),
                  items,
                  db,
                )
                notify('Fichier Excel téléchargé')
              } catch (e) {
                notify(e instanceof Error ? e.message : 'Export impossible', 'error')
              }
            }}
          >
            Ventes + crédits + stock → Excel
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              try {
                exportStockPDF(items, db, shopLabel)
                notify('Fiche stock PDF téléchargée')
              } catch (e) {
                notify(e instanceof Error ? e.message : 'Export impossible', 'error')
              }
            }}
          >
            Fiche stock → PDF
          </Button>
        </div>
      </section>
      )}

      {/* Corbeille : suppressions douces restaurables */}
      <section>
        <SectionTitle>Corbeille (30 jours)</SectionTitle>
        {trash.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-500">
              Aucun élément supprimé. Une suppression reste annulable pendant 30 jours : rien n’est effacé
              définitivement, l’historique des ventes est toujours conservé.
            </p>
          </Card>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-slate-100">
              {trash.map((t) => (
                <li key={t.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-700">{t.label}</span>
                    <span className="text-xs text-slate-500">
                      {t.type} · supprimé le {t.date}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    className="shrink-0 px-3 py-1.5 text-xs"
                    onClick={() => void restore(t.kind, t.id)}
                  >
                    Restaurer
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Données / compte */}
      <section>
        <SectionTitle>Données et compte</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Mode de données" value={mode === 'supabase' ? 'Supabase' : 'Hors ligne'} sub={mode === 'supabase' ? 'Synchronisé' : 'Stocké dans ce navigateur'} />
          <StatCard label="Compte" value={user?.email ?? '—'} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {mode === 'local' && (
            <Button
              variant="secondary"
              onClick={() => {
                void resetDemo().catch((e: Error) => notify(e.message, 'error'))
              }}
            >
              Réinitialiser les données de démo
            </Button>
          )}
          <Button variant="ghost" onClick={() => void logout()}>
            Se déconnecter
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          En mode hors ligne, les données sont gardées dans ce navigateur. Ajoute les clés Supabase dans le fichier
          <code className="mx-1 rounded bg-slate-100 px-1">.env</code> puis relance l’app pour activer la
          synchronisation multi-appareils avec connexion et sécurité (RLS).
        </p>
      </section>

      {/* Invitation d'un employé */}
      <Modal open={invite !== null} title="Inviter un employé" onClose={() => setInvite(null)}>
        {invite && (
          <div className="space-y-3">
            <Field label="E-mail de l'employé">
              <Input
                type="email"
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                placeholder="employe@exemple.com"
              />
            </Field>
            <Field label="Rôle" hint="Vendeur : ventes et stock seulement. Gérant : aussi crédits et stock.">
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                value={invite.role}
                onChange={(e) => {
                  const r = e.target.value
                  if (r === 'gerant' || r === 'vendeur') setInvite({ ...invite, role: r })
                }}
              >
                <option value="vendeur">Vendeur</option>
                <option value="gerant">Gérant</option>
              </select>
            </Field>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => {
                  void inviteMember(invite.shopId, invite.email, invite.role)
                    .then(() => setInvite(null))
                    .catch((e: Error) => notify(e.message, 'error'))
                }}
              >
                Envoyer l'invitation
              </Button>
              <Button variant="secondary" onClick={() => setInvite(null)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modales */}
      <Modal open={renaming !== null} title="Renommer la boutique" onClose={() => setRenaming(null)}>
        <div className="space-y-3">
          <Field label="Nouveau nom">
            <Input
              value={renaming?.name ?? ''}
              onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                if (!renaming) return
                void renameShop(renaming.id, renaming.name)
                  .then(() => setRenaming(null))
                  .catch((e: Error) => notify(e.message, 'error'))
              }}
            >
              Enregistrer
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setRenaming(null)}>
              Annuler
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Supprimer cette boutique ?"
        message={`La boutique « ${deleting?.name ?? ''} » et toutes ses données (articles, ventes, crédits) seront supprimées définitivement.`}
        onConfirm={() => {
          if (deleting) void deleteShop(deleting.id)
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />

      <RestockEditModal
        restock={editRestock}
        onClose={() => setEditRestock(null)}
        onSubmit={async (patch) => {
          if (!editRestock) return
          await updateRestock(editRestock.id, patch)
          setEditRestock(null)
        }}
      />

      <ConfirmDialog
        open={deleteRestockTarget !== null}
        title="Supprimer ce réappro ?"
        message="Le stock et le coût moyen de l’article seront recalculés sans lui."
        confirmLabel="Supprimer"
        onConfirm={() => {
          if (deleteRestockTarget) void deleteRestock(deleteRestockTarget.id)
          setDeleteRestockTarget(null)
        }}
        onCancel={() => setDeleteRestockTarget(null)}
      />
    </div>
  )
}

function RestockEditModal({
  restock,
  onClose,
  onSubmit,
}: {
  restock: Restock | null
  onClose: () => void
  onSubmit: (patch: Partial<Restock>) => Promise<void>
}) {
  const { notify } = useStore()
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [date, setDate] = useState('')
  const [supplier, setSupplier] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Préremplit à l'ouverture
  if (restock && loadedFor !== restock.id) {
    setLoadedFor(restock.id)
    setQty(String(restock.quantity))
    setUnitCost(String(restock.unit_cost))
    setDate(restock.restock_date)
    setSupplier(restock.supplier ?? '')
  }

  const close = () => {
    setLoadedFor(null)
    onClose()
  }

  const submit = async () => {
    setBusy(true)
    try {
      await onSubmit({
        quantity: Math.floor(Number(qty)),
        unit_cost: Number(unitCost),
        restock_date: date,
        supplier: supplier.trim() || null,
      })
      notify('Réappro corrigé et stock recalculé.')
      close()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={restock !== null} title="Corriger un réapprovisionnement" onClose={close}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantité">
            <Input type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Prix d’achat unitaire">
            <Input type="number" inputMode="numeric" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Fournisseur">
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={submit}>
            Enregistrer
          </Button>
          <Button variant="secondary" className="flex-1" onClick={close}>
            Annuler
          </Button>
        </div>
      </div>
    </Modal>
  )
}

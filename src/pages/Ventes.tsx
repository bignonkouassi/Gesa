import { useMemo, useState } from 'react'
import { useScopedDB, useStore } from '../state/store'
import type { Item, PaymentType } from '../lib/types'
import { stockStatus } from '../lib/calc'
import { parseOrThrow, priceUpdate } from '../lib/validation'
import { canSeeFinances, canManageStock } from '../lib/permissions'
import { fcfa, num, todayISO } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  SectionTitle,
  Segmented,
  Select,
} from '../components/ui'

const STATUS_BADGE = {
  normal: 'bg-emerald-100 text-emerald-700',
  bas: 'bg-orange-100 text-orange-700',
  rupture: 'bg-red-100 text-red-700',
} as const

const STATUS_LABEL = {
  normal: 'En stock',
  bas: 'Stock bas',
  rupture: 'Rupture',
} as const

export function Ventes() {
  const { db, scope, recordSale, undoLastSale, addItem, updateItem, deleteItem, addCustomer, addRestock, notify } =
    useStore()
  const { items, customers, sales } = useScopedDB()
  const [query, setQuery] = useState('')
  const [saleDate, setSaleDate] = useState(todayISO())
  const [showAdd, setShowAdd] = useState(false)
  const [toDelete, setToDelete] = useState<Item | null>(null)
  const [restockItem, setRestockItem] = useState<Item | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items
    return [...rows].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [items, query])

  const shopId = scope === 'all' ? (items[0]?.shop_id ?? (db.shops[0]?.id ?? '')) : scope
  const scopedCustomers = customers.length > 0 ? customers : db.customers.filter((c) => c.shop_id === shopId)
  const lastSales = [...sales].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)

  const handleUndo = async () => {
    const done = await undoLastSale()
    if (!done) notify('Aucune vente à annuler.', 'warn')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Date des ventes</span>
          <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="w-40" />
        </label>
        <Button variant="secondary" onClick={handleUndo}>
          ↺ Annuler la dernière vente
        </Button>
        <Button className="ml-auto" onClick={() => setShowAdd(true)}>
          + Ajouter un article
        </Button>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="🔍 Rechercher un article…"
        aria-label="Rechercher un article"
      />

      {items.length === 0 ? (
        <Card className="text-center">
          <p className="text-sm font-semibold text-slate-700">Aucun article pour l’instant</p>
          <p className="mt-1 text-xs text-slate-500">
            Crée ta première boutique puis ajoute tes articles (nom, prix d’achat, prix de vente, stock).
          </p>
          <div className="mt-3">
            <Button onClick={() => setShowAdd(true)}>Ajouter un article</Button>
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">Aucun article ne correspond à « {query} ».</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <ArticleCard
              key={item.id}
              item={item}
              date={saleDate}
              customers={scopedCustomers}
              onSale={recordSale}
              onPrice={(price) => updateItem(item.id, { price })}
              onRestock={() => setRestockItem(item)}
              onDelete={() => setToDelete(item)}
              onNewCustomer={(name, phone) => addCustomer(item.shop_id, name, phone)}
            />
          ))}
        </div>
      )}

      <section>
        <SectionTitle>Dernières ventes</SectionTitle>
        <Card className="p-0">
          {lastSales.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Pas encore de vente enregistrée.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lastSales.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-slate-700">
                    {s.quantity} × {s.item_name}
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    <span className="block font-semibold text-slate-800">{fcfa(s.unit_price * s.quantity)}</span>
                    <span className={s.payment_type === 'crédit' ? 'text-orange-600' : 'text-emerald-600'}>
                      {s.payment_type} · {s.sale_date.slice(8)}/{s.sale_date.slice(5, 7)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <AddItemModal
        open={showAdd}
        shopId={shopId}
        onClose={() => setShowAdd(false)}
        onSubmit={async (input) => {
          await addItem(input)
          setShowAdd(false)
        }}
      />

      <RestockModal
        item={restockItem}
        onClose={() => setRestockItem(null)}
        onSubmit={async (input) => {
          const warning = await addRestock(input)
          setRestockItem(null)
          if (warning) notify(warning, 'warn')
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="Retirer cet article ?"
        message={`« ${toDelete?.name} » sera retiré de la liste. Son historique de ventes est conservé.`}
        onConfirm={() => {
          if (toDelete) void deleteItem(toDelete.id)
          setToDelete(null)
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Carte article : vente du jour, prix, réappro, suppression            */
/* ------------------------------------------------------------------ */

function ArticleCard({
  item,
  date,
  customers,
  onSale,
  onPrice,
  onRestock,
  onDelete,
  onNewCustomer,
}: {
  item: Item
  date: string
  customers: DB_Customer[]
  onSale: (input: {
    itemId: string
    quantity: number
    payment: PaymentType
    customerId?: string
    deposit?: number
    dueDate?: string | null
    date: string
  }) => Promise<void>
  onPrice: (price: number) => Promise<void>
  onRestock: () => void
  onDelete: () => void
  onNewCustomer: (name: string, phone: string) => Promise<string>
}) {
  const { notify, role } = useStore()
  const seeMoney = canSeeFinances(role)
  const [qty, setQty] = useState('1')
  const [payment, setPayment] = useState<PaymentType>('comptant')
  const [customerId, setCustomerId] = useState('')
  const [deposit, setDeposit] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingPrice, setEditingPrice] = useState(false)
  const [priceDraft, setPriceDraft] = useState(String(item.price))
  const [showNewCustomer, setShowNewCustomer] = useState(false)

  const status = stockStatus(item)
  const margin = item.price - item.cost_price
  const marginPct = item.cost_price > 0 ? (margin / item.cost_price) * 100 : 0
  const loss = item.price <= item.cost_price

  const submit = async () => {
    setBusy(true)
    try {
      await onSale({
        itemId: item.id,
        quantity: Number(qty),
        payment,
        customerId: payment === 'crédit' ? customerId || undefined : undefined,
        deposit: payment === 'crédit' ? Number(deposit || 0) : 0,
        dueDate: payment === 'crédit' ? dueDate || null : null,
        date,
      })
      setQty('1')
      setDeposit('')
      setDueDate('')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur lors de la vente', 'error')
    } finally {
      setBusy(false)
    }
  }

  const savePrice = async () => {
    try {
      const { price } = parseOrThrow(priceUpdate, { price: Number(priceDraft) }, 'Prix de vente')
      await onPrice(price)
      setEditingPrice(false)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Prix invalide', 'error')
    }
  }

  return (
    <Card className={status === 'rupture' ? 'border-red-200' : status === 'bas' ? 'border-orange-200' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800">{item.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <Badge className={STATUS_BADGE[status]}>{STATUS_LABEL[status]}</Badge>
            <span>Stock : <b className="text-slate-700">{num(item.stock)}</b></span>
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-slate-500">
          {editingPrice ? (
            <div className="flex items-center justify-end gap-1">
              <Input
                type="number"
                inputMode="numeric"
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                className="w-24 py-1 text-right"
                autoFocus
              />
              <Button className="px-2 py-1" onClick={savePrice}>
                OK
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => setEditingPrice(true)} className="group text-right">
              <span className="block text-sm font-bold text-slate-800 group-hover:text-emerald-700">
                {fcfa(item.price)} ✎
              </span>
              <span className="block">{seeMoney ? `Achat : ${fcfa(item.cost_price)}` : ' '}</span>
              {seeMoney && (
                <span className={`block font-semibold ${loss ? 'text-red-600' : 'text-emerald-600'}`}>
                  Marge : {fcfa(margin)} ({Math.round(marginPct)} %)
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {loss && seeMoney && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          ⚠️ Vente à perte : le prix de vente ({fcfa(item.price)}) est inférieur ou égal au prix d’achat (
          {fcfa(item.cost_price)}).
        </p>
      )}

      {/* Saisie de la vente du jour */}
      <div className="mt-3 rounded-2xl bg-slate-50 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Ventes du jour</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-24"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Paiement</span>
            <Segmented
              value={payment}
              onChange={setPayment}
              options={[
                { value: 'comptant', label: 'Comptant' },
                { value: 'crédit', label: 'Crédit' },
              ]}
            />
          </div>
          <Button
            className="ml-auto"
            disabled={busy || status === 'rupture'}
            onClick={submit}
          >
            Valider
          </Button>
        </div>

        {payment === 'crédit' && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Field label="Client">
                  <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">— Choisir un client —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button variant="secondary" onClick={() => setShowNewCustomer(true)}>
                + Nouveau
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Acompte (F)">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="0"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                />
              </Field>
              <Field label="Échéance">
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {canManageStock(role) && (
          <Button variant="secondary" onClick={onRestock}>
            Réapprovisionner
          </Button>
        )}
        {canManageStock(role) && (
          <Button variant="ghost" onClick={onDelete}>
            Retirer
          </Button>
        )}
      </div>

      <NewCustomerModal
        open={showNewCustomer}
        onClose={() => setShowNewCustomer(false)}
        onSubmit={async (name, phone) => {
          const id = await onNewCustomer(name, phone)
          setCustomerId(id)
          setShowNewCustomer(false)
          return id
        }}
      />
    </Card>
  )
}

type DB_Customer = { id: string; name: string; phone: string; shop_id: string }

/* ------------------------------------------------------------------ */
/* Modales                                                             */
/* ------------------------------------------------------------------ */

function AddItemModal({
  open,
  shopId,
  onClose,
  onSubmit,
}: {
  open: boolean
  shopId: string
  onClose: () => void
  onSubmit: (input: { shopId: string; name: string; cost: number; price: number; stock: number }) => Promise<void>
}) {
  const { notify } = useStore()
  const [name, setName] = useState('')
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('0')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setName('')
    setCost('')
    setPrice('')
    setStock('0')
  }

  const submit = async () => {
    setBusy(true)
    try {
      await onSubmit({
        shopId,
        name,
        cost: Number(cost || 0),
        price: Number(price || 0),
        stock: Number(stock || 0),
      })
      reset()
      onClose()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Ajouter un article" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nom de l’article">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Eau minérale 1,5 L" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prix d’achat (gros)">
            <Input type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Prix de vente">
            <Input type="number" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
          </Field>
        </div>
        <Field label="Stock de départ">
          <Input type="number" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button className="flex-1" onClick={submit} disabled={busy}>
            Ajouter
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function RestockModal({
  item,
  onClose,
  onSubmit,
}: {
  item: Item | null
  onClose: () => void
  onSubmit: (input: { itemId: string; quantity: number; unitCost: number; date: string; supplier?: string }) => Promise<void>
}) {
  const { notify } = useStore()
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [date, setDate] = useState(todayISO())
  const [supplier, setSupplier] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    setQty('')
    setUnitCost('')
    setSupplier('')
    setDate(todayISO())
    onClose()
  }

  const submit = async () => {
    if (!item) return
    setBusy(true)
    try {
      await onSubmit({
        itemId: item.id,
        quantity: Number(qty),
        unitCost: Number(unitCost),
        date,
        supplier,
      })
      close()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={item !== null} title={`Réapprovisionner — ${item?.name ?? ''}`} onClose={close}>
      <div className="space-y-3">
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Stock actuel : <b>{item?.stock ?? 0}</b> · Coût moyen actuel : <b>{fcfa(item?.cost_price ?? 0)}</b>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantité achetée">
            <Input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Prix d’achat unitaire">
            <Input type="number" inputMode="numeric" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Fournisseur (optionnel)">
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ex. Grossiste du marché" />
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          Le prix d’achat moyen est recalculé par coût moyen pondéré. Cette dépense n’est pas déduite du bénéfice : seuls
          les articles vendus le sont.
        </p>
        <div className="flex gap-2 pt-1">
          <Button className="flex-1" onClick={submit} disabled={busy}>
            Enregistrer le réappro
          </Button>
          <Button variant="secondary" className="flex-1" onClick={close}>
            Annuler
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function NewCustomerModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (name: string, phone: string) => Promise<string>
}) {
  const { notify } = useStore()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await onSubmit(name.trim(), phone.trim())
      setName('')
      setPhone('')
      onClose()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Nouveau client" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nom du client">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Aminata Diallo" />
        </Field>
        <Field label="Téléphone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex. +225 07 00 00 00 00" />
        </Field>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={busy}>
            Créer le client
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </div>
    </Modal>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useScopedDB, useStore } from '../state/store'
import type { Item, PaymentType } from '../lib/types'
import { stockStatus } from '../lib/calc'
import { parseOrThrow, priceUpdate } from '../lib/validation'
import { canSeeFinances, canManageStock, atLeast } from '../lib/permissions'
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
import { PencilIcon, SearchIcon, WarningIcon } from '../components/icons'
import { TierEditor, TierHint } from '../components/TierEditor'
import { isTiered, pctToPrice, priceToPct, readShopTierDefault, tiersOf } from '../lib/tiers'
import { takeSalePrefill } from '../lib/salePrefill'

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
  const { db, scope, role, recordSale, undoLastSale, addItem, updateItem, deleteItem, addCustomer, addRestock, notify, addShop, setScope } =
    useStore()
  const { items, customers, sales } = useScopedDB()
  const [query, setQuery] = useState('')
  const [saleDate, setSaleDate] = useState(todayISO())
  const [showAdd, setShowAdd] = useState(false)
  const [toDelete, setToDelete] = useState<Item | null>(null)
  const [restockItem, setRestockItem] = useState<Item | null>(null)
  const [shopName, setShopName] = useState('')
  const [shopBusy, setShopBusy] = useState(false)
  const [grosOnly, setGrosOnly] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [prefill, setPrefill] = useState<{ itemId: string; qty: number } | null>(null)

  // Ressaisie après correction : formulaire prérempli (article, quantité, date)
  useEffect(() => {
    const p = takeSalePrefill()
    if (!p) return
    setSaleDate(p.sale_date)
    setPrefill({ itemId: p.item_id, qty: p.quantity })
    window.setTimeout(() => {
      document.getElementById(`vente-${p.item_id}`)?.scrollIntoView({ block: 'center' })
    }, 150)
  }, [])

  const activeShops = useMemo(() => db.shops.filter((s) => !s.deleted_at), [db.shops])
  const anyTiered = useMemo(
    () => items.some((i) => isTiered(i)),
    [items],
  )

  /* Première visite : d'abord une boutique, sinon aucun article n'a de sens */
  const createFirstShop = async () => {
    if (!shopName.trim()) {
      notify('Donne un nom à ta boutique pour commencer.', 'error')
      return
    }
    setShopBusy(true)
    try {
      const id = await addShop(shopName.trim())
      setScope(id)
      setShopName('')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Création impossible.', 'error')
    } finally {
      setShopBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = items.filter(
      (i) =>
        (!q || i.name.toLowerCase().includes(q)) &&
        (!grosOnly || isTiered(i)),
    )
    return [...rows].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [items, query, grosOnly])

  /* La boutique de création n'est jamais devinée : scope précis = verrouillé,
     « Toutes les boutiques » = choix explicite dans la modale. */
  const shopId = scope === 'all' ? '' : scope
  const scopedCustomers = customers.length > 0 ? customers : db.customers.filter((c) => c.shop_id === shopId)
  const lastSales = [...sales].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)

  if (activeShops.length === 0) {
    return (
      <div className="space-y-4">
        <Card className="text-center">
          <p className="text-sm font-bold text-slate-800">Crée d’abord ta boutique</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
            Chaque article appartient à une boutique précise : c’est ce qui évite de mélanger les ventes. Commence
            par créer ta première boutique.
          </p>
          <div className="mx-auto mt-4 grid max-w-sm gap-3 text-left">
            <Field label="Nom de ta première boutique">
              <Input
                type="text"
                maxLength={60}
                placeholder="Ex. Boutique Épicerie"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createFirstShop()
                }}
              />
            </Field>
            <Button disabled={shopBusy || !shopName.trim()} onClick={() => void createFirstShop()}>
              {shopBusy ? 'Création…' : 'Créer ma boutique'}
            </Button>
          </div>
        </Card>
      </div>
    )
  }

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
        {canManageStock(role) && items.length > 0 && (
          <Button variant="ghost" onClick={() => setBulkOpen(true)}>
            Prix de gros (lot)
          </Button>
        )}
        <Button className="ml-auto" onClick={() => setShowAdd(true)}>
          + Ajouter un article
        </Button>
      </div>

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <SearchIcon />
        </span>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un article…"
          aria-label="Rechercher un article"
          className="pl-9"
        />
      </div>
      {anyTiered && (
        <div className="flex justify-end">
          <Segmented
            value={grosOnly ? 'gros' : 'tous'}
            onChange={(v) => setGrosOnly(v === 'gros')}
            size="sm"
            options={[
              { value: 'tous', label: 'Tous' },
              { value: 'gros', label: 'Avec prix de gros' },
            ]}
          />
        </div>
      )}

      {items.length === 0 ? (
        <Card className="text-center">
          <p className="text-sm font-semibold text-slate-700">Aucun article pour l’instant</p>
          <p className="mt-1 text-xs text-slate-500">
            Ajoute tes articles dans leur boutique : nom, prix d’achat, prix de vente, stock.
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
              shopName={scope === 'all' ? (db.shops.find((s) => s.id === item.shop_id)?.name ?? null) : null}
              prefillQty={prefill?.itemId === item.id ? prefill.qty : null}
              onPrefillConsumed={() => setPrefill(null)}
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
        shops={activeShops}
        locked={scope !== 'all'}
        onClose={() => setShowAdd(false)}
        onSubmit={async (input) => {
          await addItem(input)
          setShowAdd(false)
        }}
      />

      <BulkTierModal open={bulkOpen} onClose={() => setBulkOpen(false)} />

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
  shopName,
  prefillQty,
  onPrefillConsumed,
  onSale,
  onPrice,
  onRestock,
  onDelete,
  onNewCustomer,
}: {
  item: Item
  date: string
  customers: DB_Customer[]
  /** Boutique affichée en badge (vue « Toutes les boutiques »), sinon null */
  shopName: string | null
  /** Ressaisie après correction : quantité préremplie (consommation unique) */
  prefillQty: number | null
  onPrefillConsumed: () => void
  onSale: (input: {
    itemId: string
    quantity: number
    payment: PaymentType
    customerId?: string
    deposit?: number
    dueDate?: string | null
    date: string
    overridePrice?: number
    overrideNote?: string
    saleMode?: 'cumul_jour' | 'un_client'
  }) => Promise<void>
  onPrice: (price: number) => Promise<void>
  onRestock: () => void
  onDelete: () => void
  onNewCustomer: (name: string, phone: string) => Promise<string>
}) {
  const { db, notify, role } = useStore()
  const seeMoney = canSeeFinances(role)
  const canEditTiers = canManageStock(role)
  const canOverride = atLeast(role, 'gerant')
  const [qty, setQty] = useState('1')
  const [payment, setPayment] = useState<PaymentType>('comptant')
  const [customerId, setCustomerId] = useState('')
  const [deposit, setDeposit] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [tierOpen, setTierOpen] = useState(false)
  const [saleMode, setSaleMode] = useState<'cumul_jour' | 'un_client'>('cumul_jour')
  const [ovOn, setOvOn] = useState(false)
  const [ovPrice, setOvPrice] = useState('')
  const [ovNote, setOvNote] = useState('')
  const [editingPrice, setEditingPrice] = useState(false)
  const [priceDraft, setPriceDraft] = useState(String(item.price))
  const [showNewCustomer, setShowNewCustomer] = useState(false)

  // Ressaisie après correction : quantité préremplie une seule fois
  useEffect(() => {
    if (prefillQty !== null) {
      setQty(String(prefillQty))
      onPrefillConsumed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillQty])

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
        overridePrice: ovOn ? Math.round(Number(ovPrice)) : undefined,
        overrideNote: ovOn ? ovNote.trim() || undefined : undefined,
        saleMode: tiered ? saleMode : undefined,
      })
      setQty('1')
      setDeposit('')
      setDueDate('')
      setSaleMode('cumul_jour')
      setOvOn(false)
      setOvPrice('')
      setOvNote('')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur lors de la vente', 'error')
    } finally {
      setBusy(false)
    }
  }

  const tiered = isTiered(item)
  const itemTiers = tiersOf(db.price_tiers, item.id)
  const firstTier = itemTiers[0]

  const savePrice = async () => {
    try {
      const { price } = parseOrThrow(priceUpdate, { price: Number(priceDraft) }, 'Prix de vente')
      await onPrice(price)
      setEditingPrice(false)
      if (price !== item.price && tiersOf(db.price_tiers, item.id).length > 0) {
        notify('Prix normal modifié : vérifie tes paliers de gros.', 'warn')
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Prix invalide', 'error')
    }
  }

  return (
    <Card className={status === 'rupture' ? 'border-red-200' : status === 'bas' ? 'border-orange-200' : ''}>
      <div id={`vente-${item.id}`} className="scroll-mt-32">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800">{item.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <Badge className={STATUS_BADGE[status]}>{STATUS_LABEL[status]}</Badge>
            {shopName ? <Badge className="bg-slate-100 text-slate-600">{shopName}</Badge> : null}
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
              <span className="flex items-center justify-end gap-1 text-sm font-bold text-slate-800 group-hover:text-emerald-700">
                {fcfa(item.price)} <PencilIcon size={13} className="text-slate-400" />
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
        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          <WarningIcon size={15} className="mt-px shrink-0" />
          <span>
            Vente à perte : le prix de vente ({fcfa(item.price)}) est inférieur ou égal au prix d’achat (
            {fcfa(item.cost_price)}).
          </span>
        </p>
      )}

      {/* Prix par quantité : replié par défaut, badges seulement si actif */}
      {(tiered || canEditTiers) && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setTierOpen((v) => !v)}
            className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-700"
          >
            <span>{tierOpen ? 'Masquer le prix de gros' : 'Prix de gros'}</span>
            {tiered && firstTier && (
              <Badge className="bg-emerald-100 text-emerald-700">dès {firstTier.min_quantity} : {fcfa(firstTier.unit_price)}</Badge>
            )}
            {!tiered && <Badge className="bg-slate-100 text-slate-500">désactivé</Badge>}
          </button>
          {tierOpen && <TierEditor itemId={item.id} />}
        </div>
      )}

      {/* Saisie de la vente rapide : une vente par client, enchaînable */}
      <div className="mt-3 rounded-2xl bg-slate-50 p-3">
        {tiered && (
          <div className="mb-3">
            <Segmented
              value={saleMode}
              onChange={(m) => {
                setSaleMode(m)
                // Un cumul n'a pas de client unique : retour au comptant
                if (m === 'cumul_jour') setPayment('comptant')
              }}
              options={[
                { value: 'cumul_jour', label: 'Cumul de la journée' },
                { value: 'un_client', label: 'Un seul client' },
              ]}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              {saleMode === 'cumul_jour'
                ? 'Plusieurs clients, prix normal sur chaque unité.'
                : 'Un client a acheté cette quantité d’un coup, le prix de gros s’applique.'}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Quantité (vente rapide)</span>
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
            {tiered && saleMode === 'cumul_jour' ? (
              <p className="rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-slate-700">
                Comptant <span className="block text-[11px] font-normal text-slate-400">Le crédit exige « Un seul client ».</span>
              </p>
            ) : (
              <Segmented
                value={payment}
                onChange={setPayment}
                options={[
                  { value: 'comptant', label: 'Comptant' },
                  { value: 'crédit', label: 'Crédit' },
                ]}
              />
            )}
          </div>
          <Button
            className="ml-auto"
            disabled={busy || status === 'rupture'}
            onClick={submit}
          >
            Valider
          </Button>
        </div>

        {/* Aperçu du palier (le serveur recalcule et fait foi) */}
        <TierHint
          normalPrice={item.price}
          itemId={item.id}
          quantity={Math.max(1, Math.floor(Number(qty) || 1))}
          singleClient={saleMode === 'un_client'}
          onSwitchToSingle={() => {
            setSaleMode('un_client')
          }}
        />

        {/* Prix modifié à la main : gérant+, note obligatoire */}
        {canOverride && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setOvOn((v) => !v)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline"
            >
              {ovOn ? 'Masquer le prix modifié' : 'Modifier le prix manuellement'}
            </button>
            {ovOn && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="Prix unitaire appliqué (F)">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder={String(item.price)}
                    value={ovPrice}
                    onChange={(e) => setOvPrice(e.target.value)}
                  />
                </Field>
                <Field label="Motif (obligatoire)">
                  <Input
                    type="text"
                    maxLength={200}
                    placeholder="Ex. geste commercial"
                    value={ovNote}
                    onChange={(e) => setOvNote(e.target.value)}
                  />
                </Field>
              </div>
            )}
          </div>
        )}

        {payment === 'crédit' && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Field label="Client">
                  <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Choisir un client</option>
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
      </div>
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
  shops,
  locked,
  onClose,
  onSubmit,
}: {
  open: boolean
  /** Boutique présélectionnée (scope précis) ; vide si « Toutes les boutiques » */
  shopId: string
  shops: { id: string; name: string }[]
  /** Scope précis : la boutique est imposée, sinon choix obligatoire */
  locked: boolean
  onClose: () => void
  onSubmit: (input: { shopId: string; name: string; cost: number; price: number; stock: number; tiered?: boolean; tiers?: { min_quantity: number; unit_price: number }[] }) => Promise<void>
}) {
  const { notify } = useStore()
  const [name, setName] = useState('')
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('0')
  const [selShop, setSelShop] = useState(shopId)
  const [wholesale, setWholesale] = useState(false)
  const [tierQty, setTierQty] = useState('')
  const [tierPrice, setTierPrice] = useState('')
  const [tierPct, setTierPct] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setSelShop(shopId)
      if (selShop) {
        const def = readShopTierDefault(selShop)
        const base = Math.round(Number(price) || 0)
        if (def && base > 0) {
          setTierQty(String(def.min_quantity))
          setTierPct(String(def.discount_pct))
          setTierPrice(String(pctToPrice(base, def.discount_pct)))
        } else {
          setTierQty('3')
          setTierPct('5')
          setTierPrice(base > 0 ? String(pctToPrice(base, 5)) : '')
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shopId])

  const setTierFromPrice = (raw: string) => {
    setTierPrice(raw)
    const base = Math.round(Number(price) || 0)
    const p = Number(raw)
    if (base > 0 && Number.isFinite(p) && p >= 0) setTierPct(String(priceToPct(base, Math.round(p))))
  }
  const setTierFromPct = (raw: string) => {
    setTierPct(raw)
    const base = Math.round(Number(price) || 0)
    const z = Number(raw)
    if (base > 0 && Number.isFinite(z) && z >= 0) setTierPrice(String(pctToPrice(base, z)))
  }

  const reset = () => {
    setName('')
    setCost('')
    setPrice('')
    setStock('0')
    setSelShop(shopId)
    setWholesale(false)
    setTierQty('')
    setTierPrice('')
    setTierPct('')
  }

  const submit = async () => {
    if (!selShop) {
      notify('Choisis la boutique de cet article pour ne pas mélanger les ventes.', 'error')
      return
    }
    setBusy(true)
    try {
      await onSubmit({
        shopId: selShop,
        name,
        cost: Number(cost || 0),
        price: Number(price || 0),
        stock: Number(stock || 0),
        tiered: wholesale,
        tiers: wholesale
          ? [{ min_quantity: Math.floor(Number(tierQty)), unit_price: Math.round(Number(tierPrice)) }]
          : undefined,
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
        <Field
          label="Boutique"
          hint={locked ? 'Boutique active : verrouillée.' : 'Chaque article appartient à une seule boutique.'}
        >
          <Select value={selShop} onChange={(e) => setSelShop(e.target.value)} disabled={locked || shops.length === 0}>
            <option value="">Choisir une boutique…</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
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
        <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-slate-50 px-3 py-2">
          <input
            type="checkbox"
            checked={wholesale}
            onChange={(e) => setWholesale(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-700"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-700">Prix par quantité (prix de gros)</span>
            <span className="block text-xs text-slate-500">Propose un prix plus bas quand le client achète en quantité.</span>
          </span>
        </label>
        {wholesale && (
          <div className="grid grid-cols-3 items-end gap-2 rounded-xl border border-dashed border-slate-300 p-3">
            <Field label="Dès (unités)">
              <Input type="number" inputMode="numeric" min={2} value={tierQty} onChange={(e) => setTierQty(e.target.value)} />
            </Field>
            <Field label="Prix (F)">
              <Input type="number" inputMode="numeric" min={0} value={tierPrice} onChange={(e) => setTierFromPrice(e.target.value)} />
            </Field>
            <Field label="Remise (%)">
              <Input type="number" inputMode="numeric" min={0} max={90} value={tierPct} onChange={(e) => setTierFromPct(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button className="flex-1" onClick={submit} disabled={busy || !selShop}>
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

function BulkTierModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, scope, notify, bulkSetTiered } = useStore()
  const [checked, setChecked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const list = (scope === 'all' ? db.items : db.items.filter((i) => i.shop_id === scope)).filter((i) => !i.deleted_at)

  useEffect(() => {
    if (open) setChecked(list.map((i) => i.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const run = async (enabled: boolean) => {
    if (checked.length === 0) {
      notify('Sélectionne au moins un article.', 'error')
      return
    }
    setBusy(true)
    try {
      await bulkSetTiered(checked, enabled)
      onClose()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Opération impossible.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Prix de gros en lot" onClose={onClose}>
      <p className="text-xs text-slate-500">
        Active ou désactive l’option sur plusieurs articles à la fois. Les paliers existants sont toujours conservés.
      </p>
      <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        {list.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={checked.includes(i.id)}
                onChange={(e) =>
                  setChecked((c) => (e.target.checked ? [...c, i.id] : c.filter((x) => x !== i.id)))
                }
                className="h-4 w-4 accent-emerald-700"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{i.name}</span>
              {isTiered(i) && <Badge className="bg-emerald-100 text-emerald-700">gros</Badge>}
            </label>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="mt-3 text-sm text-slate-500">Aucun article.</p>}
      <div className="mt-3 flex gap-2">
        <Button className="flex-1" disabled={busy || checked.length === 0} onClick={() => void run(true)}>
          Tout activer
        </Button>
        <Button variant="secondary" className="flex-1" disabled={busy || checked.length === 0} onClick={() => void run(false)}>
          Tout désactiver
        </Button>
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
    <Modal open={item !== null} title={`Réapprovisionner : ${item?.name ?? ''}`} onClose={close}>
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

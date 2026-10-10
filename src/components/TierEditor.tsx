import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { atLeast } from '../lib/permissions'
import {
  isTiered,
  nextTier,
  pctToPrice,
  previewLine,
  priceToPct,
  readShopTierDefault,
  saveShopTierDefault,
  suggestFirstTier,
  summaryRanges,
  tierMargin,
  tierModeOf,
  tiersOf,
} from '../lib/tiers'
import { fcfa } from '../lib/format'
import { Badge, Button, ConfirmDialog, Field, Input, Segmented, Select } from './ui'

/* ------------------------------------------------------------------ */
/* Éditeur de prix par quantité : interrupteur, paliers, simulateur.   */
/* Lecture pour tous les membres ; écriture gérant+ (vérifiée aussi   */
/* côté serveur par la RLS et record_sale).                            */
/* ------------------------------------------------------------------ */

export function TierEditor({ itemId }: { itemId: string }) {
  const {
    db,
    role,
    notify,
    setTieredPricing,
    setTierMode,
    saveTier,
    deleteTier,
    copyTiers,
  } = useStore()
  const item = db.items.find((i) => i.id === itemId)
  const canEdit = atLeast(role, 'gerant')

  const [confirmOff, setConfirmOff] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [simQty, setSimQty] = useState('3')
  const [copyFrom, setCopyFrom] = useState('')
  const [defQty, setDefQty] = useState('')
  const [defPct, setDefPct] = useState('')
  const [defSaved, setDefSaved] = useState(0)

  const tiers = useMemo(() => tiersOf(db.price_tiers, itemId), [db.price_tiers, itemId])
  const shopDefault = useMemo(
    () => (item ? readShopTierDefault(item.shop_id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, defSaved],
  )
  const copySources = useMemo(
    () =>
      item
        ? db.items.filter(
            (i) => i.shop_id === item.shop_id && !i.deleted_at && i.id !== item.id && tiersOf(db.price_tiers, i.id).length > 0,
          )
        : [],
    [db.items, db.price_tiers, item],
  )

  if (!item) return null
  const enabled = isTiered(item)
  const mode = tierModeOf(item)

  const toggle = async (next: boolean) => {
    try {
      await setTieredPricing(item.id, next)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Opération impossible.', 'error')
    }
  }

  const exampleQty = tiers.length > 0 ? tiers[tiers.length - 1].min_quantity : 3
  const exPalier = previewLine(item.price, tiers, 'palier', exampleQty, true)
  const exTranche = previewLine(item.price, tiers, 'tranche', exampleQty, true)

  const simN = Math.max(1, Math.floor(Number(simQty) || 1))
  const sim = previewLine(item.price, tiers, mode, simN, enabled)

  return (
    <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-3">
      {/* Interrupteur */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-800">Prix par quantité (prix de gros)</p>
          <p className="text-xs text-slate-500">Propose un prix plus bas quand le client achète en quantité.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Prix par quantité"
          disabled={!canEdit}
          onClick={() => (enabled ? setConfirmOff(true) : void toggle(true))}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${
            enabled ? 'bg-emerald-600' : 'bg-slate-300'
          }`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
              enabled ? 'left-[1.375rem]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {!enabled && (
        <p className="mt-2 text-xs text-slate-400">
          {tiers.length > 0
            ? 'Éteint : les paliers sont conservés mais ne s’appliquent plus.'
            : 'Éteint : cet article se vend au prix normal.'}
        </p>
      )}

      {enabled && (
        <div className="mt-3 space-y-3">
          {/* Mode de calcul */}
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Calcul du total</p>
            {canEdit ? (
              <Segmented
                value={mode}
                onChange={(m) => void setTierMode(item.id, m).catch((e: unknown) => notify(e instanceof Error ? e.message : 'Opération impossible.', 'error'))}
                size="sm"
                options={[
                  { value: 'palier', label: 'Tout au palier' },
                  { value: 'tranche', label: 'Par tranche' },
                ]}
              />
            ) : (
              <p className="text-xs text-slate-600">{mode === 'palier' ? 'Tout au palier' : 'Par tranche'}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Exemple pour {exampleQty} unités : tout au palier → {fcfa(exPalier.total)} · par tranche →{' '}
              {fcfa(exTranche.total)}.
            </p>
          </div>

          {/* Résumé */}
          {tiers.length > 0 && (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">{summaryRanges(item.price, tiers)}</p>
          )}

          {/* Liste des paliers */}
          <ul className="divide-y divide-slate-100">
            {tiers.map((t, i) => {
              const m = tierMargin(t.unit_price, item.cost_price)
              const loss = t.unit_price <= item.cost_price
              const pricier = i > 0 && t.unit_price > tiers[i - 1].unit_price
              return (
                <li key={t.id} className="py-2">
                  {editingId === t.id ? (
                    <TierForm
                      basePrice={item.price}
                      initial={{ min_quantity: t.min_quantity, unit_price: t.unit_price }}
                      onCancel={() => setEditingId(null)}
                      onSave={async (v) => {
                        try {
                          await saveTier(item.id, { id: t.id, ...v })
                          setEditingId(null)
                        } catch (e) {
                          notify(e instanceof Error ? e.message : 'Enregistrement impossible.', 'error')
                        }
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">
                          Dès {t.min_quantity} : {fcfa(t.unit_price)}/u
                        </p>
                        <p className={`text-xs ${loss ? 'font-bold text-red-600' : 'text-slate-500'}`}>
                          Marge : {fcfa(m.unit)} /u{m.unit >= 0 && m.pct !== null ? ` (${Math.round(m.pct)} %)` : ''}
                          {loss ? ' · vente à perte !' : ''}
                          {!loss && pricier ? ' · plus cher que le palier précédent' : ''}
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 gap-1">
                          <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => { setEditingId(t.id); setAdding(false) }}>
                            Modifier
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-2.5 py-1.5 text-xs text-red-600"
                            onClick={() => void deleteTier(item.id, t.id).catch((e: unknown) => notify(e instanceof Error ? e.message : 'Suppression impossible.', 'error'))}
                          >
                            Retirer
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {tiers.length === 0 && (
            <p className="text-xs text-slate-500">Aucun palier : le prix normal s’applique en attendant.</p>
          )}

          {/* Ajout */}
          {canEdit && !adding && (
            <Button variant="secondary" onClick={() => { setAdding(true); setEditingId(null) }}>
              Ajouter un palier
            </Button>
          )}
          {canEdit && adding && (
            <TierForm
              basePrice={item.price}
              initial={suggestFirstTier(item.price, shopDefault)}
              onCancel={() => setAdding(false)}
              onSave={async (v) => {
                try {
                  await saveTier(item.id, v)
                  setAdding(false)
                } catch (e) {
                  notify(e instanceof Error ? e.message : 'Enregistrement impossible.', 'error')
                }
              }}
            />
          )}

          {/* Mini-simulateur */}
          <div className="rounded-xl bg-emerald-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-emerald-800">Simuler :</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={simQty}
                onChange={(e) => setSimQty(e.target.value)}
                className="w-20 bg-white py-1.5"
                aria-label="Quantité à simuler"
              />
              <span className="text-xs font-bold text-emerald-800">
                {simN} × {fcfa(sim.unitPrice)} = {fcfa(sim.total)}
                {item.cost_price > 0 ? `, marge ${fcfa((sim.unitPrice - item.cost_price) * simN)}` : ''}
              </span>
            </div>
          </div>

          {/* Copie depuis un autre article */}
          {canEdit && copySources.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label="Copier les paliers de…">
                  <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                    <option value="">Choisir un article…</option>
                    {copySources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button
                variant="secondary"
                disabled={!copyFrom}
                onClick={() => {
                  if (!copyFrom) return
                  void copyTiers(copyFrom, item.id)
                    .then(() => setCopyFrom(''))
                    .catch((e: unknown) => notify(e instanceof Error ? e.message : 'Copie impossible.', 'error'))
                }}
              >
                Copier
              </Button>
            </div>
          )}

          {/* Règle par défaut de la boutique (préremplissage seul) */}
          {canEdit && (
            <div className="rounded-xl border border-dashed border-slate-300 px-3 py-2">
              <p className="text-xs font-semibold text-slate-600">Règle par défaut de ma boutique (facultatif)</p>
              <p className="text-[11px] text-slate-400">Sert uniquement à préremplir le formulaire d’un nouvel article.</p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="w-24">
                  <Field label="Dès (unités)">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={2}
                      value={defQty}
                      onChange={(e) => setDefQty(e.target.value)}
                      placeholder={String(shopDefault?.min_quantity ?? 5)}
                    />
                  </Field>
                </div>
                <div className="w-24">
                  <Field label="Remise (%)">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0.5}
                      max={90}
                      value={defPct}
                      onChange={(e) => setDefPct(e.target.value)}
                      placeholder={String(shopDefault?.discount_pct ?? 8)}
                    />
                  </Field>
                </div>
                <Button
                  variant="secondary"
                  className="px-3 py-2 text-xs"
                  onClick={() => {
                    const q = Math.floor(Number(defQty))
                    const p = Number(defPct)
                    if (!Number.isInteger(q) || q < 2 || !(p > 0) || p > 90) {
                      notify('Seuil (≥ 2) et remise (0,5 à 90 %) invalides.', 'error')
                      return
                    }
                    saveShopTierDefault(item.shop_id, { min_quantity: q, discount_pct: p })
                    setDefSaved((n) => n + 1)
                    setDefQty('')
                    setDefPct('')
                    notify('Règle par défaut enregistrée.')
                  }}
                >
                  Enregistrer
                </Button>
              </div>
              {shopDefault && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Actuelle : dès {shopDefault.min_quantity} unités, −{shopDefault.discount_pct} %.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOff}
        title="Désactiver les prix par quantité ?"
        message="Les paliers sont conservés mais ne s’appliqueront plus. Les ventes passées ne changent pas."
        confirmLabel="Désactiver"
        onConfirm={() => {
          setConfirmOff(false)
          void toggle(false)
        }}
        onCancel={() => setConfirmOff(false)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Formulaire en une phrase : « À partir de [X] unités, [Y] F / −Z % ». */
/* ------------------------------------------------------------------ */

function TierForm({
  basePrice,
  initial,
  onSave,
  onCancel,
}: {
  basePrice: number
  initial: { min_quantity: number; unit_price: number }
  onSave: (v: { min_quantity: number; unit_price: number }) => Promise<void>
  onCancel: () => void
}) {
  const [qty, setQty] = useState(String(initial.min_quantity))
  const [price, setPrice] = useState(String(initial.unit_price))
  const [pct, setPct] = useState(String(priceToPct(basePrice, initial.unit_price)))
  const [busy, setBusy] = useState(false)

  const setFromPrice = (raw: string) => {
    setPrice(raw)
    const p = Number(raw)
    if (Number.isFinite(p) && p >= 0) setPct(String(priceToPct(basePrice, Math.round(p))))
  }
  const setFromPct = (raw: string) => {
    setPct(raw)
    const z = Number(raw)
    if (Number.isFinite(z) && z >= 0) setPrice(String(pctToPrice(basePrice, z)))
  }

  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-600">À partir de…</p>
      <div className="mt-2 grid grid-cols-3 items-end gap-2">
        <Field label="Unités">
          <Input type="number" inputMode="numeric" min={2} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Prix (F)">
          <Input type="number" inputMode="numeric" min={0} value={price} onChange={(e) => setFromPrice(e.target.value)} />
        </Field>
        <Field label="Remise (%)">
          <Input type="number" inputMode="numeric" min={0} max={90} value={pct} onChange={(e) => setFromPct(e.target.value)} />
        </Field>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {qty || '…'} unités → {fcfa(Number(price) || 0)}/u (−{Number(pct) || 0} %).
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          className="flex-1"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onSave({ min_quantity: Math.floor(Number(qty)), unit_price: Math.round(Number(price)) }).finally(() =>
              setBusy(false),
            )
          }}
        >
          Enregistrer
        </Button>
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  )
}

/** Aperçu du prix selon le mode : cumul (prix normal) ou un seul client (palier).
 * En cumul, incitation discrète à basculer quand le premier palier est atteint. */
export function TierHint({
  normalPrice,
  itemId,
  quantity,
  singleClient,
  onSwitchToSingle,
}: {
  normalPrice: number
  itemId: string
  quantity: number
  /** true = « Un seul client » (palier), false = « Cumul de la journée » (prix normal) */
  singleClient: boolean
  onSwitchToSingle?: () => void
}) {
  const { db } = useStore()
  const item = db.items.find((i) => i.id === itemId)
  const tiers = tiersOf(db.price_tiers, itemId)
  if (!item || !isTiered(item) || tiers.length === 0) return null
  const line = previewLine(normalPrice, tiers, tierModeOf(item), quantity, singleClient)
  const next = singleClient ? nextTier(tiers, quantity) : null
  const first = tiers[0]
  return (
    <div className="mt-2 space-y-1 text-xs">
      <p className="font-bold text-slate-800">
        {quantity} × {fcfa(line.unitPrice)} = {fcfa(line.total)}
        {singleClient && line.tierMin !== null ? ' (prix de gros, un seul client)' : ' (prix normal)'}
        {singleClient && line.tierMin !== null && (
          <Badge className="ml-1.5 bg-emerald-100 text-emerald-700">Prix de gros</Badge>
        )}
      </p>
      {next && next.missing <= 2 && line.tierMin === null && (
        <p className="text-slate-500">
          Plus que {next.missing} unité{next.missing > 1 ? 's' : ''} pour passer à {fcfa(next.unit_price)} l’unité.
        </p>
      )}
      {!singleClient && quantity >= first.min_quantity && (
        <p className="flex flex-wrap items-center gap-1.5 text-slate-500">
          <span>Si ces unités ont été achetées par un seul client, choisis « Un seul client ».</span>
          {onSwitchToSingle && (
            <button
              type="button"
              onClick={onSwitchToSingle}
              className="font-semibold text-emerald-700 hover:underline"
            >
              Basculer
            </button>
          )}
        </p>
      )}
    </div>
  )
}

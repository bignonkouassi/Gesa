import { useMemo, useState } from 'react'
import { useScopedDB, useStore } from '../state/store'
import type { Sale } from '../lib/types'
import {
  CREDIT_STATUS_COLORS,
  computeCreditStatus,
  creditRest,
  inRange,
  isoWeek,
  listMonthPeriods,
  listWeekPeriods,
  monthNameLabel,
  rangeFor,
  saleProfit,
  saleRevenue,
  statsFor,
  type PeriodSummary,
  type Range,
} from '../lib/calc'
import { fcfa, formatDateShort, num, todayISO } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  SectionTitle,
  Segmented,
  Select,
} from '../components/ui'
import { FicheButton } from '../components/FicheButton'
import { slug } from '../lib/fiche'
import { canSeeFinances, canExport } from '../lib/permissions'

type Tab = 'ventes' | 'réappro' | 'crédits' | 'mouvements' | 'périodes'
type PeriodKind = 'tout' | 'jour' | 'semaine' | 'mois' | 'perso'
type SortKey = 'date' | 'montant' | 'benefice'

const TABS: { value: Tab; label: string }[] = [
  { value: 'ventes', label: 'Ventes' },
  { value: 'réappro', label: 'Réappro.' },
  { value: 'crédits', label: 'Crédits' },
  { value: 'mouvements', label: 'Stock' },
  { value: 'périodes', label: 'Périodes' },
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'montant', label: 'Montant' },
  { value: 'benefice', label: 'Bénéfice' },
]

/** Nombre de lignes affichées (les listes peuvent être très longues) */
const LIST_LIMIT = 300

export function Historique() {
  const { db, scope, role } = useStore()
  const seeMoney = canSeeFinances(role)
  const { items, sales, restocks, credits, payments, customers } = useScopedDB()

  const [tab, setTab] = useState<Tab>('ventes')
  const [period, setPeriod] = useState<PeriodKind>('tout')
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return todayISO().slice(0, 8) + String(d.getDate()).padStart(2, '0')
  })
  const [to, setTo] = useState(todayISO())
  const [article, setArticle] = useState('')
  const [client, setClient] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('date')
  const [periodsKind, setPeriodsKind] = useState<'semaines' | 'mois'>('semaines')
  const [detail, setDetail] = useState<PeriodSummary | null>(null)

  const shopLabel = scope === 'all' ? 'Toutes les boutiques' : (db.shops.find((s) => s.id === scope)?.name ?? 'Boutique')
  const shopSlug = scope === 'all' ? 'Toutes-les-boutiques' : slug(db.shops.find((s) => s.id === scope)?.name ?? 'Boutique')

  const range: Range = useMemo(() => {
    if (period === 'tout') return { from: '1970-01-01', to: '2100-01-01' }
    if (period === 'perso') {
      const end = new Date(`${to}T12:00:00`)
      end.setDate(end.getDate() + 1)
      return { from, to: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}` }
    }
    return rangeFor(period)
  }, [period, from, to])

  const movements = useMemo(
    () => (scope === 'all' ? db.stock_movements : db.stock_movements.filter((m) => m.shop_id === scope)),
    [db.stock_movements, scope],
  )

  const customerName = (id: string | null) => (id ? (customers.find((c) => c.id === id)?.name ?? 'Client supprimé') : '—')
  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? db.items.find((i) => i.id === id)?.name ?? 'Article supprimé'
  const matches = (text: string) => query.trim() === '' || text.toLowerCase().includes(query.trim().toLowerCase())

  const filteredSales = useMemo(() => {
    const rows = sales.filter(
      (s) => inRange(s.sale_date, range) && (!article || s.item_id === article) && (!client || s.customer_id === client),
    )
    const searched = rows.filter((s) => matches(`${s.item_name} ${customerName(s.customer_id)}`))
    const sorted = [...searched]
    if (sort === 'date') sorted.sort((a, b) => b.sale_date.localeCompare(a.sale_date) || b.created_at.localeCompare(a.created_at))
    if (sort === 'montant') sorted.sort((a, b) => saleRevenue(b) - saleRevenue(a))
    if (sort === 'benefice') sorted.sort((a, b) => saleProfit(b) - saleProfit(a))
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, range, article, client, query, sort, customers, items])

  const filteredRestocks = useMemo(() => {
    const rows = restocks.filter((r) => inRange(r.restock_date, range) && (!article || r.item_id === article))
    const searched = rows.filter((r) => matches(`${itemName(r.item_id)} ${r.supplier ?? ''}`))
    const sorted = [...searched]
    if (sort === 'date') sorted.sort((a, b) => b.restock_date.localeCompare(a.restock_date))
    if (sort === 'montant') sorted.sort((a, b) => b.quantity * b.unit_cost - a.quantity * a.unit_cost)
    if (sort === 'benefice') sorted.sort((a, b) => b.quantity * b.unit_cost - a.quantity * a.unit_cost)
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restocks, range, article, query, sort, items])

  type CreditRow =
    | { kind: 'crédit'; id: string; date: string; label: string; client: string; amount: number; rest: number; status: string }
    | { kind: 'remboursement'; id: string; date: string; label: string; client: string; amount: number; rest: number; status: string }

  const filteredCredits = useMemo(() => {
    const today = todayISO()
    const rows: CreditRow[] = []
    for (const c of credits) {
      if (!inRange(c.sale_date, range)) continue
      if (client && c.customer_id !== client) continue
      const cust = customerName(c.customer_id)
      const sale = db.sales.find((s) => s.id === c.sale_id)
      const label = sale ? sale.item_name : 'Article supprimé'
      if (!matches(`${cust} ${label}`)) continue
      rows.push({
        kind: 'crédit',
        id: c.id,
        date: c.sale_date,
        label: `${label} · accordé`,
        client: cust,
        amount: c.total_amount,
        rest: creditRest(c),
        status: computeCreditStatus(c, today),
      })
    }
    for (const p of payments) {
      if (!inRange(p.payment_date, range)) continue
      const credit = credits.find((c) => c.id === p.credit_id)
      if (!credit) continue
      if (client && credit.customer_id !== client) continue
      const cust = customerName(credit.customer_id)
      if (!matches(cust)) continue
      rows.push({
        kind: 'remboursement',
        id: p.id,
        date: p.payment_date,
        label: `Remboursement${p.note ? ` · ${p.note}` : ''}`,
        client: cust,
        amount: p.amount,
        rest: 0,
        status: 'remboursé',
      })
    }
    if (sort === 'date') rows.sort((a, b) => b.date.localeCompare(a.date))
    if (sort === 'montant' || sort === 'benefice') rows.sort((a, b) => b.amount - a.amount)
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credits, payments, range, client, query, sort, customers])

  const filteredMovements = useMemo(() => {
    const rows = movements.filter((m) => inRange(m.created_at.slice(0, 10), range) && (!article || m.item_id === article))
    const searched = rows.filter((m) => matches(itemName(m.item_id)))
    const sorted = [...searched]
    if (sort === 'date') sorted.sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (sort === 'montant' || sort === 'benefice') sorted.sort((a, b) => Math.abs(b.quantity) - Math.abs(a.quantity))
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movements, range, article, query, sort, items])

  const periods = useMemo(() => {
    const list = periodsKind === 'semaines' ? listWeekPeriods(db, sales, restocks) : listMonthPeriods(db, sales, restocks)
    return list.filter((p) => p.range.from >= range.from || period === 'tout' || period === 'perso')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodsKind, db, sales, restocks])

  const count =
    tab === 'ventes'
      ? filteredSales.length
      : tab === 'réappro'
        ? filteredRestocks.length
        : tab === 'crédits'
          ? filteredCredits.length
          : tab === 'mouvements'
            ? filteredMovements.length
            : periods.length

  return (
    <div className="space-y-4">
      <SectionTitle>Historique</SectionTitle>

      {/* Onglets */}
      <div className="overflow-x-auto">
        <Segmented value={tab} onChange={setTab} size="sm" options={TABS} />
      </div>

      {/* Filtres communs */}
      <Card className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Segmented
            value={period}
            onChange={setPeriod}
            size="sm"
            options={[
              { value: 'tout', label: 'Tout' },
              { value: 'jour', label: 'Jour' },
              { value: 'semaine', label: 'Semaine' },
              { value: 'mois', label: 'Mois' },
              { value: 'perso', label: 'Personnalisée' },
            ]}
          />
          <div className="ml-auto">
            <Segmented
              value={sort}
              onChange={setSort}
              size="sm"
              options={seeMoney ? SORTS : SORTS.filter((s) => s.value !== 'benefice')}
            />
          </div>
        </div>

        {period === 'perso' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Du">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Au">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          {tab !== 'crédits' && tab !== 'périodes' && (
            <Field label="Article">
              <Select value={article} onChange={(e) => setArticle(e.target.value)}>
                <option value="">Tous les articles</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {tab === 'ventes' || tab === 'crédits' ? (
            <Field label="Client">
              <Select value={client} onChange={(e) => setClient(e.target.value)}>
                <option value="">Tous les clients</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Recherche">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom, article, fournisseur…" />
          </Field>
        </div>
        <p className="text-xs text-slate-400">
          Boutique : <b>{shopLabel}</b> · {count} ligne(s) · tri par {SORTS.find((s) => s.value === sort)?.label.toLowerCase()}
          {count > LIST_LIMIT ? ` · ${LIST_LIMIT} premières affichées` : ''}
        </p>
      </Card>

      {/* Contenu */}
      {tab === 'ventes' && (
        <Card className="p-0">
          {filteredSales.length === 0 ? (
            <EmptyState title="Aucune vente sur cette période" hint="Change la période ou saisis une vente depuis l’onglet Ventes." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredSales.slice(0, LIST_LIMIT).map((s: Sale) => (
                <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700">
                      {s.quantity} × {s.item_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateShort(s.sale_date)} · {customerName(s.customer_id)} · {s.payment_type}
                      {s.payment_type === 'crédit' ? '' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <p className="font-bold text-slate-800">{fcfa(saleRevenue(s))}</p>
                    {seeMoney && (
                      <p className={saleProfit(s) >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                        {fcfa(saleProfit(s))} de bénéfice
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'réappro' && (
        <Card className="p-0">
          {filteredRestocks.length === 0 ? (
            <EmptyState title="Aucun réapprovisionnement sur cette période" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredRestocks.slice(0, LIST_LIMIT).map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700">
                      {itemName(r.item_id)} · <b>+{r.quantity}</b>{seeMoney ? ` à ${fcfa(r.unit_cost)}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateShort(r.restock_date)}
                      {r.supplier ? ` · ${r.supplier}` : ''}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-xs font-bold text-slate-800">
                    {seeMoney ? fcfa(r.quantity * r.unit_cost) : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'crédits' && (
        <Card className="p-0">
          {filteredCredits.length === 0 ? (
            <EmptyState title="Aucun crédit ni remboursement sur cette période" />
              ) : (
            <ul className="divide-y divide-slate-100">
              {filteredCredits.slice(0, LIST_LIMIT).map((r) => (
                <li key={`${r.kind}-${r.id}`} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700">{r.client}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateShort(r.date)} · {r.label}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <p className={`font-bold ${r.kind === 'remboursement' ? 'text-emerald-700' : 'text-slate-800'}`}>
                      {r.kind === 'remboursement' ? '−' : ''}
                      {fcfa(r.amount)}
                    </p>
                    {r.kind === 'crédit' ? (
                      <Badge className={CREDIT_STATUS_COLORS[r.status as keyof typeof CREDIT_STATUS_COLORS] ?? 'bg-slate-100 text-slate-600'}>
                        {r.status}
                      </Badge>
                    ) : (
                      <span className="text-emerald-700">remboursé</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'mouvements' && (
        <Card className="p-0">
          {filteredMovements.length === 0 ? (
            <EmptyState title="Aucun mouvement de stock sur cette période" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredMovements.slice(0, LIST_LIMIT).map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700">{itemName(m.item_id)}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateShort(m.created_at.slice(0, 10))} ·{' '}
                      <Badge
                        className={
                          m.type === 'vente'
                            ? 'bg-orange-100 text-orange-700'
                            : m.type === 'réappro'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                        }
                      >
                        {m.type}
                      </Badge>
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-xs text-slate-600">
                    <b className={m.stock_after >= m.stock_before ? 'text-emerald-700' : 'text-orange-700'}>
                      {m.stock_after >= m.stock_before ? '+' : ''}
                      {m.quantity}
                    </b>
                    <span className="block text-slate-400">
                      {m.stock_before} → {m.stock_after}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'périodes' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Segmented
              value={periodsKind}
              onChange={setPeriodsKind}
              size="sm"
              options={[
                { value: 'semaines', label: 'Par semaine' },
                { value: 'mois', label: 'Par mois' },
              ]}
            />
            <span className="text-xs text-slate-400">{periods.length} période(s)</span>
          </div>
          <Card className="p-0">
            {periods.length === 0 ? (
              <EmptyState title="Aucune période avec des données" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {periods.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => setDetail(p)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-700">{p.label}</span>
                        <span className="block text-xs text-slate-500">
                          {num(p.stats.salesCount)} vente(s) · dépenses réappro {fcfa(p.stats.spent)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs">
                        <span className="block font-bold text-slate-800">{fcfa(p.stats.revenue)}</span>
                        <span className="block text-emerald-700">{fcfa(p.stats.profit)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <PeriodDetailModal
        detail={detail}
        kind={periodsKind}
        shopSlug={shopSlug}
        onClose={() => setDetail(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Détail d'une période                                                */
/* ------------------------------------------------------------------ */

function PeriodDetailModal({
  detail,
  kind,
  shopSlug,
  onClose,
}: {
  detail: PeriodSummary | null
  kind: 'semaines' | 'mois'
  shopSlug: string
  onClose: () => void
}) {
  const { db, scope, role } = useStore()
  const seeMoney = canSeeFinances(role)
  const { sales, restocks } = useScopedDB()

  if (!detail) return <Modal open={false} title="" onClose={onClose}>
    <span />
  </Modal>

  const salesIn = sales.filter((s) => inRange(s.sale_date, detail.range))
  const byItem = new Map<string, { name: string; qty: number; revenue: number; profit: number }>()
  for (const s of salesIn) {
    const row = byItem.get(s.item_id) ?? { name: s.item_name, qty: 0, revenue: 0, profit: 0 }
    row.qty += s.quantity
    row.revenue += saleRevenue(s)
    row.profit += saleProfit(s)
    byItem.set(s.item_id, row)
  }
  const rows = [...byItem.values()].sort((a, b) => b.revenue - a.revenue)
  const stats = statsFor(db, sales, detail.range, restocks)
  const fileBase =
    kind === 'semaines'
      ? `${shopSlug}_Semaine-${isoWeek(new Date(`${detail.range.from}T12:00:00`)).week}-${new Date(`${detail.range.from}T12:00:00`).getFullYear()}`
      : `${shopSlug}_${slug(
          monthNameLabel(new Date(`${detail.range.from}T12:00:00`).getFullYear(), new Date(`${detail.range.from}T12:00:00`).getMonth()),
        )}`

  return (
    <Modal open title={detail.label} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Chiffre d’affaires</p>
            <p className="text-lg font-bold text-slate-800">{fcfa(stats.revenue)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-xs text-slate-500">Bénéfice</p>
            <p className="text-lg font-bold text-emerald-800">{seeMoney ? fcfa(stats.profit) : '—'}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="text-xs text-slate-500">Dépenses de réappro</p>
            <p className="text-lg font-bold text-amber-800">{seeMoney ? fcfa(stats.spent) : '—'}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Nombre de ventes</p>
            <p className="text-lg font-bold text-slate-800">{num(stats.salesCount)}</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
            Aucune vente sur cette période.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2">Article</th>
                  <th className="py-2 text-right">Qté</th>
                  <th className="py-2 text-right">CA</th>
                  {seeMoney && <th className="py-2 text-right">Bénéfice</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-b border-slate-100">
                    <td className="py-2 text-slate-700">{r.name}</td>
                    <td className="py-2 text-right text-slate-600">{num(r.qty)}</td>
                    <td className="py-2 text-right text-slate-700">{fcfa(r.revenue)}</td>
                    {seeMoney && <td className="py-2 text-right font-semibold text-emerald-700">{fcfa(r.profit)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {canExport(role) && (
            <FicheButton
              range={detail.range}
              mode={kind === 'semaines' ? 'semaine' : 'mois'}
              periodLabel={detail.label}
              fileBase={fileBase}
              variant="primary"
            />
          )}
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </div>
        <p className="text-xs text-slate-400">
          Boutique : {scope === 'all' ? 'Toutes les boutiques' : shopSlug.replace(/-/g, ' ')} · période{' '}
          {formatDateShort(detail.range.from)} → {formatDateShort(detail.range.to)}
        </p>
      </div>
    </Modal>
  )
}

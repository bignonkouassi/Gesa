import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useScopedDB, useStore } from '../state/store'
import {
  availableYears,
  buildChart,
  compare,
  isoWeek,
  monthNameLabel,
  rangeFor,
  statsFor,
  stockStatus,
  stockValue,
  topBy,
  yearSummary,
  type RangeMode,
  type YearSummary,
} from '../lib/calc'
import { addDays, fcfa, num, parseISO, pct, toISO, todayISO } from '../lib/format'
import { Button, Card, Delta, EmptyState, Field, Input, SectionTitle, Segmented, StatCard } from '../components/ui'
import { greetingLine } from '../lib/greeting'
import { useProfile } from '../lib/profile'
import { FicheButton } from '../components/FicheButton'
import { ExportMenu } from '../components/ExportMenu'
import { slug } from '../lib/fiche'
import { canExport, canSeeFinances } from '../lib/permissions'
import type { PageKey } from '../components/Shell'

export function Dashboard({ onNavigate }: { onNavigate: (p: PageKey) => void }) {
  const { db, scope, notify, role, user, addShop, setScope } = useStore()
  const [profile] = useProfile(user?.id)
  const seeMoney = canSeeFinances(role)
  const { items, sales, restocks, credits, payments } = useScopedDB()
  const [mode, setMode] = useState<RangeMode>('semaine')
  const [topKey, setTopKey] = useState<'quantity' | 'profit' | 'margin'>('quantity')
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [shopName, setShopName] = useState('')
  const [shopBusy, setShopBusy] = useState(false)
  const today = todayISO()

  const activeShops = db.shops.filter((s) => !s.deleted_at)
  const scopeLabel =
    scope === 'all' ? 'Toutes les boutiques' : (db.shops.find((s) => s.id === scope)?.name ?? '')
  const todayLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  /* Première visite : on crée d'abord une boutique, avant toute donnée */
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

  const header = (
    <div>
      <h1 className="text-xl font-black text-slate-800">{greetingLine(profile.fullName)} !</h1>
      <p className="mt-0.5 text-xs text-slate-500">
        <span className="capitalize">{todayLabel}</span>
        {activeShops.length > 0 && scopeLabel ? ` · ${scopeLabel}` : ''}
      </p>
    </div>
  )

  const welcome = (
    <div className="space-y-5">
      {header}
      <Card>
        <SectionTitle>Bienvenue sur Gesa</SectionTitle>
        <p className="text-sm text-slate-600">
          Pour commencer, crée ta première boutique. Ensuite tu pourras y ajouter tes articles, enregistrer tes
          ventes et suivre tes crédits.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
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

  const chart = useMemo(
    () => buildChart(db, scope === 'all' ? null : scope, mode, year),
    [db, scope, mode, year],
  )
  const shopSlug =
    scope === 'all' ? 'Toutes-les-boutiques' : slug(db.shops.find((s) => s.id === scope)?.name ?? 'Boutique')

  const todayStats = useMemo(() => statsFor(db, sales, rangeFor('jour'), restocks), [db, sales, restocks])
  const weekStats = useMemo(() => statsFor(db, sales, rangeFor('semaine'), restocks), [db, sales, restocks])
  const monthStats = useMemo(() => statsFor(db, sales, rangeFor('mois'), restocks), [db, sales, restocks])
  const prevMonth = useMemo(() => {
    const from = parseISO(rangeFor('mois').from)
    const prevFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1, 12)
    const prevTo = new Date(from.getFullYear(), from.getMonth(), 1, 12)
    return statsFor(db, sales, { from: toISO(prevFrom), to: toISO(prevTo) }, restocks)
  }, [db, sales, restocks])
  const totalStats = useMemo(
    () => statsFor(db, sales, { from: '1970-01-01', to: '2100-01-01' }, restocks),
    [db, sales, restocks],
  )
  const monthCompare = compare(monthStats, prevMonth, 'profit')
  const weekCompare = compare(weekStats, statsFor(db, sales, { from: subDays(rangeFor('semaine').from, 7), to: rangeFor('semaine').from }, restocks), 'profit')

  const value = useMemo(() => stockValue(items), [items])
  const tops = useMemo(() => topBy(sales, chart.range, topKey), [sales, chart.range, topKey])

  const lateCredits = credits.filter((c) => {
    const rest = c.total_amount - c.amount_paid
    return rest > 0.001 && c.due_date && c.due_date < today
  })
  const lowStock = items.filter((i) => stockStatus(i) !== 'normal')
  const debtors = new Set(credits.filter((c) => c.total_amount - c.amount_paid > 0.001).map((c) => c.customer_id))
  const pendingAmount = credits.reduce((acc, c) => acc + Math.max(0, c.total_amount - c.amount_paid), 0)
  const paidThisMonth = payments
    .filter((p) => p.payment_date >= rangeFor('mois').from)
    .reduce((a, p) => a + p.amount, 0)

  const noData = sales.length === 0

  /* Première visite : la création de la boutique passe avant tout le reste */
  if (activeShops.length === 0) return welcome

  return (
    <div className="space-y-5">
      {header}
      {/* Alertes */}
      {lateCredits.length > 0 && (
        <button
          type="button"
          onClick={() => onNavigate('credits')}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-red-700">
            {lateCredits.length} crédit{lateCredits.length > 1 ? 's' : ''} en retard :{' '}
            {fcfa(lateCredits.reduce((a, c) => a + (c.total_amount - c.amount_paid), 0))} à récupérer
          </span>
          <span className="text-xs font-bold text-red-700">Voir →</span>
        </button>
      )}
      {lowStock.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">Stock à surveiller</p>
          <p className="mt-0.5 text-xs text-amber-700">
            {lowStock
              .slice(0, 4)
              .map((i) => `${i.name} (${i.stock <= 0 ? 'rupture' : i.stock})`)
              .join(' · ')}
            {lowStock.length > 4 ? ` · +${lowStock.length - 4} autres` : ''}
          </p>
        </div>
      )}

      {/* Bénéfices clés */}
      {seeMoney && (
      <section>
        <SectionTitle>Bénéfices</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Aujourd’hui" value={fcfa(todayStats.profit)} sub={`${num(todayStats.salesCount)} vente(s)`} tone="good" />
          <StatCard
            label="Cette semaine"
            value={fcfa(weekStats.profit)}
            sub={<Delta pct={weekCompare} label="vs sem. dernière" />}
            tone="good"
          />
          <StatCard
            label="Ce mois"
            value={fcfa(monthStats.profit)}
            sub={<Delta pct={monthCompare} label="vs mois dernier" />}
            tone="good"
          />
          <StatCard label="Total" value={fcfa(totalStats.profit)} sub={`${num(totalStats.salesCount)} ventes`} />
        </div>
      </section>
      )}

      {/* CA vs bénéfice vs dépenses */}
      <section>
        <SectionTitle>Ce mois-ci</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Chiffre d’affaires (ce qui entre)" value={fcfa(monthStats.revenue)} />
          {seeMoney && <StatCard label="Bénéfice (ce qui reste)" value={fcfa(monthStats.profit)} tone="good" />}
          {seeMoney && <StatCard label="Dépenses de réappro (argent sorti)" value={fcfa(monthStats.spent)} tone="warn" />}
        </div>
        {seeMoney && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <StatCard label="Dépenses de réappro : semaine" value={fcfa(weekStats.spent)} tone="warn" />
          <StatCard label="Dépenses de réappro : total" value={fcfa(totalStats.spent)} tone="warn" />
        </div>
        )}
      </section>

      {/* Graphique */}
      <section>
        <SectionTitle
          action={
            <Segmented
              value={mode}
              onChange={setMode}
              size="sm"
              options={[
                { value: 'semaine', label: 'Semaine' },
                { value: 'mois', label: 'Mois' },
                { value: 'année', label: 'Année' },
              ]}
            />
          }
        >
          {seeMoney ? 'Chiffre d’affaires et bénéfice' : 'Chiffre d’affaires'}
        </SectionTitle>
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              {mode === 'semaine' ? 'Les 7 jours' : mode === 'mois' ? 'Les jours du mois' : `Les mois de l’année ${year}`}
            </span>
            <Delta pct={chart.comparePct} label={chart.compareLabel} />
          </div>
          {mode === 'année' && (
            <div className="mb-3 flex items-center justify-center gap-3">
              <Button variant="secondary" className="px-3 py-1.5" onClick={() => setYear((y) => y - 1)}>
                ← {year - 1}
              </Button>
              <span className="text-sm font-bold text-slate-800">{year}</span>
              <Button variant="secondary" className="px-3 py-1.5" onClick={() => setYear((y) => y + 1)}>
                {year + 1} →
              </Button>
            </div>
          )}
          {noData ? (
            <EmptyState
              title="Aucune vente pour l’instant"
              hint="Enregistre une vente depuis l’onglet Ventes."
              action={<Button onClick={() => onNavigate('ventes')}>Saisir des ventes</Button>}
            />
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart.buckets} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => compactFcfa(v as number)} />
                  <Tooltip
                    formatter={(v, name) => [fcfa(Number(v)), name === 'revenue' ? 'Chiffre d’affaires' : 'Bénéfice']}
                    contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid #e2e8f0' }}
                  />
                  <Legend formatter={(v) => (v === 'revenue' ? 'Chiffre d’affaires' : 'Bénéfice')} />
                  <Bar dataKey="revenue" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  {seeMoney && <Bar dataKey="profit" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={26} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-400">Fiche de la période affichée</span>
            <FicheButton
              range={chart.range}
              mode={mode}
              periodLabel={
                mode === 'semaine'
                  ? `Semaine ${isoWeek(parseISO(chart.range.from)).week} · du ${new Date(chart.range.from + 'T12:00:00').toLocaleDateString('fr-FR')} au ${new Date(addDays(parseISO(chart.range.to), -1) + 'T12:00:00').toLocaleDateString('fr-FR')}`
                  : mode === 'mois'
                    ? monthNameLabel(parseISO(chart.range.from).getFullYear(), parseISO(chart.range.from).getMonth())
                    : `Bilan de l’année ${year}`
              }
              fileBase={
                mode === 'semaine'
                  ? `${shopSlug}_Semaine-${isoWeek(parseISO(chart.range.from)).week}-${parseISO(chart.range.from).getFullYear()}`
                  : mode === 'mois'
                    ? `${shopSlug}_${slug(monthNameLabel(parseISO(chart.range.from).getFullYear(), parseISO(chart.range.from).getMonth()))}`
                    : `${shopSlug}_Bilan-${year}`
              }
            />
          </div>
        </Card>
      </section>

      {/* Bilan annuel (onglet Année) */}
      {mode === 'année' && seeMoney && <AnnualReport year={year} shopSlug={shopSlug} />}

      {/* Encaissé vs en attente */}
      {seeMoney && (
      <section>
        <SectionTitle>Argent : encaissé et en attente</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Bénéfice encaissé"
            value={fcfa(monthStats.profitEncaisse)}
            sub="Ventes payées (comptant + crédit remboursé)"
            tone="good"
          />
          <StatCard
            label="Bénéfice en attente de paiement"
            value={fcfa(monthStats.profitAttente)}
            sub="Ventes à crédit non encore réglées"
            tone="warn"
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <StatCard label="Crédits en cours" value={fcfa(pendingAmount)} sub="Argent à récupérer" tone="warn" />
          <StatCard label="Remboursé ce mois" value={fcfa(paidThisMonth)} tone="good" />
          <StatCard label="Clients débiteurs" value={num(debtors.size)} />
        </div>
      </section>
      )}

      {/* Top 5 */}
      <section>
        <SectionTitle
          action={
            <Segmented
              value={topKey}
              onChange={setTopKey}
              size="sm"
              options={[
                { value: 'quantity', label: 'Quantité' },
                ...(seeMoney ? [{ value: 'profit' as const, label: 'Bénéfice' }, { value: 'margin' as const, label: 'Marge' }] : []),
              ]}
            />
          }
        >
          Top 5 des articles
        </SectionTitle>
        <Card className="p-0">
          {tops.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Pas encore de ventes sur la période.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tops.map((r, idx) => (
                <li key={r.item_id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-5 text-center text-xs font-bold text-slate-400">{idx + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{r.name}</span>
                  <span className="text-right text-xs text-slate-500">
                    <span className="block font-semibold text-slate-800">{num(r.quantity)} vendus</span>
                    {seeMoney ? <>{fcfa(r.profit)} · {pct(r.marginPct)}</> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* Ventes en gros : seulement si un article a l'option active.
          Ne comptent que les ventes « Un seul client » avec palier appliqué. */}
      {db.items.some((i) => !i.deleted_at && i.tiered_pricing) && (
        <section>
          <SectionTitle>Ventes en gros</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Ventes au prix de gros"
              value={num(sales.filter((s) => (s.sale_mode ?? 'un_client') === 'un_client' && s.tier_min_quantity != null).length)}
              sub={`${fcfa(sales.filter((s) => (s.sale_mode ?? 'un_client') === 'un_client' && s.tier_min_quantity != null).reduce((a, s) => a + s.unit_price * s.quantity, 0))} de chiffre d’affaires`}
              tone="good"
            />
            <StatCard
              label="Ventes au prix normal"
              value={num(sales.filter((s) => s.tier_min_quantity == null && !s.price_overridden).length)}
              sub={`${fcfa(sales.filter((s) => s.tier_min_quantity == null && !s.price_overridden).reduce((a, s) => a + s.unit_price * s.quantity, 0))} de chiffre d’affaires`}
            />
          </div>
          {(() => {
            const grosItems = db.items
              .filter((i) => !i.deleted_at && sales.some((s) => s.item_id === i.id && (s.sale_mode ?? 'un_client') === 'un_client' && s.tier_min_quantity != null))
              .slice(0, 8)
            if (grosItems.length === 0) return null
            return (
          <Card className="mt-3 p-0">
            <ul className="divide-y divide-slate-100">
              {grosItems.map((i) => {
                  const rows = sales.filter((s) => s.item_id === i.id)
                  const gros = rows.filter((s) => s.tier_min_quantity != null)
                  const normal = rows.filter((s) => s.tier_min_quantity == null)
                  const rev = (rs: typeof rows) => rs.reduce((a, s) => a + s.unit_price * s.quantity, 0)
                  const prof = (rs: typeof rows) => rs.reduce((a, s) => a + (s.unit_price - s.unit_cost) * s.quantity, 0)
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 truncate font-medium text-slate-700">{i.name}</span>
                      <span className="shrink-0 text-right text-xs text-slate-500">
                        <span className="block">Normal : <b className="text-slate-800">{fcfa(rev(normal))}</b>{seeMoney ? ` · bénéf ${fcfa(prof(normal))}` : ''}</span>
                        <span className="block">Gros : <b className="text-emerald-700">{fcfa(rev(gros))}</b>{seeMoney ? ` · bénéf ${fcfa(prof(gros))}` : ''}</span>
                      </span>
                    </li>
                  )
                })}
            </ul>
          </Card>
            )
          })()}
        </section>
      )}

      {/* Valeur du stock */}
      {seeMoney && (
      <section>
        <SectionTitle>Valeur du stock</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Argent investi (au prix d’achat)" value={fcfa(value.atCost)} sub={`${num(value.units)} unités en stock`} />
          <StatCard label="Gain potentiel (au prix de vente)" value={fcfa(value.atPrice)} tone="good" />
        </div>
      </section>
      )}

      {canExport(role) && (
      <section>
        <SectionTitle>Exporter</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <ExportMenu />
        </div>
      </section>
      )}
    </div>
  )
}

function subDays(iso: string, n: number): string {
  return toISO(addDays(parseISO(iso), -n))
}

function compactFcfa(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${Math.round(v / 100000) / 10} M`
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)} k`
  return String(v)
}

/* ------------------------------------------------------------------ */
/* Bilan annuel (onglet Année du tableau de bord)                      */
/* ------------------------------------------------------------------ */

function AnnualReport({ year, shopSlug }: { year: number; shopSlug: string }) {
  const { db, scope } = useStore()
  const { sales, restocks, credits, payments } = useScopedDB()
  const [byKey, setByKey] = useState<'quantity' | 'profit'>('quantity')

  const summary: YearSummary = useMemo(
    () => yearSummary(db, sales, restocks, credits, payments, year),
    [db, sales, restocks, credits, payments, year],
  )
  const years = useMemo(() => availableYears(sales, restocks), [sales, restocks])
  const vsPrev = summary.previous ? compare(summary.totals, summary.previous, 'profit') : null
  const top10 = byKey === 'quantity' ? summary.top10Qty : summary.top10Profit

  return (
    <section className="space-y-4">
      <SectionTitle action={
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setByKey('quantity')}>
            Quantité
          </Button>
          <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setByKey('profit')}>
            Bénéfice
          </Button>
        </div>
      }>
        Bilan de l’année {year}
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Chiffre d’affaires annuel" value={fcfa(summary.totals.revenue)} />
        <StatCard label="Bénéfice annuel" value={fcfa(summary.totals.profit)} tone="good" />
        <StatCard label="Dépenses de réappro" value={fcfa(summary.totals.spent)} tone="warn" />
        <StatCard label="Nombre de ventes" value={num(summary.totals.salesCount)} sub={`${num(summary.totals.quantity)} unités`} />
        <StatCard
          label="Meilleur mois"
          value={summary.bestMonth ? summary.bestMonth.label : '—'}
          sub={summary.bestMonth ? fcfa(summary.bestMonth.profit) + ' de bénéfice' : 'Aucune donnée'}
          tone="good"
        />
        <StatCard
          label="Mois le plus faible"
          value={summary.worstMonth ? summary.worstMonth.label : '—'}
          sub={summary.worstMonth ? fcfa(summary.worstMonth.profit) + ' de bénéfice' : 'Aucune donnée'}
          tone="bad"
        />
      </div>

      {summary.previous && (
        <Card className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-700">
            {summary.year} vs {summary.previousYear}
          </span>
          <span className="flex flex-wrap gap-4 text-xs">
            <span>
              CA : <b>{fcfa(summary.totals.revenue)}</b> vs {fcfa(summary.previous.revenue)}{' '}
              <Delta pct={compare(summary.totals, summary.previous, 'revenue')} label="" />
            </span>
            <span>
              Bénéfice : <b>{fcfa(summary.totals.profit)}</b> vs {fcfa(summary.previous.profit)}{' '}
              <Delta pct={vsPrev} label="" />
            </span>
          </span>
        </Card>
      )}

      <Card className="p-0">
        <div className="table-scroll">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2">Mois</th>
                <th className="px-2 py-2 text-right">Chiffre d’affaires</th>
                <th className="px-2 py-2 text-right">Bénéfice</th>
                <th className="px-2 py-2 text-right">Marge</th>
                <th className="px-4 py-2 text-right">Évolution</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.month} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-700 capitalize">{r.label}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{fcfa(r.revenue)}</td>
                  <td className="px-2 py-2 text-right font-semibold text-emerald-700">{fcfa(r.profit)}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{Math.round(r.marginPct)} %</td>
                  <td className="px-4 py-2 text-right">
                    <Delta pct={r.evolutionPct} label="" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <p className="mb-2 text-sm font-bold text-slate-800">Top 10 de l’année</p>
          {top10.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune vente cette année-là.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {top10.map((r, i) => (
                <li key={r.item_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-slate-700">
                    <b className="mr-2 text-slate-400">{i + 1}</b>
                    {r.name}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {num(r.quantity)} vendus · <b className="text-emerald-700">{fcfa(r.profit)}</b>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <p className="mb-2 text-sm font-bold text-slate-800">Crédits de l’année</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 py-3">
              <p className="text-[11px] text-slate-500">Accordés</p>
              <p className="text-sm font-bold text-slate-800">{fcfa(summary.credits.granted)}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 py-3">
              <p className="text-[11px] text-slate-500">Remboursés</p>
              <p className="text-sm font-bold text-emerald-800">{fcfa(summary.credits.paid)}</p>
            </div>
            <div className="rounded-xl bg-red-50 py-3">
              <p className="text-[11px] text-slate-500">Impayés</p>
              <p className="text-sm font-bold text-red-700">{fcfa(summary.credits.outstanding)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <FicheButton
              range={{ from: `${year}-01-01`, to: `${year + 1}-01-01` }}
              mode="année"
              periodLabel={`Bilan de l’année ${year}`}
              fileBase={`${shopSlug}_Bilan-${year}`}
              label="Télécharger le bilan annuel"
              variant="primary"
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Années disponibles : {years.join(', ')} · boutique : {scope === 'all' ? 'toutes' : shopSlug.replace(/-/g, ' ')}
          </p>
        </Card>
      </div>
    </section>
  )
}

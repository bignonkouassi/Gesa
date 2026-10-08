import { useMemo, useState } from 'react'
import { useScopedDB, useStore } from '../state/store'
import type { Credit, CreditStatus } from '../lib/types'
import { CREDIT_STATUS_COLORS, computeCreditStatus, creditRest } from '../lib/calc'
import { fcfa, formatDateFr, formatDateShort, num, todayISO } from '../lib/format'
import { Button, Card, EmptyState, Field, Input, Modal, SectionTitle, Segmented, StatCard, Badge } from '../components/ui'
import { exportCustomerPDF } from '../lib/exports'
import { canManageCredits } from '../lib/permissions'

type Filter = 'tous' | 'en cours' | 'partiellement payé' | 'soldé' | 'en retard'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'tous', label: 'Tous' },
  { value: 'en cours', label: 'En cours' },
  { value: 'partiellement payé', label: 'Partiels' },
  { value: 'en retard', label: 'En retard' },
  { value: 'soldé', label: 'Soldés' },
]

export function Credits() {
  const { db, addPayment, updateCredit, notify, role } = useStore()
  const canManage = canManageCredits(role)
  const { credits, payments, customers, sales } = useScopedDB()
  const today = todayISO()
  const [filter, setFilter] = useState<Filter>('tous')
  const [paying, setPaying] = useState<Credit | null>(null)
  const [customerOpen, setCustomerOpen] = useState<string | null>(null)

  const statusOf = (c: Credit): CreditStatus => computeCreditStatus(c, today)

  const rows = useMemo(() => {
    return [...credits]
      .map((c) => ({ credit: c, status: statusOf(c) }))
      .filter((r) => filter === 'tous' || r.status === filter)
      .sort((a, b) => {
        const late = (s: CreditStatus) => (s === 'en retard' ? 0 : s === 'partiellement payé' ? 1 : s === 'en cours' ? 2 : 3)
        return late(a.status) - late(b.status) || b.credit.sale_date.localeCompare(a.credit.sale_date)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credits, filter, today])

  const outstanding = credits
    .filter((c) => statusOf(c) !== 'soldé')
    .reduce((a, c) => a + creditRest(c), 0)
  const paidThisMonth = payments
    .filter((p) => p.payment_date >= `${today.slice(0, 7)}-01`)
    .reduce((a, p) => a + p.amount, 0)
  const debtors = new Set(credits.filter((c) => statusOf(c) !== 'soldé').map((c) => c.customer_id))
  const lateCount = credits.filter((c) => statusOf(c) === 'en retard').length

  const customerOf = (id: string) => customers.find((c) => c.id === id)
  const saleOf = (c: Credit) => sales.find((s) => s.id === c.sale_id) ?? db.sales.find((s) => s.id === c.sale_id)

  const openWhatsApp = (c: Credit) => {
    const cust = customerOf(c.customer_id)
    if (!cust) {
      notify('Client introuvable.', 'error')
      return
    }
    const rest = Math.round(creditRest(c))
    const msg = `Bonjour ${cust.name}, il vous reste ${num(rest)} F à régler pour votre achat du ${formatDateShort(c.sale_date)}. Merci !`
    const phone = cust.phone.replace(/[^\d+]/g, '')
    window.open(`https://wa.me/${phone.startsWith('+') ? phone.slice(1) : phone}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  if (!canManage) {
    return (
      <div className="space-y-5">
        <EmptyState
          title="Crédits non disponibles pour ce rôle"
          hint="Le rôle Vendeur ne gère pas les crédits. Contacte le propriétaire ou le gérant."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Crédits en cours" value={fcfa(outstanding)} sub="Argent à récupérer" tone="warn" />
          <StatCard label="Remboursé ce mois" value={fcfa(paidThisMonth)} tone="good" />
          <StatCard label="Clients débiteurs" value={num(debtors.size)} />
          <StatCard label="Crédits en retard" value={num(lateCount)} tone={lateCount > 0 ? 'bad' : 'default'} />
        </div>
      </section>

      <section>
        <SectionTitle>Crédits clients</SectionTitle>
        <div className="mb-3 overflow-x-auto">
          <Segmented value={filter} onChange={setFilter} size="sm" options={FILTERS} />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Aucun crédit dans ce filtre"
            hint="Les ventes à crédit saisies depuis l’onglet Ventes apparaîtront ici."
          />
        ) : (
          <div className="space-y-3">
            {rows.map(({ credit, status }) => {
              const cust = customerOf(credit.customer_id)
              const sale = saleOf(credit)
              const rest = creditRest(credit)
              return (
                <Card key={credit.id} className={status === 'en retard' ? 'border-red-200' : ''}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">{cust?.name ?? 'Client supprimé'}</p>
                      <p className="truncate text-xs text-slate-500">
                        {cust?.phone || '—'} · {sale?.item_name ?? 'Article supprimé'} ·{' '}
                        {formatDateShort(credit.sale_date)}
                      </p>
                    </div>
                    <Badge className={CREDIT_STATUS_COLORS[status]}>{status}</Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-slate-50 py-2">
                      <p className="text-[11px] text-slate-500">Total</p>
                      <p className="text-sm font-bold text-slate-800">{fcfa(credit.total_amount)}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 py-2">
                      <p className="text-[11px] text-slate-500">Payé</p>
                      <p className="text-sm font-bold text-emerald-700">{fcfa(credit.amount_paid)}</p>
                    </div>
                    <div className="rounded-xl bg-orange-50 py-2">
                      <p className="text-[11px] text-slate-500">Reste</p>
                      <p className="text-sm font-bold text-orange-700">{fcfa(rest)}</p>
                    </div>
                  </div>

                  {credit.due_date && (
                    <p className={`mt-2 text-xs font-semibold ${status === 'en retard' ? 'text-red-600' : 'text-slate-500'}`}>
                      Échéance : {formatDateFr(credit.due_date)}
                      {status === 'en retard' ? ' — dépassée' : ''}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {rest > 0.001 ? (
                      <>
                        <Button onClick={() => setPaying(credit)}>Rembourser</Button>
                        <Button variant="secondary" onClick={() => openWhatsApp(credit)}>
                          💬 Relancer sur WhatsApp
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void updateCredit(credit.id, { status: 'soldé' })
                          notify('Crédit soldé.')
                        }}
                      >
                        Marquer soldé
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setCustomerOpen(credit.customer_id)}>
                      Fiche client
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <PaymentModal
        credit={paying}
        onClose={() => setPaying(null)}
        onSubmit={async (amount, date, note) => {
          if (!paying) return
          await addPayment(paying.id, amount, date, note)
          setPaying(null)
        }}
      />

      <CustomerSheet
        customerId={customerOpen}
        onClose={() => setCustomerOpen(null)}
      />
    </div>
  )
}

function PaymentModal({
  credit,
  onClose,
  onSubmit,
}: {
  credit: Credit | null
  onClose: () => void
  onSubmit: (amount: number, date: string, note: string) => Promise<void>
}) {
  const { notify } = useStore()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const rest = credit ? creditRest(credit) : 0

  const close = () => {
    setAmount('')
    setNote('')
    setDate(todayISO())
    onClose()
  }

  const submit = async () => {
    setBusy(true)
    try {
      await onSubmit(Number(amount), date, note)
      close()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={credit !== null} title="Enregistrer un remboursement" onClose={close}>
      <div className="space-y-3">
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Reste à payer : <b className="text-orange-700">{fcfa(rest)}</b>
        </p>
        <Field label="Montant remboursé (F)">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(Math.round(rest))}
          />
        </Field>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setAmount(String(Math.round(rest)))}>
            Tout rembourser
          </Button>
          <Button variant="secondary" onClick={() => setAmount(String(Math.round(rest / 2)))}>
            Moitié
          </Button>
        </div>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note (optionnel)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. Payé en espèces" />
        </Field>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={busy || !(Number(amount) > 0)}
            onClick={submit}
          >
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

function CustomerSheet({ customerId, onClose }: { customerId: string | null; onClose: () => void }) {
  const { db, notify } = useStore()
  const { credits: scopedCredits, payments: scopedPayments, customers } = useScopedDB()
  const today = todayISO()

  const customer = customers.find((c) => c.id === customerId) ?? db.customers.find((c) => c.id === customerId)
  const credits = (customerId ? scopedCredits : []).filter((c) => c.customer_id === customerId)
  const allCredits = credits.length > 0 ? credits : db.credits.filter((c) => c.customer_id === customerId)
  const allPayments = scopedPayments.filter((p) => allCredits.some((c) => c.id === p.credit_id))
  const totalDue = allCredits.reduce((a, c) => a + creditRest(c), 0)

  return (
    <Modal open={customerId !== null} title={customer ? `Fiche : ${customer.name}` : 'Fiche client'} onClose={onClose} wide>
      {!customer ? (
        <p className="text-sm text-slate-500">Client introuvable.</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            📞 {customer.phone || '—'} · <b className="text-orange-700">Total dû : {fcfa(totalDue)}</b>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Achats à crédit</p>
            {allCredits.length === 0 ? (
              <p className="text-sm text-slate-500">Aucun achat à crédit.</p>
            ) : (
              <ul className="space-y-2">
                {allCredits.map((c) => {
                  const sale = db.sales.find((s) => s.id === c.sale_id)
                  const status = computeCreditStatus(c, today)
                  return (
                    <li key={c.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-slate-700">
                          {sale?.item_name ?? 'Article supprimé'} · {formatDateShort(c.sale_date)}
                        </span>
                        <Badge className={CREDIT_STATUS_COLORS[status]}>{status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Total {fcfa(c.total_amount)} · Payé {fcfa(c.amount_paid)} · Reste{' '}
                        <b className="text-orange-700">{fcfa(creditRest(c))}</b>
                        {c.due_date ? ` · Échéance ${formatDateShort(c.due_date)}` : ''}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Remboursements</p>
            {allPayments.length === 0 ? (
              <p className="text-sm text-slate-500">Aucun remboursement enregistré.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {allPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-slate-600">
                      {formatDateShort(p.payment_date)}
                      {p.note ? ` · ${p.note}` : ''}
                    </span>
                    <b className="text-emerald-700">{fcfa(p.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                try {
                  exportCustomerPDF(customer, allCredits, allPayments, db)
                  notify('Fiche client PDF téléchargée')
                } catch (e) {
                  notify(e instanceof Error ? e.message : 'Export impossible', 'error')
                }
              }}
            >
              Fiche PDF
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

import { useState, type ReactNode } from 'react'
import { useScopedDB, useStore } from '../state/store'
import { canSeeFinances } from '../lib/permissions'
import { readProfile } from '../lib/profile'
import {
  exportSalesExcel,
  exportStockSheetCSV,
  exportStockSheetExcel,
  exportStockSheetPDF,
} from '../lib/exports'
import { Button, Modal } from './ui'
import { CsvIcon, DownloadIcon, PdfIcon, TableIcon } from './icons'

/* ------------------------------------------------------------------ */
/* Bouton Exporter unique : propose tous les formats pour le périmètre */
/* actif (une boutique précise ou toutes les boutiques).               */
/* ------------------------------------------------------------------ */

type Option = {
  key: string
  badge: string
  label: string
  hint: string
  icon: ReactNode
  run: () => void
}

export function ExportMenu({ label = 'Exporter' }: { label?: string }) {
  const { db, scope, user, role, notify } = useStore()
  const { items, sales, credits } = useScopedDB()
  const [open, setOpen] = useState(false)

  const showMoney = canSeeFinances(role)
  const businessName = readProfile(user?.id).fullName
  const sheetOpts = { showMoney, businessName }

  const run = (fn: () => void, ok: string) => {
    try {
      fn()
      notify(ok)
      setOpen(false)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Export impossible', 'error')
    }
  }

  const shopCount = db.shops.filter((s) => !s.deleted_at).length
  const where =
    scope === 'all'
      ? shopCount <= 1
        ? (db.shops.find((s) => !s.deleted_at)?.name ?? 'la boutique')
        : 'toutes les boutiques'
      : (db.shops.find((s) => s.id === scope)?.name ?? 'la boutique')

  const options: Option[] = [
    {
      key: 'fiche-pdf',
      badge: 'PDF',
      label: 'Fiche de stock',
      hint: `Document PDF: ${where}`,
      icon: <PdfIcon />,
      run: () => run(() => exportStockSheetPDF(db, scope, sheetOpts), 'Fiche stock PDF téléchargée'),
    },
    {
      key: 'fiche-excel',
      badge: 'Excel',
      label: 'Fiche de stock',
      hint: `Classeur avec totaux calculés: ${where}`,
      icon: <TableIcon />,
      run: () => run(() => exportStockSheetExcel(db, scope, sheetOpts), 'Fiche stock Excel téléchargée'),
    },
    {
      key: 'fiche-csv',
      badge: 'CSV',
      label: 'Fiche de stock',
      hint: `Données brutes: ${where}`,
      icon: <CsvIcon />,
      run: () => run(() => exportStockSheetCSV(db, scope, sheetOpts), 'Fiche stock CSV téléchargée'),
    },
    {
      key: 'ventes-excel',
      badge: 'Excel',
      label: 'Ventes, crédits et stock',
      hint: `Détail complet: ${where}`,
      icon: <TableIcon />,
      run: () => run(() => exportSalesExcel(sales, credits, items, db), 'Fichier Excel téléchargé'),
    },
  ]

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <DownloadIcon /> {label}
      </Button>
      <Modal open={open} title="Exporter" onClose={() => setOpen(false)}>
        <p className="mb-3 text-xs text-slate-500">Périmètre : <b>{where}</b></p>
        <div className="grid gap-2">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={o.run}
              className="flex w-full items-center gap-2.5 overflow-hidden rounded-xl border border-slate-200 px-2.5 py-2 text-left transition hover:border-emerald-300 hover:bg-emerald-50 sm:gap-3 sm:px-3 sm:py-2.5"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 sm:h-9 sm:w-9">
                {o.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">{o.label}</span>
                <span className="block text-xs text-slate-500 line-clamp-2">{o.hint}</span>
              </span>
              <span className="shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 sm:px-2">
                {o.badge}
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  )
}

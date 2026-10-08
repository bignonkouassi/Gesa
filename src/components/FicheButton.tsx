import { useState } from 'react'
import { useStore, useScopedDB } from '../state/store'
import { Button, Modal } from './ui'
import {
  compare,
  previousRange,
  statsFor,
  type Range,
  type RangeMode,
} from '../lib/calc'
import { buildFiche, compareLabelFor, downloadFiche, type FicheFormat } from '../lib/fiche'
import { fcfa } from '../lib/format'

/**
 * Bouton « Télécharger la fiche » : construit les données de la période
 * (les mêmes chiffres que ceux affichés à l'écran) et propose
 * PDF / Excel / CSV.
 */
export function FicheButton({
  range,
  mode,
  periodLabel,
  fileBase,
  label = 'Télécharger la fiche',
  variant = 'secondary',
}: {
  range: Range
  mode: RangeMode | 'personnalisée'
  periodLabel: string
  fileBase: string
  label?: string
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const { db, scope, notify } = useStore()
  const { sales, restocks } = useScopedDB()
  const [open, setOpen] = useState(false)

  const compareMode: RangeMode | null =
    mode === 'jour' || mode === 'semaine' || mode === 'mois' || mode === 'année' ? mode : null
  const prevRange = compareMode ? previousRange(compareMode, range) : null
  const stats = statsFor(db, sales, range, restocks)
  const prevStats = prevRange ? statsFor(db, sales, prevRange, restocks) : null
  const comparePct = prevStats ? compare(stats, prevStats, 'profit') : null

  const handle = (format: FicheFormat) => {
    try {
      const data = buildFiche(
        db,
        scope === 'all' ? null : scope,
        range,
        periodLabel,
        fileBase,
        compareLabelFor(mode),
        comparePct,
      )
      downloadFiche(data, format)
      notify(
        format === 'pdf'
          ? 'Fiche PDF téléchargée'
          : format === 'excel'
            ? 'Fiche Excel téléchargée'
            : 'Fiche CSV téléchargée',
      )
      setOpen(false)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Export impossible', 'error')
    }
  }

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        ⬇ {label}
      </Button>
      <Modal open={open} title="Télécharger la fiche" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">{periodLabel}</p>
            <p className="mt-1">
              {fcfa(stats.revenue)} de chiffre d’affaires · {fcfa(stats.profit)} de bénéfice ·{' '}
              {stats.salesCount} vente(s)
            </p>
            <p className="mt-0.5 text-slate-400">Fichier : {fileBase}.pdf / .xlsx / .csv</p>
          </div>
          <div className="grid gap-2">
            <Button onClick={() => handle('pdf')}>📄 PDF (prêt à imprimer)</Button>
            <Button variant="secondary" onClick={() => handle('excel')}>
              📊 Excel (.xlsx)
            </Button>
            <Button variant="secondary" onClick={() => handle('csv')}>
              📝 CSV
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

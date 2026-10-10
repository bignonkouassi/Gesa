import { Component, type ErrorInfo, type ReactNode } from 'react'
import { WarningIcon } from './icons'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Écran de secours : aucune erreur ne fait planter l'application.
 * Affiche un message simple en français et propose de réessayer.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Journal local sans donnée personnelle (à brancher sur Sentry en production)
    console.error('[erreur-application]', error.message, info.componentStack?.slice(0, 500))
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-slate-50 px-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="flex justify-center text-amber-500">
              <WarningIcon size={32} />
            </p>
            <h1 className="mt-3 text-lg font-bold text-slate-800">Une erreur est survenue</h1>
            <p className="mt-2 text-sm text-slate-500">
              Tes données sont en sécurité : rien n’a été perdu. Tu peux réessayer ou recharger l’application.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Réessayer
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Recharger l’application
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

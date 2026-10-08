import { Button, Card, SectionTitle } from '../components/ui'

/** Page 404 soignée */
export function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid min-h-[70vh] place-items-center px-4">
      <Card className="max-w-md text-center">
        <p className="text-4xl font-black text-emerald-700">404</p>
        <h1 className="mt-2 text-lg font-bold text-slate-800">Page introuvable</h1>
        <p className="mt-2 text-sm text-slate-500">
          Cette page n’existe pas ou a été déplacée. Reviens au tableau de bord pour continuer.
        </p>
        <div className="mt-4 flex justify-center">
          <Button onClick={onBack}>Retour au tableau de bord</Button>
        </div>
      </Card>
    </div>
  )
}

export function Confidentialite({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SectionTitle>Politique de confidentialité</SectionTitle>
      <Card className="space-y-3 text-sm text-slate-600">
        <p>
          <b>Données collectées :</b> uniquement ce qui est utile au fonctionnement de ton activité —
          noms et prix de tes articles, tes ventes, tes stocks, et (si tu le saisis) le nom et le
          téléphone de tes clients à crédit. Aucune donnée de paiement bancaire n’est stockée.
        </p>
        <p>
          <b>Qui voit quoi :</b> tes données n’appartiennent qu’à toi. En mode connecté, chaque compte
          ne voit que ses propres boutiques (contrôles de sécurité appliqués directement en base,
          Row Level Security). En mode hors ligne, tout reste dans ton navigateur.
        </p>
        <p>
          <b>Mots de passe :</b> ils sont stockés de façon irréversible par Supabase Auth, jamais en
          clair, jamais dans les journaux ni dans l’adresse de la page.
        </p>
        <p>
          <b>Suppression :</b> tu peux anonymiser un client à tout moment (ses montants restent dans
          tes bilans, son nom et son téléphone disparaissent), et supprimer l’ensemble de tes données
          depuis « Mon compte ». Les suppressions simples restent restaurables pendant 30 jours.
        </p>
        <p>
          <b>Minimalisation :</b> nous ne collectons que les données nécessaires à l’application, sans
          traceur publicitaire ni revente à des tiers.
        </p>
        <p>
          <b>Contact :</b> pour toute demande relative à tes données, utilise l’adresse e-mail de ton
          compte.
        </p>
      </Card>
      <Button variant="secondary" onClick={onBack}>
        Retour
      </Button>
    </div>
  )
}

export function Conditions({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SectionTitle>Conditions d’utilisation</SectionTitle>
      <Card className="space-y-3 text-sm text-slate-600">
        <p>
          <b>Usage :</b> l’application est un outil de gestion de stock et de crédits pour un commerce.
          Tu restes responsable de l’exactitude des informations que tu saisis.
        </p>
        <p>
          <b>Calculs :</b> bénéfices, stocks et crédits sont calculés à partir de tes saisies ; les
          fiches exportées reflètent exactement les chiffres affichés. Une vérification de cohérence
          du stock est disponible côté base de données.
        </p>
        <p>
          <b>Disponibilité :</b> l’application peut être utilisée hors ligne ; la synchronisation a
          lieu au retour de la connexion. Aucune garantie de service n’est due en cas d’indisponibilité
          de l’hébergement.
        </p>
        <p>
          <b>Résiliation :</b> tu peux exporter l’ensemble de tes données (Excel, CSV, JSON) et
          supprimer ton compte à tout moment depuis « Mon compte ».
        </p>
      </Card>
      <Button variant="secondary" onClick={onBack}>
        Retour
      </Button>
    </div>
  )
}

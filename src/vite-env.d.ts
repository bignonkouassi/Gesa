/// <reference types="vite/client" />

/**
 * Variables d'environnement appelées par le frontend (replaties par Vite depuis .env).
 * À définir dans un fichier .env racine du projet (voir .env.example).
 *
 * Note d'usage : Vite ne gère **pas** la déconnexion de l'utilisateur.
 * Il faut appeler `signOut()` côté client ; le token est gardé en session
 * jusqu'à ce que l'utilisateur se déconnecte.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

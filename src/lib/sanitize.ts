/**
 * Protection contre l'injection de formules dans les exports CSV / Excel.
 * Toute cellule texte commençant par =, +, -, @ ou tabulation est préfixée
 * d'une apostrophe pour que le tableur la traite comme du texte.
 * (OWASP : CSV Injection)
 */
const DANGEROUS_START = /^[=+\-@\t\r]/

export function safeCell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value
  if (DANGEROUS_START.test(text)) return `'${text}`
  return text
}

/** Échappe une valeur pour un champ CSV (séparateur « ; », BOM UTF-8) */
export function csvCell(value: string | number): string {
  const safe = safeCell(value)
  if (/[";\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}

/** Nettoie un texte tapé par l'utilisateur : espaces superflus, caractères de contrôle */
export function cleanText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- suppression intentionnelle des caractères de contrôle
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Indique si une valeur numérique est sûre (aucun NaN / Infinity) */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/* ------------------------------------------------------------------ */
/* Salutation du tableau de bord selon le moment de la journée :       */
/* matin → « Bonjour », après-midi → « Bon après-midi », soir →        */
/* « Bonsoir », suivie du prénom de l'utilisateur quand il est connu.  */
/* ------------------------------------------------------------------ */

export type DayGreeting = 'Bonjour' | 'Bon après-midi' | 'Bonsoir'

export function dayGreeting(now: Date = new Date()): DayGreeting {
  const h = now.getHours()
  if (h >= 5 && h < 12) return 'Bonjour'
  if (h >= 12 && h < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

/** Prénom = premier mot du nom complet (« Awa Kouassi » → « Awa »). */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ''
}

/** « Bonjour Awa » — salutation seule si le profil est vide. */
export function greetingLine(fullName: string, now: Date = new Date()): string {
  const first = firstName(fullName)
  return first ? `${dayGreeting(now)} ${first}` : dayGreeting(now)
}

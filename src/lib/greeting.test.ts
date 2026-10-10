import { describe, expect, it } from 'vitest'
import { dayGreeting, firstName, greetingLine } from './greeting'

const at = (h: number) => new Date(2026, 9, 8, h, 0, 0)

describe('dayGreeting', () => {
  it('dit Bonjour le matin', () => {
    expect(dayGreeting(at(5))).toBe('Bonjour')
    expect(dayGreeting(at(11))).toBe('Bonjour')
  })
  it('dit Bon après-midi l’après-midi', () => {
    expect(dayGreeting(at(12))).toBe('Bon après-midi')
    expect(dayGreeting(at(17))).toBe('Bon après-midi')
  })
  it('dit Bonsoir le soir et la nuit', () => {
    expect(dayGreeting(at(18))).toBe('Bonsoir')
    expect(dayGreeting(at(23))).toBe('Bonsoir')
    expect(dayGreeting(at(4))).toBe('Bonsoir')
  })
})

describe('firstName', () => {
  it('prend le premier mot', () => {
    expect(firstName('Awa Kouassi')).toBe('Awa')
    expect(firstName('  Jean-Claude  ')).toBe('Jean-Claude')
    expect(firstName('')).toBe('')
  })
})

describe('greetingLine', () => {
  it('ajoute le prénom quand il est connu', () => {
    expect(greetingLine('Awa Kouassi', at(8))).toBe('Bonjour Awa')
    expect(greetingLine('Awa Kouassi', at(14))).toBe('Bon après-midi Awa')
    expect(greetingLine('Awa Kouassi', at(20))).toBe('Bonsoir Awa')
  })
  it('reste seule sans profil', () => {
    expect(greetingLine('', at(8))).toBe('Bonjour')
  })
})

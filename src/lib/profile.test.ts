import { describe, expect, it } from 'vitest'
import { initials, profileInput } from './profile'

describe('initials', () => {
  it('prend la première et la dernière lettre du nom complet', () => {
    expect(initials('Awa Kouassi', 'awa@ex.com')).toBe('AK')
    expect(initials('  Jean  Claude  Kouassi  ', 'x@ex.com')).toBe('JK')
  })
  it('prend deux lettres pour un nom unique', () => {
    expect(initials('Awa', 'awa@ex.com')).toBe('AW')
  })
  it('retombe sur l’e-mail sans nom', () => {
    expect(initials('', 'awa.k@ex.com')).toBe('AW')
    expect(initials('   ', 'b@ex.com')).toBe('B')
  })
})

describe('profileInput', () => {
  it('accepte un profil complet valide', () => {
    const out = profileInput.parse({ fullName: 'Awa Kouassi', phone: '+225 07 00 00 00', photo: null })
    expect(out.fullName).toBe('Awa Kouassi')
    expect(out.phone).toBe('+225 07 00 00 00')
  })
  it('accepte un profil vide', () => {
    const out = profileInput.parse({ fullName: '', phone: '', photo: null })
    expect(out).toEqual({ fullName: '', phone: '', photo: null })
  })
  it('refuse un téléphone trop court', () => {
    expect(() => profileInput.parse({ fullName: '', phone: '123', photo: null })).toThrow()
  })
  it('refuse un nom trop long', () => {
    expect(() => profileInput.parse({ fullName: 'a'.repeat(81), phone: '', photo: null })).toThrow()
  })
  it('refuse une photo non image', () => {
    expect(() =>
      profileInput.parse({ fullName: '', phone: '', photo: 'data:text/plain;base64,abc' }),
    ).toThrow()
  })
})

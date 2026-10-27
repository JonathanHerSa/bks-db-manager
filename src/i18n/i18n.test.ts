import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { locale, setLocale, t } from './index'

describe('i18n', () => {
  beforeEach(() => setLocale('es'))
  afterEach(() => setLocale('es'))

  it('returns the Spanish source string in the es locale', () => {
    expect(t('Cancelar')).toBe('Cancelar')
    expect(t('Base de Datos')).toBe('Base de Datos')
  })

  it('translates known keys to English', () => {
    setLocale('en')
    expect(locale.value).toBe('en')
    expect(t('Cancelar')).toBe('Cancel')
    expect(t('Base de Datos')).toBe('Database')
    expect(t('Conexión Activa:')).toBe('Active connection:')
  })

  it('interpolates named parameters', () => {
    setLocale('en')
    expect(t('Mostrando {shown} de {total}', { shown: 3, total: 10 })).toBe('Showing 3 of 10')
    setLocale('es')
    expect(t('Mostrando {shown} de {total}', { shown: 3, total: 10 })).toBe('Mostrando 3 de 10')
  })

  it('keeps unknown placeholders untouched', () => {
    setLocale('en')
    expect(t('Mostrando {shown} de {total}', { shown: 1 })).toBe('Showing 1 of {total}')
  })

  it('persists the selected locale and updates the document language', () => {
    setLocale('en')
    expect(localStorage.getItem('dbm:locale')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    setLocale('es')
    expect(localStorage.getItem('dbm:locale')).toBe('es')
    expect(document.documentElement.lang).toBe('es')
  })
})

/**
 * Minimal i18n layer for the plugin UI.
 *
 * Keys are the Spanish source strings, so `es` needs no dictionary and the
 * existing UI text stays byte-identical. `en` maps each key to its English
 * translation; TypeScript checks that every key used in a component exists.
 *
 * Interpolation: `t('Mostrando {shown} de {total}', { shown, total })`.
 */
import { ref } from 'vue'
import { en } from './en'

export type Locale = 'en' | 'es'
export type MessageKey = keyof typeof en
export type MessageParams = Record<string, string | number>

const STORAGE_KEY = 'dbm:locale'

function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'en' || value === 'es' ? value : null
  } catch {
    return null
  }
}

function detectLocale(): Locale {
  const stored = storedLocale()
  if (stored) return stored
  const language = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  return language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export const locale = ref<Locale>(detectLocale())

export function setLocale(next: Locale): void {
  locale.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Storage can be unavailable in sandboxed iframes; the in-memory locale
    // still works for the current session.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next
  }
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale.value
}

export function t(key: MessageKey, params?: MessageParams): string {
  const template: string = locale.value === 'en' ? en[key] : key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined ? match : String(params[name])
  )
}

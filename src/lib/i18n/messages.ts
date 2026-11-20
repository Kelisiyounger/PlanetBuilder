import en from './en.json';
import zh from './zh.json';

export const locales = ['en', 'zh'] as const;
export type Locale = (typeof locales)[number];

/**
 * Every key that exists in English. `en.json` is the single source of truth for
 * the catalog shape -- `zh.json` must provide all of these.
 */
export type MessageKey = keyof typeof en;

/**
 * The `Record<MessageKey, string>` annotation is load-bearing: it turns a
 * missing `zh` translation into a compile error rather than a runtime blank.
 */
export const messages: Record<Locale, Record<MessageKey, string>> = { en, zh };

/** Namespaced so it cannot collide with other apps served on localhost:5173. */
export const LOCALE_STORAGE_KEY = 'messenger-copy.locale';

const CHINESE_LANGUAGE = /^zh\b/i;

export function isLocale(value: unknown): value is Locale {
	return value === 'en' || value === 'zh';
}

/** `zh`, `zh-CN`, `zh-Hans`, `zh-Hant-HK` -> zh; everything else (incl. `zho`, ``, null) -> en. */
export function detectLocale(language: string | null | undefined): Locale {
	return typeof language === 'string' && CHINESE_LANGUAGE.test(language) ? 'zh' : 'en';
}

/**
 * An explicit stored choice always beats browser detection. Kept separate from
 * `detectLocale` so the precedence is testable without a DOM.
 */
export function pickLocale(stored: unknown, language: string | null | undefined): Locale {
	return isLocale(stored) ? stored : detectLocale(language);
}

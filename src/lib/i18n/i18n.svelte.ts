// Two Svelte 5 rules shape this file -- both are compile/runtime errors, so
// please read before editing:
//
//   1. `state_invalid_export`: a reassignable `$state` cannot be exported from a
//      module. `locale` is therefore not exported directly -- it is reached
//      through the `i18n` object's getter, which is the sanctioned workaround.
//      (Same reason there is no `export const x = $derived(...)`: that is an
//      unconditional `derived_invalid_export` error.)
//   2. `effect_orphan`: a module-level `$effect` compiles but throws at runtime,
//      because no effect is active during module evaluation. Effects belong in
//      components -- the `document.documentElement.lang` sync lives in
//      `src/routes/+layout.svelte`.

import { LOCALE_STORAGE_KEY, messages, pickLocale, type Locale, type MessageKey } from './messages';

function readStoredLocale(): string | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage.getItem(LOCALE_STORAGE_KEY);
	} catch {
		// Storage can throw when cookies are blocked or in private mode.
		return null;
	}
}

function resolveInitialLocale(): Locale {
	if (typeof window === 'undefined') return 'en';
	return pickLocale(readStoredLocale(), window.navigator?.language);
}

// Legal at module scope precisely because it is not exported directly (rule 1).
let locale = $state<Locale>(resolveInitialLocale());

export const i18n = {
	get locale(): Locale {
		return locale;
	},

	/**
	 * A method rather than a function-valued getter: the `locale` read happens at
	 * call time, inside the caller's render effect, so templates re-render on
	 * switch -- and the method identity stays stable instead of allocating a
	 * closure per access.
	 */
	t(key: MessageKey): string {
		return messages[locale][key];
	},

	/**
	 * Only an explicit choice is persisted. Auto-detection deliberately is not,
	 * so a visitor who never touches the switcher keeps following their browser
	 * language on every visit.
	 */
	setLocale(next: Locale): void {
		locale = next;
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
		} catch {
			// Locale still applies for this session.
		}
	}
};

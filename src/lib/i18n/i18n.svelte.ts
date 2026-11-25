// 当前阶段以简体中文为唯一主语言；多语言的检测与持久化逻辑保留在 messages.ts，
// 等游戏本体稳定后再启用切换器。
//
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

import { LOCALE_STORAGE_KEY, messages, type Locale, type MessageKey } from './messages';

/** 主语言。将来恢复多语言时，把这里换回 pickLocale(...) 即可。 */
export const PRIMARY_LOCALE: Locale = 'zh';

// Legal at module scope precisely because it is not exported directly (rule 1).
let locale = $state<Locale>(PRIMARY_LOCALE);

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
	 * 保留给未来的语言切换器。当前 UI 不暴露入口，但选择仍会写入 localStorage，
	 * 方便以后恢复时直接读取。
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

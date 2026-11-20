import { describe, expect, it } from 'vitest';
import {
	detectLocale,
	isLocale,
	locales,
	messages,
	pickLocale,
	type MessageKey
} from './messages';

const enKeys = (Object.keys(messages.en) as MessageKey[]).sort();

describe('catalogs', () => {
	it('ships exactly the declared locales', () => {
		expect(Object.keys(messages).sort()).toEqual([...locales].sort());
	});

	// The compiler catches a *missing* zh key; this catches extra or renamed ones.
	it('zh has exactly the same keys as en', () => {
		expect((Object.keys(messages.zh) as MessageKey[]).sort()).toEqual(enKeys);
	});

	it('has no empty messages', () => {
		for (const locale of locales) {
			for (const key of enKeys) {
				expect(messages[locale][key], `${locale}:${key}`).not.toBe('');
			}
		}
	});
});

describe('detectLocale', () => {
	it.each([
		['zh', 'zh'],
		['zh-CN', 'zh'],
		['zh-TW', 'zh'],
		['zh-Hans', 'zh'],
		['zh-Hans-CN', 'zh'],
		['zh-Hant-HK', 'zh'],
		['ZH-CN', 'zh'],
		['en', 'en'],
		['en-US', 'en'],
		['fr-FR', 'en'],
		['zho', 'en'],
		['', 'en'],
		[undefined, 'en'],
		[null, 'en']
	] as const)('detectLocale(%o) === %s', (language, expected) => {
		expect(detectLocale(language)).toBe(expected);
	});
});

describe('pickLocale', () => {
	it('lets an explicit stored choice beat browser detection', () => {
		expect(pickLocale('en', 'zh-CN')).toBe('en');
		expect(pickLocale('zh', 'en-US')).toBe('zh');
	});

	it('falls back to detection when nothing valid is stored', () => {
		expect(pickLocale('garbage', 'zh-CN')).toBe('zh');
		expect(pickLocale(null, 'en-US')).toBe('en');
		expect(pickLocale(undefined, 'zh-TW')).toBe('zh');
	});
});

describe('isLocale', () => {
	it('only accepts supported locales', () => {
		expect([
			isLocale('en'),
			isLocale('zh'),
			isLocale('EN'),
			isLocale('fr'),
			isLocale(null)
		]).toEqual([true, true, false, false, false]);
	});
});

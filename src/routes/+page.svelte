<script lang="ts">
	import MessengerScene from '$lib/messenger/MessengerScene.svelte';
	import type { SceneMode } from '$lib/messenger/introAssets';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import type { MessageKey } from '$lib/i18n/messages';

	const sceneModes: SceneMode[] = ['intro', 'gameplay', 'npcs', 'walk'];

	function isSceneMode(value: string | null): value is SceneMode {
		return value !== null && (sceneModes as string[]).includes(value);
	}

	/** `?mode=walk` 之类的直达入口，方便开发时跳过按钮。 */
	function readInitialMode(): SceneMode {
		if (typeof window === 'undefined') return 'intro';
		const value = new URL(window.location.href).searchParams.get('mode');
		return isSceneMode(value) ? value : 'intro';
	}

	let sceneMode = $state<SceneMode>(readInitialMode());

	function selectMode(next: SceneMode): void {
		sceneMode = next;
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		url.searchParams.set('mode', next);
		window.history.replaceState(null, '', url);
	}

	// Keyed by SceneMode, so adding a mode without a description stays a compile error.
	const modeDescriptionKeys: Record<SceneMode, MessageKey> = {
		intro: 'mode.intro.description',
		gameplay: 'mode.gameplay.description',
		npcs: 'mode.npcs.description',
		walk: 'mode.walk.description'
	};
</script>

<svelte:head>
	<title>{i18n.t('meta.title')}</title>
	<meta name="description" content={i18n.t('meta.description')} />
</svelte:head>

<main id="app" class="messenger-app">
	{#key sceneMode}
		<MessengerScene mode={sceneMode} />
	{/key}
	<header class="messenger-overlay">
		<p class="eyebrow">{i18n.t('header.eyebrow')}</p>
		<h1>Messenger</h1>
		<p class="lede">{i18n.t(modeDescriptionKeys[sceneMode])}</p>
		<div class="mode-toggle" role="group" aria-label={i18n.t('mode.group')}>
			<button
				type="button"
				class:active={sceneMode === 'intro'}
				onclick={() => selectMode('intro')}
			>
				{i18n.t('mode.intro.label')}
			</button>
			<button
				type="button"
				class:active={sceneMode === 'gameplay'}
				onclick={() => selectMode('gameplay')}
			>
				{i18n.t('mode.gameplay.label')}
			</button>
			<button
				type="button"
				class:active={sceneMode === 'npcs'}
				onclick={() => selectMode('npcs')}
			>
				{i18n.t('mode.npcs.label')}
			</button>
			<button
				type="button"
				class:active={sceneMode === 'walk'}
				onclick={() => selectMode('walk')}
			>
				{i18n.t('mode.walk.label')}
			</button>
		</div>
	</header>
	<footer class="messenger-attribution">
		<!-- Each sentence is split into fragments around the anchors so both languages can
		     reword freely without touching the hrefs. The boundary spaces live inside the
		     catalog strings, so expressions and tags must stay adjacent -- no line breaks. -->
		<p>
			{i18n.t('attr.p1.a')}<a href="https://messenger.abeto.co/" target="_blank" rel="noopener noreferrer">messenger.abeto.co</a>{i18n.t('attr.p1.b')}<a href="https://abeto.co/" target="_blank" rel="noopener noreferrer">abeto</a>{i18n.t('attr.p1.c')}
		</p>
		<p>
			{i18n.t('attr.p2.a')}<strong>{i18n.t('attr.p2.strong')}</strong>{i18n.t('attr.p2.b')}<a href="https://github.com/arafays/messenger-copy/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">{i18n.t('attr.p2.mit')}</a>{i18n.t('attr.p2.c')}<a href="https://github.com/arafays/messenger-copy/blob/main/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">{i18n.t('attr.p2.attribution')}</a>
		</p>
	</footer>
</main>

<style>
	.messenger-app {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: #fff;
	}

	.messenger-overlay {
		position: absolute;
		top: 1.5rem;
		left: 1.5rem;
		z-index: 2;
		max-width: 18rem;
		padding: 1rem 1.1rem;
		border-radius: 0.9rem;
		background: rgb(255 255 255 / 0.82);
		backdrop-filter: blur(10px);
		box-shadow: 0 10px 30px rgb(20 32 40 / 0.12);
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		font-size: 0.72rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #6b7a82;
	}

	h1 {
		margin: 0;
		font-size: 1.6rem;
		line-height: 1.1;
		color: #1f2a30;
	}

	.lede {
		margin: 0.55rem 0 0;
		font-size: 0.92rem;
		line-height: 1.45;
		color: #4d5c64;
	}

	.mode-toggle {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin-top: 0.85rem;
	}

	.mode-toggle button {
		flex: 1 1 calc(50% - 0.45rem);
		min-width: 4.5rem;
		padding: 0.45rem 0.65rem;
		border: 1px solid #c8d2d8;
		border-radius: 0.55rem;
		background: #fff;
		color: #42515a;
		font-size: 0.82rem;
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}

	.mode-toggle button:hover {
		border-color: #9aabb4;
	}

	.mode-toggle button.active {
		border-color: #5a6d78;
		background: #eef3f6;
		color: #1f2a30;
	}

	.messenger-attribution {
		position: absolute;
		right: 1.25rem;
		bottom: 1.25rem;
		z-index: 2;
		max-width: 22rem;
		padding: 0.75rem 0.95rem;
		border-radius: 0.75rem;
		background: rgb(255 255 255 / 0.82);
		backdrop-filter: blur(10px);
		box-shadow: 0 8px 24px rgb(20 32 40 / 0.1);
		font-size: 0.78rem;
		line-height: 1.45;
		color: #4d5c64;
	}

	.messenger-attribution p {
		margin: 0;
	}

	.messenger-attribution p + p {
		margin-top: 0.45rem;
	}

	.messenger-attribution a {
		color: #2f5f78;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.messenger-attribution a:hover {
		color: #1f2a30;
	}

</style>

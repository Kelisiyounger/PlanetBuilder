<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { i18n } from '$lib/i18n/i18n.svelte';

	let { children } = $props();

	// `<html lang>` cannot be set at build time -- SvelteKit 3.0.0-next.4 only
	// understands %sveltekit.head% / %sveltekit.body% in app.html, there is no
	// %sveltekit.lang% placeholder -- so it is synced here on the client.
	// Effects never run during SSR, so no `typeof document` guard is needed.
	$effect(() => {
		document.documentElement.lang = i18n.locale;
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}

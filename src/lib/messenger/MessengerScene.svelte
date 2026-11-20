<script lang="ts">
	import {
		AmbientLight,
		Color,
		DirectionalLight,
		Group,
		PerspectiveCamera,
		Scene,
		WebGLRenderer
	} from 'three';
	import type { AnimationMixer, BatchedMesh, ShaderMaterial } from 'three';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import type { SceneMode } from './introAssets';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import type { MessageKey } from '$lib/i18n/messages';
	import { setMessengerLight, updateMessengerMaterials, type MessengerMaterialSet } from './materials';
	import type { WalkController } from './walkController';
	import type { MessengerComposer } from './postProcessing';
	import { createSceneDepthTarget, resizeSceneDepthTarget } from './sceneDepthPass';
	import { setGameplayWaterDepth, updateGameplayWaterMaterial } from './gameplayWater';
	import { setTerrainLight } from './terrainMaterial';
	import { setTreeLeavesLight, updateTreeLeavesMaterial } from './treeLeaves';

	const scenePresets: Record<
		SceneMode,
		{ background: string; camera: [number, number, number]; minDist: number; maxDist: number; autoRotate: boolean }
	> = {
		intro: { background: '#dfe8ec', camera: [0, 6, 20], minDist: 8, maxDist: 40, autoRotate: true },
		gameplay: { background: '#b8c9cf', camera: [0, 7, 22], minDist: 8, maxDist: 40, autoRotate: true },
		npcs: { background: '#151a22', camera: [0, 4.5, 11], minDist: 5, maxDist: 22, autoRotate: false },
		// camera/minDist/maxDist are inert here: the pointer-lock walk camera
		// drives the transform itself. autoRotate must stay false, or the planet
		// would spin out from under the character.
		walk: { background: '#dfe8ec', camera: [0, 3, 9], minDist: 2, maxDist: 14, autoRotate: false }
	};

	// One key per mode rather than interpolating `mode` into a sentence: English and
	// Chinese need different spacing around the mode name, and this keeps the raw
	// internal id ("npcs") out of user-visible text.
	const sceneLoadingKeys: Record<SceneMode, MessageKey> = {
		intro: 'scene.loading.intro',
		gameplay: 'scene.loading.gameplay',
		npcs: 'scene.loading.npcs',
		walk: 'scene.loading.walk'
	};

	let { mode = 'intro' }: { mode?: SceneMode } = $props();

	let status = $state<'loading' | 'ready' | 'error'>('loading');
	// Pointer lock has no visual affordance of its own, so walk mode shows a hint
	// until the user clicks.
	let pointerLocked = $state(false);

	function mountWebGL(host: HTMLDivElement) {
		const preset = scenePresets[mode];
		const scene = new Scene();
		scene.background = new Color(preset.background);

		const camera = new PerspectiveCamera(42, 1, 0.1, 500);
		camera.position.set(...preset.camera);

		const renderer = new WebGLRenderer({ antialias: true, alpha: false });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(host.clientWidth, host.clientHeight);
		renderer.shadowMap.enabled = mode === 'npcs';
		host.appendChild(renderer.domElement);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.minDistance = preset.minDist;
		controls.maxDistance = preset.maxDist;
		controls.target.set(0, mode === 'npcs' ? 1.2 : 0, 0);
		// Walk mode drives the camera itself. OrbitControls early-returns from
		// every DOM handler while disabled, so it stays constructed and dispose()
		// at teardown still cleans up its listeners.
		controls.enabled = mode !== 'walk';

		scene.add(new AmbientLight(0xffffff, mode === 'npcs' ? 0.45 : mode === 'gameplay' ? 0.78 : 0.62));
		const sun = new DirectionalLight(0xfff1dc, mode === 'npcs' ? 1.8 : 1.4);
		sun.position.set(10, 16, 6);
		if (mode === 'npcs') {
			sun.castShadow = true;
			sun.shadow.mapSize.set(1024, 1024);
		}
		scene.add(sun);

		const runtime = {
			composer: null as MessengerComposer | null,
			sceneGroup: null as Group | null,
			materials: null as MessengerMaterialSet | null,
			terrainMaterial: null as ShaderMaterial | null,
			treeLeavesMaterial: null as ShaderMaterial | null,
			propMaterials: [] as ShaderMaterial[],
			gameplayWaterMaterial: null as ShaderMaterial | null,
			gameplayWater: null as BatchedMesh | null,
			npcMixers: [] as AnimationMixer[],
			walkController: null as WalkController | null,
			walkDispose: null as (() => void) | null,
			autoRotate: preset.autoRotate,
			frame: 0,
			lastFrame: performance.now()
		};

		let sceneDepthTarget = createSceneDepthTarget(host.clientWidth, host.clientHeight);
		const startedAt = performance.now();
		let loadToken = 0;

		const resize = () => {
			const { clientWidth, clientHeight } = host;
			camera.aspect = clientWidth / Math.max(clientHeight, 1);
			camera.updateProjectionMatrix();
			renderer.setSize(clientWidth, clientHeight);
			resizeSceneDepthTarget(sceneDepthTarget, clientWidth, clientHeight);
			runtime.composer?.resize(clientWidth, clientHeight);
			if (runtime.gameplayWaterMaterial) {
				setGameplayWaterDepth(
					runtime.gameplayWaterMaterial,
					sceneDepthTarget.depthTexture,
					clientWidth,
					clientHeight
				);
			}
		};

		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(host);
		resize();

		const loadScene = async () => {
			const token = ++loadToken;
			status = 'loading';
			try {
				if (mode === 'gameplay') {
					const [{ createGameplaySceneGroup }, { createMessengerComposer }] = await Promise.all([
						import('./createGameplayScene'),
						import('./postProcessing')
					]);
					const bundle = await createGameplaySceneGroup(renderer);
					if (token !== loadToken) return;
					runtime.sceneGroup = bundle.group;
					runtime.terrainMaterial = bundle.terrainMaterial;
					runtime.treeLeavesMaterial = bundle.treeLeavesMaterial;
					runtime.propMaterials = bundle.propMaterials;
					runtime.gameplayWater = bundle.gameplayWater;
					runtime.gameplayWaterMaterial = bundle.gameplayWaterMaterial;
					setTerrainLight(bundle.terrainMaterial, sun.position);
					setTreeLeavesLight(bundle.treeLeavesMaterial, sun.position);
					setGameplayWaterDepth(
						runtime.gameplayWaterMaterial,
						sceneDepthTarget.depthTexture,
						host.clientWidth,
						host.clientHeight
					);
					scene.add(bundle.group);
					runtime.composer = createMessengerComposer(renderer, scene, camera, bundle.lut);
					runtime.composer.resize(host.clientWidth, host.clientHeight);
				} else if (mode === 'npcs') {
					const { createNpcGalleryGroup } = await import('./createNpcGallery');
					const bundle = await createNpcGalleryGroup(renderer);
					if (token !== loadToken) return;
					runtime.sceneGroup = bundle.group;
					runtime.npcMixers = bundle.mixers;
					bundle.npcMaterial.uniforms.uLightPosition.value.copy(sun.position);
					scene.add(bundle.group);
				} else if (mode === 'walk') {
					const { createWalkSceneGroup } = await import('./createWalkScene');
					const bundle = await createWalkSceneGroup(renderer, {
						onLockChange: (locked) => (pointerLocked = locked)
					});
					if (token !== loadToken) {
						bundle.dispose();
						return;
					}
					runtime.sceneGroup = bundle.group;
					runtime.materials = bundle.materials;
					runtime.walkController = bundle.controller;
					runtime.walkDispose = bundle.dispose;
					setMessengerLight(runtime.materials, sun.position);
					scene.add(bundle.group);
					// The character is a sibling of the group, not a child: the group
					// carries fitGroup's planet scale.
					scene.add(bundle.character);
					if (import.meta.env.DEV) {
						(window as unknown as Record<string, unknown>).__messengerWalk = {
							...bundle,
							camera,
							scene,
							renderer
						};
					}
				} else {
					const { createIntroSceneGroup } = await import('./createIntroScene');
					const bundle = await createIntroSceneGroup(renderer);
					if (token !== loadToken) return;
					runtime.sceneGroup = bundle.group;
					runtime.materials = bundle.materials;
					setMessengerLight(runtime.materials, sun.position);
					scene.add(bundle.group);
				}
				status = 'ready';
			} catch (error) {
				if (token !== loadToken) return;
				console.error('Failed to load messenger scene', error);
				status = 'error';
			}
		};

		void loadScene();

		const tick = () => {
			runtime.frame = requestAnimationFrame(tick);
			const now = performance.now();
			const delta = (now - runtime.lastFrame) / 1000;
			runtime.lastFrame = now;

			// Clamped only on the character path; the NPC mixers keep the raw delta.
			const step = Math.min(delta, 0.05);
			if (runtime.walkController) runtime.walkController.update(step, camera);
			else controls.update();
			const elapsed = (now - startedAt) / 1000;
			if (runtime.autoRotate && runtime.sceneGroup) runtime.sceneGroup.rotation.y += 0.0012;
			if (runtime.materials) updateMessengerMaterials(runtime.materials, elapsed);
			if (runtime.treeLeavesMaterial) updateTreeLeavesMaterial(runtime.treeLeavesMaterial, elapsed);
			if (runtime.gameplayWaterMaterial) {
				updateGameplayWaterMaterial(runtime.gameplayWaterMaterial, elapsed);
			}
			for (const material of runtime.propMaterials) {
				material.uniforms.uTime.value = elapsed;
			}
			for (const mixer of runtime.npcMixers) {
				mixer.update(delta);
			}

			if (runtime.composer && runtime.gameplayWater && runtime.gameplayWaterMaterial) {
				runtime.gameplayWater.visible = false;
				renderer.setRenderTarget(sceneDepthTarget);
				renderer.clear();
				renderer.render(scene, camera);
				renderer.setRenderTarget(null);
				runtime.gameplayWater.visible = true;
				setGameplayWaterDepth(
					runtime.gameplayWaterMaterial,
					sceneDepthTarget.depthTexture,
					renderer.domElement.width,
					renderer.domElement.height
				);
				runtime.composer.render();
			} else if (runtime.composer) {
				runtime.composer.render();
			} else {
				renderer.render(scene, camera);
			}
		};
		tick();

		return () => {
			loadToken += 1;
			cancelAnimationFrame(runtime.frame);
			resizeObserver.disconnect();
			runtime.composer?.dispose();
			sceneDepthTarget.dispose();
			// Before the canvas is detached: releases pointer lock and removes the
			// document/window input listeners.
			runtime.walkDispose?.();
			controls.dispose();
			renderer.dispose();
			scene.clear();
			host.removeChild(renderer.domElement);
		};
	}
</script>

<div
	id="webgl"
	{@attach mountWebGL}
	class="messenger-canvas"
	aria-label={i18n.t('scene.label')}
>
	{#if status === 'loading'}
		<p class="status">{i18n.t(sceneLoadingKeys[mode])}</p>
	{:else if status === 'error'}
		<p class="status error">{i18n.t('scene.error')}</p>
	{:else if mode === 'walk' && !pointerLocked}
		<p class="status hint">{i18n.t('walk.hint')}</p>
	{/if}
</div>

<style>
	.messenger-canvas {
		display: block;
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.messenger-canvas :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.status {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 1;
		margin: 0;
		transform: translate(-50%, -50%);
		padding: 0.65rem 0.9rem;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.88);
		color: #42515a;
		font-size: 0.9rem;
		pointer-events: none;
	}

	.status.error {
		color: #8a2f2f;
	}

	.status.hint {
		color: #2f5f78;
		background: rgb(255 255 255 / 0.92);
		font-size: 0.82rem;
	}
</style>

export const introGeometryPaths = {
	planet: '/messenger/geometries/planets/present/intro/planet.drc',
	water: '/messenger/geometries/planets/present/intro/water.drc',
	trees: '/messenger/geometries/planets/present/intro/trees.drc',
	clouds: '/messenger/geometries/planets/present/intro/clouds.drc',
	galaxies: '/messenger/geometries/planets/present/intro/galaxies.drc',
	button: '/messenger/geometries/planets/present/intro/button.drc'
} as const;

export const gameplayGeometryPaths = {
	cables1: '/messenger/geometries/planets/present/cables-1.drc',
	cables2: '/messenger/geometries/planets/present/cables-2.drc',
	waterfall: '/messenger/geometries/planets/present/waterfall_vfx.drc',
	waterfallSplash: '/messenger/geometries/planets/present/waterfallsplash_vfx.drc',
	waterfallInlet: '/messenger/geometries/planets/present/waterfall_inlet_vfx.drc',
	smoke: '/messenger/geometries/planets/present/smoke-1.drc',
	beachFoam: '/messenger/geometries/planets/present/beachfoam_vfx.drc',
	gameplayWater: '/messenger/geometries/planets/present/water.drc',
	terrainChunk: (index: number) => `/messenger/geometries/planets/present/full_${index}.drc`,
	treeLeavesChunk: (index: number) => `/messenger/geometries/planets/present/tree-leaves_${index}.drc`
} as const;

export const introTexturePaths = {
	atlas: '/messenger/images/atlas.png',
	lut: '/messenger/images/lut.ktx2',
	cloudNoise: '/messenger/images/clouds_noise_64.ktx2',
	waterNoise: '/messenger/images/water-noises-highq.ktx2',
	cloudNoise512: '/messenger/images/clouds_noise_512.ktx2',
	noiseTerrain: '/messenger/images/noises-terrain.ktx2',
	noiseSimplex: '/messenger/images/noise-simplex-layered-pixellated-highq.ktx2',
	treeLeaves: '/messenger/images/tree-leaves.ktx2'
} as const;

export type SceneMode = 'intro' | 'gameplay' | 'npcs' | 'walk';

/**
 * The third-person avatar. `office-worker` is the only NPC in the bundle that
 * ships a walk cycle -- everything else has idle only.
 *
 * These must be loaded with `loadDracoGeometryWithRig`, not `loadDracoGeometry`:
 * the stock loader drops `skinIndex`/`skinWeight`, the bone rig, and the
 * animation frame metadata.
 */
export const walkCharacterPaths = {
	model: '/messenger/geometries/npcs/present/office-worker/office-worker.drc',
	bones: '/messenger/geometries/npcs/present/office-worker/office-worker-bones.drc',
	idle: '/messenger/geometries/npcs/present/office-worker/office-worker-idle.drc',
	walk: '/messenger/geometries/npcs/present/office-worker/office-worker-walk.drc'
} as const;

/**
 * 原站玩家角色（avatar）资源。镜像里默认没有这组文件，抓取后 walk 模式会优先使用；
 * 缺失时自动回退到 office-worker，所以未抓取时项目仍然可运行。
 */
export const avatarPaths = {
	model: '/messenger/geometries/avatar/avatar.drc',
	bones: '/messenger/geometries/avatar/avatar-bones.drc',
	idle: '/messenger/geometries/avatar/avatar-idle.drc',
	// 2026-11 的线上版本已经没有 avatar-walk 了；玩家的移动循环用 avatar-run。
	walk: '/messenger/geometries/avatar/avatar-run.drc'
} as const;

/**
 * 线上默认装扮。这些配件与 avatar.drc 有相同的属性布局（skinIndex /
 * skinWeight / position / normal / uv / surfaceId），可以合并成一个蒙皮网格。
 */
export const avatarAccessoryPaths = {
	base: '/messenger/geometries/avatar/accessories/base.drc',
	hair: '/messenger/geometries/avatar/accessories/hair1.drc',
	top: '/messenger/geometries/avatar/accessories/top9.drc',
	bottom: '/messenger/geometries/avatar/accessories/bottom6.drc',
	shoes: '/messenger/geometries/avatar/accessories/shoes2.drc'
} as const;

export type NpcGalleryEntry = {
	name: string;
	model: string;
	bones: string;
	idle: string;
};

export const npcGalleryEntries: NpcGalleryEntry[] = [
	{
		name: 'alien',
		model: '/messenger/geometries/npcs/present/alien/alien.drc',
		bones: '/messenger/geometries/npcs/present/alien/alien-bones.drc',
		idle: '/messenger/geometries/npcs/present/alien/alien-idle.drc'
	},
	{
		name: 'chef',
		model: '/messenger/geometries/npcs/present/chef/chef.drc',
		bones: '/messenger/geometries/npcs/present/chef/chef-bones.drc',
		idle: '/messenger/geometries/npcs/present/chef/chef-idle.drc'
	},
	{
		name: 'caveman',
		model: '/messenger/geometries/npcs/present/caveman/caveman.drc',
		bones: '/messenger/geometries/npcs/present/caveman/caveman-bones.drc',
		idle: '/messenger/geometries/npcs/present/caveman/caveman-idle.drc'
	},
	{
		name: 'diver',
		model: '/messenger/geometries/npcs/present/diver/diver.drc',
		bones: '/messenger/geometries/npcs/present/diver/diver-bones.drc',
		idle: '/messenger/geometries/npcs/present/diver/diver-idle.drc'
	},
	{
		name: 'fox',
		model: '/messenger/geometries/npcs/present/fox/fox.drc',
		bones: '/messenger/geometries/npcs/present/fox/fox-bones.drc',
		idle: '/messenger/geometries/npcs/present/fox/fox-idle.drc'
	},
	{
		name: 'musician',
		model: '/messenger/geometries/npcs/present/musician/musician.drc',
		bones: '/messenger/geometries/npcs/present/musician/musician-bones.drc',
		idle: '/messenger/geometries/npcs/present/musician/musician-idle.drc'
	},
	{
		name: 'office-worker',
		model: '/messenger/geometries/npcs/present/office-worker/office-worker.drc',
		bones: '/messenger/geometries/npcs/present/office-worker/office-worker-bones.drc',
		idle: '/messenger/geometries/npcs/present/office-worker/office-worker-idle.drc'
	},
	{
		name: 'scout',
		model: '/messenger/geometries/npcs/present/scout/scout.drc',
		bones: '/messenger/geometries/npcs/present/scout/scout-bones.drc',
		idle: '/messenger/geometries/npcs/present/scout/scout-idle.drc'
	}
];

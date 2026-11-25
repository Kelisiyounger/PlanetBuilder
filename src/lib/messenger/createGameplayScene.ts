import {
	Box3,
	Group,
	Mesh,
	SRGBColorSpace,
	TextureLoader,
	Vector3,
	type BatchedMesh,
	type ShaderMaterial,
	type Texture,
	type WebGLRenderer
} from 'three';
import { ensureNormals } from './geometryAttributes';
import { createGameplayTerrainGroup, createTreeLeavesGroup } from './gameplayTerrain';
import { createGameplayWaterMesh, setGameplayWaterLight } from './gameplayWater';
import { gameplayGeometryPaths, introTexturePaths } from './introAssets';
import { loadDracoGeometry } from './loadGeometry';
import { initKtx2Loader, loadKtx2Texture } from './loadTextures';
import { attachGameplayProps, createPropMaterial } from './postProcessing';
import { createTerrainMaterial } from './terrainMaterial';
import { createTreeLeavesMaterial } from './treeLeaves';

const textureLoader = new TextureLoader();

function fitGameplayGroup(group: Group, targetSize = 18) {
	group.updateMatrixWorld(true);
	const box = new Box3().setFromObject(group);
	const size = box.getSize(new Vector3());
	const scale = targetSize / Math.max(size.x, size.y, size.z, 0.001);
	const center = box.getCenter(new Vector3());
	group.scale.setScalar(scale);
	group.position.sub(center.multiplyScalar(scale));
}

const propColors = {
	cables: '#565c5f',
	waterfall1: '#739fb1',
	waterfall2: '#376f74',
	waterfall3: '#afe7eb',
	smoke: '#565c5f',
	beach: '#bcb1a4'
} as const;

export type GameplaySceneBundle = {
	group: Group;
	lut: Texture;
	terrainMaterial: ShaderMaterial;
	treeLeavesMaterial: ShaderMaterial;
	propMaterials: ShaderMaterial[];
	gameplayWater: BatchedMesh;
	gameplayWaterMaterial: ShaderMaterial;
};

export async function createGameplaySceneGroup(renderer: WebGLRenderer): Promise<GameplaySceneBundle> {
	initKtx2Loader(renderer);

	const [
		atlas,
		lut,
		noiseTerrain,
		noiseSimplex,
		waterNoise,
		cloudNoise512,
		treeLeavesTexture
	] = await Promise.all([
		textureLoader.loadAsync(introTexturePaths.atlas),
		loadKtx2Texture(introTexturePaths.lut),
		loadKtx2Texture(introTexturePaths.noiseTerrain),
		loadKtx2Texture(introTexturePaths.noiseSimplex),
		loadKtx2Texture(introTexturePaths.waterNoise),
		loadKtx2Texture(introTexturePaths.cloudNoise512),
		loadKtx2Texture(introTexturePaths.treeLeaves)
	]);

	atlas.colorSpace = SRGBColorSpace;

	const lightPosition = new Vector3(10, 16, 6);
	const terrainMaterial = createTerrainMaterial(atlas, noiseTerrain, noiseSimplex, lightPosition);
	const treeLeavesMaterial = createTreeLeavesMaterial(treeLeavesTexture, lightPosition);

	const [terrain, treeLeaves, gameplayWater] = await Promise.all([
		createGameplayTerrainGroup(terrainMaterial),
		createTreeLeavesGroup(treeLeavesMaterial),
		createGameplayWaterMesh(waterNoise, lightPosition)
	]);

	setGameplayWaterLight(gameplayWater.material as ShaderMaterial, lightPosition);

	const [
		cables1Geo,
		cables2Geo,
		waterfallGeo,
		splashGeo,
		inletGeo,
		smokeGeo,
		beachGeo
	] = await Promise.all([
		loadDracoGeometry(gameplayGeometryPaths.cables1),
		loadDracoGeometry(gameplayGeometryPaths.cables2),
		loadDracoGeometry(gameplayGeometryPaths.waterfall),
		loadDracoGeometry(gameplayGeometryPaths.waterfallSplash),
		loadDracoGeometry(gameplayGeometryPaths.waterfallInlet),
		loadDracoGeometry(gameplayGeometryPaths.smoke),
		loadDracoGeometry(gameplayGeometryPaths.beachFoam)
	]);

	for (const geometry of [cables1Geo, cables2Geo, waterfallGeo, splashGeo, inletGeo, smokeGeo, beachGeo]) {
		ensureNormals(geometry);
	}

	const cableMaterial = createPropMaterial(propColors.cables, cloudNoise512);
	const smokeMaterial = createPropMaterial(propColors.smoke, cloudNoise512);
	smokeMaterial.transparent = true;
	smokeMaterial.depthWrite = false;

	const waterfallMaterial = createPropMaterial(propColors.waterfall1, waterNoise);
	const splashMaterial = createPropMaterial(propColors.waterfall2, waterNoise);
	const inletMaterial = createPropMaterial(propColors.waterfall3, waterNoise);
	const beachMaterial = createPropMaterial(propColors.beach, waterNoise);
	const cableMaterial2 = cableMaterial.clone();

	const group = new Group();
	group.name = 'MessengerGameplay';

	group.add(terrain, treeLeaves, gameplayWater);

	attachGameplayProps(group, [
		{ name: 'Cables1', mesh: new Mesh(cables1Geo, cableMaterial) },
		{ name: 'Cables2', mesh: new Mesh(cables2Geo, cableMaterial2) },
		{ name: 'WaterfallVfx', mesh: new Mesh(waterfallGeo, waterfallMaterial) },
		{ name: 'WaterfallSplash', mesh: new Mesh(splashGeo, splashMaterial) },
		{ name: 'WaterfallInlet', mesh: new Mesh(inletGeo, inletMaterial) },
		{ name: 'Smoke', mesh: new Mesh(smokeGeo, smokeMaterial) },
		{ name: 'BeachFoam', mesh: new Mesh(beachGeo, beachMaterial) }
	]);

	fitGameplayGroup(group);

	const propMaterials = [
		cableMaterial,
		cableMaterial2,
		waterfallMaterial,
		splashMaterial,
		inletMaterial,
		smokeMaterial,
		beachMaterial
	];

	return {
		group,
		lut,
		terrainMaterial,
		treeLeavesMaterial,
		propMaterials,
		gameplayWater,
		gameplayWaterMaterial: gameplayWater.material as ShaderMaterial
	};
}

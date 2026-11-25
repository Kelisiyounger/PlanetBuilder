import { Group, Mesh, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import type { Texture, WebGLRenderer } from 'three';
import { ensureNormals } from './geometryAttributes';
import { loadDracoGeometry } from './loadGeometry';
import { introGeometryPaths, introTexturePaths } from './introAssets';
import { initKtx2Loader, loadKtx2Texture } from './loadTextures';
import { createMessengerMaterials } from './materials';

const textureLoader = new TextureLoader();

function fitGroup(group: Group, targetSize = 14) {
	group.updateMatrixWorld(true);

	let min = new Vector3(Infinity, Infinity, Infinity);
	let max = new Vector3(-Infinity, -Infinity, -Infinity);

	group.traverse((object) => {
		if (!(object instanceof Mesh)) return;
		object.geometry.computeBoundingBox();
		const geometryBox = object.geometry.boundingBox;
		if (!geometryBox) return;
		min.min(geometryBox.min);
		max.max(geometryBox.max);
	});

	const size = max.clone().sub(min);
	const scale = targetSize / Math.max(size.x, size.y, size.z);
	const center = min.clone().add(max).multiplyScalar(0.5);

	group.scale.setScalar(scale);
	group.position.sub(center.multiplyScalar(scale));
}

export type IntroSceneBundle = {
	group: Group;
	materials: ReturnType<typeof createMessengerMaterials>;
};

export type IntroSceneOptions = {
	/** Diameter the planet is fitted to. Walk mode uses a larger world. */
	targetSize?: number;
};

export async function loadIntroTextures(renderer: WebGLRenderer): Promise<{
	atlas: Texture;
	noise: Texture;
}> {
	initKtx2Loader(renderer);
	const [atlas, noise] = await Promise.all([
		textureLoader.loadAsync(introTexturePaths.atlas),
		loadKtx2Texture(introTexturePaths.cloudNoise)
	]);
	// The atlas is a colour palette; without this the shader samples sRGB bytes
	// as linear and the renderer encodes them again, washing the palette out.
	atlas.colorSpace = SRGBColorSpace;
	return { atlas, noise };
}

export async function createIntroSceneGroup(
	renderer: WebGLRenderer,
	options: IntroSceneOptions = {}
): Promise<IntroSceneBundle> {
	const textures = await loadIntroTextures(renderer);
	const materials = createMessengerMaterials(textures.atlas, textures.noise);

	const [planetGeo, waterGeo, treesGeo, cloudsGeo] = await Promise.all([
		loadDracoGeometry(introGeometryPaths.planet),
		loadDracoGeometry(introGeometryPaths.water),
		loadDracoGeometry(introGeometryPaths.trees),
		loadDracoGeometry(introGeometryPaths.clouds)
	]);

	for (const geometry of [planetGeo, waterGeo, treesGeo, cloudsGeo]) {
		ensureNormals(geometry);
	}

	const group = new Group();
	group.name = 'MessengerIntro';

	const planet = new Mesh(planetGeo, materials.atlas);
	planet.name = 'Planet';

	const water = new Mesh(waterGeo, materials.water);
	water.name = 'Water';

	const trees = new Mesh(treesGeo, materials.atlas);
	trees.name = 'Trees';

	const clouds = new Mesh(cloudsGeo, materials.clouds);
	clouds.name = 'Clouds';

	group.add(planet, water, trees, clouds);
	fitGroup(group, options.targetSize ?? 14);

	return { group, materials };
}

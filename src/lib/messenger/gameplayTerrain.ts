import { Group, Mesh, type BufferGeometry, type ShaderMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ensureNormals, ensureTerrainAttributes } from './geometryAttributes';
import { gameplayGeometryPaths } from './introAssets';
import { loadBatchedDracoGeometriesWithRig } from './skinGeometry';

/**
 * The reference splits each terrain file into hundreds of per-building batches.
 * Merging them back into one geometry per chunk keeps the preserved surfaceId /
 * elementId attributes while avoiding hundreds of draw calls.
 */
function mergeBatches(batches: BufferGeometry[]): BufferGeometry[] {
	if (batches.length <= 1) return batches;
	const merged = mergeGeometries(batches, false);
	return merged ? [merged] : batches;
}

const terrainChunkCount = 10;

export async function createGameplayTerrainGroup(material: ShaderMaterial): Promise<Group> {
	const chunkPaths = Array.from({ length: terrainChunkCount }, (_, index) =>
		gameplayGeometryPaths.terrainChunk(index)
	);

	const chunkBatches = await Promise.all(chunkPaths.map((path) => loadBatchedDracoGeometriesWithRig(path)));
	const geometries = chunkBatches.flatMap(mergeBatches);

	const terrain = new Group();
	terrain.name = 'GameplayTerrain';

	for (const [index, geometry] of geometries.entries()) {
		ensureTerrainAttributes(geometry);
		ensureNormals(geometry);
		const mesh = new Mesh(geometry, material);
		mesh.name = `TerrainBatch${index}`;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		terrain.add(mesh);
	}

	return terrain;
}

export async function createTreeLeavesGroup(material: ShaderMaterial): Promise<Group> {
	const leafPaths = Array.from({ length: 5 }, (_, index) => gameplayGeometryPaths.treeLeavesChunk(index));
	const chunkBatches = await Promise.all(leafPaths.map((path) => loadBatchedDracoGeometriesWithRig(path)));
	const geometries = chunkBatches.flatMap(mergeBatches);

	const leaves = new Group();
	leaves.name = 'TreeLeaves';

	for (const [index, geometry] of geometries.entries()) {
		ensureNormals(geometry);
		const mesh = new Mesh(geometry, material);
		mesh.name = `TreeLeavesBatch${index}`;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		leaves.add(mesh);
	}

	return leaves;
}

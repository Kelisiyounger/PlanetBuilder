import { BatchedMesh, Color, RepeatWrapping, ShaderMaterial, Vector2, type Texture, Vector3 } from 'three';
import { createBatchedMeshFromGeometries } from './batchedMesh';
import { ensureNormals } from './geometryAttributes';
import { gameplayGeometryPaths } from './introAssets';
import { loadBatchedDracoGeometries } from './loadGeometry';
import {
	gameplayWaterFragmentShader,
	gameplayWaterVertexShader
} from './shaders/gameplayWater.glsl';

const gameplayWaterColors = {
	uColor1: '#4c868c',
	uColor2: '#437a7f',
	uColorWaves1: '#366a6f',
	uColorWaves2: '#6facb2'
} as const;

export function createGameplayWaterMaterial(
	noise: Texture,
	lightPosition = new Vector3(10, 16, 6),
	cameraNear = 0.1,
	cameraFar = 500
): ShaderMaterial {
	noise.wrapS = RepeatWrapping;
	noise.wrapT = RepeatWrapping;

	return new ShaderMaterial({
		name: 'GameplayWater',
		transparent: true,
		depthWrite: true,
		uniforms: {
			uColor1: { value: new Color(gameplayWaterColors.uColor1) },
			uColor2: { value: new Color(gameplayWaterColors.uColor2) },
			uColorWaves1: { value: new Color(gameplayWaterColors.uColorWaves1) },
			uColorWaves2: { value: new Color(gameplayWaterColors.uColorWaves2) },
			tNoise: { value: noise },
			tSceneDepth: { value: null },
			uResolution: { value: new Vector2(1, 1) },
			uTime: { value: 0 },
			uUseSceneDepth: { value: 0 },
			uCameraNear: { value: cameraNear },
			uCameraFar: { value: cameraFar },
			uLightPosition: { value: lightPosition.clone() }
		},
		vertexShader: gameplayWaterVertexShader,
		fragmentShader: gameplayWaterFragmentShader
	});
}

export async function createGameplayWaterMesh(
	noise: Texture,
	lightPosition?: Vector3,
	cameraNear = 0.1,
	cameraFar = 500
): Promise<BatchedMesh> {
	const batches = await loadBatchedDracoGeometries(gameplayGeometryPaths.gameplayWater);
	for (const batch of batches) {
		ensureNormals(batch);
	}

	const material = createGameplayWaterMaterial(noise, lightPosition, cameraNear, cameraFar);
	return createBatchedMeshFromGeometries(batches, material, 'GameplayWater');
}

export function updateGameplayWaterMaterial(material: ShaderMaterial, elapsed: number): void {
	material.uniforms.uTime.value = elapsed;
}

export function setGameplayWaterLight(material: ShaderMaterial, lightPosition: Vector3): void {
	material.uniforms.uLightPosition.value.copy(lightPosition);
}

export function setGameplayWaterDepth(
	material: ShaderMaterial,
	depthTexture: Texture | null,
	width: number,
	height: number
): void {
	material.uniforms.tSceneDepth.value = depthTexture;
	material.uniforms.uResolution.value.set(width, height);
	material.uniforms.uUseSceneDepth.value = depthTexture ? 1 : 0;
}

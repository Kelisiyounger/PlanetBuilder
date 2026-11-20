import {
	Color,
	DoubleSide,
	RepeatWrapping,
	ShaderMaterial,
	type Texture,
	Vector3
} from 'three';
import {
	atlasFragmentShader,
	atlasVertexShader,
	cloudFragmentShader,
	cloudVertexShader,
	waterFragmentShader,
	waterVertexShader
} from './shaders/messengerMaterials.glsl';

export type MessengerMaterialSet = {
	atlas: ShaderMaterial;
	water: ShaderMaterial;
	clouds: ShaderMaterial;
	lightPosition: Vector3;
};

function configureNoiseTexture(texture: Texture): Texture {
	texture.wrapS = RepeatWrapping;
	texture.wrapT = RepeatWrapping;
	texture.needsUpdate = true;
	return texture;
}

export function createMessengerMaterials(
	atlas: Texture,
	noise: Texture,
	lightPosition = new Vector3(10, 16, 6)
): MessengerMaterialSet {
	const noiseTexture = configureNoiseTexture(noise);
	const light = lightPosition.clone();

	const atlasMaterial = new ShaderMaterial({
		uniforms: {
			tAtlas: { value: atlas },
			uLightPosition: { value: light }
		},
		vertexShader: atlasVertexShader,
		fragmentShader: atlasFragmentShader
	});

	const waterMaterial = new ShaderMaterial({
		transparent: true,
		uniforms: {
			tAtlas: { value: atlas },
			tNoise: { value: noiseTexture },
			uTime: { value: 0 },
			uLightPosition: { value: light }
		},
		vertexShader: waterVertexShader,
		fragmentShader: waterFragmentShader
	});

	const cloudMaterial = new ShaderMaterial({
		transparent: true,
		side: DoubleSide,
		depthWrite: false,
		uniforms: {
			uColor: { value: new Color('#f8f8f8') },
			tNoise: { value: noiseTexture },
			uTime: { value: 0 },
			uLightPosition: { value: light }
		},
		vertexShader: cloudVertexShader,
		fragmentShader: cloudFragmentShader
	});

	return {
		atlas: atlasMaterial,
		water: waterMaterial,
		clouds: cloudMaterial,
		lightPosition: light
	};
}

export function updateMessengerMaterials(materials: MessengerMaterialSet, elapsed: number): void {
	materials.water.uniforms.uTime.value = elapsed;
	materials.clouds.uniforms.uTime.value = elapsed;
}

/**
 * A private copy of the atlas material for the skinned character.
 *
 * `materials.atlas` is shared with the planet and the trees, so it must not be
 * mutated. The clone additionally enables MESSENGER_WORLD_NORMAL: the character
 * is viewed from an orbiting camera, where the stock view-space normal dotted
 * against a world-space light direction makes the lit side swim.
 */
export function createCharacterMaterial(materials: MessengerMaterialSet): ShaderMaterial {
	const material = materials.atlas.clone();
	material.defines = { ...material.defines, MESSENGER_WORLD_NORMAL: '' };

	// cloneUniforms() deep-copies, which would give us a second Vector3 the light
	// updates never reach and a duplicate GPU texture. Point both back at the
	// originals so setMessengerLight keeps working on this material too.
	material.uniforms.uLightPosition.value = materials.lightPosition;
	material.uniforms.tAtlas.value = materials.atlas.uniforms.tAtlas.value;

	return material;
}

export function setMessengerLight(materials: MessengerMaterialSet, lightPosition: Vector3): void {
	materials.lightPosition.copy(lightPosition);
	materials.atlas.uniforms.uLightPosition.value.copy(lightPosition);
	materials.water.uniforms.uLightPosition.value.copy(lightPosition);
	materials.clouds.uniforms.uLightPosition.value.copy(lightPosition);
}

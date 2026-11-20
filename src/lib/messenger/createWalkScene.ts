import { Mesh, type Group, type Object3D, type ShaderMaterial, type WebGLRenderer } from 'three';
import { createIntroSceneGroup } from './createIntroScene';
import { createCharacterMaterial, type MessengerMaterialSet } from './materials';
import { buildPlanetCollisionIndex, combineCollisionIndices, type PlanetCollisionIndex } from './planetCollision';
import { createWalkInput } from './pointerLook';
import { createWalkController, type WalkController } from './walkController';
import { createWalkRig, type WalkRig } from './walkCharacter';

export type WalkSceneBundle = {
	/** The intro planet group, reused as-is. */
	group: Group;
	materials: MessengerMaterialSet;
	character: Object3D;
	controller: WalkController;
	/** Exposed so callers can probe the ground the character stands on. */
	collision: PlanetCollisionIndex;
	dispose(): void;
};

export type WalkSceneOptions = {
	/** Fires when pointer lock is taken or released, for the on-screen hint. */
	onLockChange?(locked: boolean): void;
};

/**
 * The walker lives on the *intro* planet, so this reuses `createIntroSceneGroup`
 * rather than duplicating the planet, water, trees and clouds.
 *
 * The character is added to the scene directly, NOT to the returned group: that
 * group carries `fitGroup`'s 0.1718 scale, which must not leak into the
 * character's world transform.
 */
export async function createWalkSceneGroup(
	renderer: WebGLRenderer,
	options: WalkSceneOptions = {}
): Promise<WalkSceneBundle> {
	const intro = await createIntroSceneGroup(renderer);

	intro.group.updateMatrixWorld(true);
	const planet = intro.group.getObjectByName('Planet');
	if (!(planet instanceof Mesh)) {
		throw new Error('Intro scene is missing its Planet mesh.');
	}

	// The cloud band is a decorative shell meant to be seen from orbit. At ground
	// level the camera sits inside it, so it slices across the avatar and the
	// terrain through its transparent, depth-write-disabled material.
	const clouds = intro.group.getObjectByName('Clouds');
	if (clouds) clouds.visible = false;

	const terrainIndex = buildPlanetCollisionIndex(planet);

	// The sea is a shell below the terrain; folding it in keeps the walker on the
	// water instead of dropping into a drained basin.
	const water = intro.group.getObjectByName('Water');
	const surfaces = [terrainIndex];
	if (water instanceof Mesh) {
		surfaces.push(buildPlanetCollisionIndex(water, terrainIndex.center));
	}
	const collision: PlanetCollisionIndex = combineCollisionIndices(surfaces);

	// The tree layer spans the same radius band the camera sits in, so without
	// this the boom parks inside a canopy and the avatar disappears behind
	// leaves. Trees stay out of the ground query: the character walks through
	// them, and including them would stand it on the treetops.
	const trees = intro.group.getObjectByName('Trees');
	const cameraCollision: PlanetCollisionIndex =
		trees instanceof Mesh
			? combineCollisionIndices([...surfaces, buildPlanetCollisionIndex(trees, terrainIndex.center)])
			: collision;

	// materials.atlas is shared with the planet and trees, so the character needs
	// its own copy.
	const characterMaterial = createCharacterMaterial(intro.materials);
	const rig: WalkRig = await createWalkRig(characterMaterial);

	const input = createWalkInput(renderer.domElement);
	input.onLockChange = (locked) => options.onLockChange?.(locked);

	const controller = createWalkController({
		object: rig.object,
		collision,
		input,
		height: rig.height,
		mixer: rig.mixer,
		clips: rig.clips,
		cameraCollision
	});

	return {
		group: intro.group,
		materials: intro.materials,
		character: rig.object,
		controller,
		collision,
		dispose() {
			controller.dispose();
			input.dispose();
			rig.dispose();
			collision.dispose();
			(characterMaterial as ShaderMaterial).dispose();
		}
	};
}

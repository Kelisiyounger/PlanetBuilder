import { AnimationMixer, Mesh, type AnimationClip, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ensureNormals } from './geometryAttributes';
import { avatarAccessoryPaths, avatarPaths, walkCharacterPaths } from './introAssets';
import { loadDracoGeometry } from './loadGeometry';
import { loadDracoGeometryWithRig } from './skinGeometry';
import { createSkin, createSkinAnimation } from './skinMesh';

/** The walker is about a third of the intro planet's radius, so it reads clearly. */
export const CHARACTER_HEIGHT = 1.6;

export type WalkRig = {
	object: Object3D;
	skinned: boolean;
	mixer: AnimationMixer | null;
	clips: { idle: AnimationClip | null; walk: AnimationClip | null };
	height: number;
	dispose(): void;
};

type RigPaths = {
	model: string;
	bones: string;
	idle: string;
	walk: string;
};

async function loadSkinnedRig(
	paths: RigPaths,
	material: Material,
	height: number,
	source: 'avatar' | 'office-worker',
	accessoryPaths: readonly string[] = []
): Promise<WalkRig> {
	const [model, bones, idle, walk, ...accessories] = await Promise.all([
		loadDracoGeometryWithRig(paths.model),
		loadDracoGeometryWithRig(paths.bones),
		loadDracoGeometryWithRig(paths.idle),
		loadDracoGeometryWithRig(paths.walk),
		...accessoryPaths.map((path) => loadDracoGeometryWithRig(path))
	]);

	// The avatar body and its clothing share the same attribute layout, so one
	// merged skinned mesh renders the whole outfit in a single draw.
	const sourceGeometries = [model, ...accessories];
	const merged = accessoryPaths.length > 0 ? mergeGeometries(sourceGeometries, false) : null;
	if (accessoryPaths.length > 0 && !merged) {
		console.warn('Avatar accessories could not be merged; using the body only.');
	}
	const body = merged ?? model;
	if (merged) {
		for (const geometry of sourceGeometries) geometry.dispose();
	}

	const mesh = createSkin(body, bones, material);
	mesh.name = 'WalkCharacter';
	mesh.userData.rigSource = source;

	body.computeBoundingBox();
	const box = body.boundingBox;
	const nativeHeight = box ? box.max.y - box.min.y : 0;
	// The model's origin is already at the feet, so the root sits exactly on
	// the ground hit -- no vertical fudge, unlike the gallery's placement.
	if (nativeHeight > 0) mesh.scale.setScalar(height / nativeHeight);
	// Always on screen; also avoids a bind-pose bounding sphere culling it.
	mesh.frustumCulled = false;

	const clips = {
		idle: createSkinAnimation('idle', idle),
		walk: createSkinAnimation('walk', walk)
	};
	if (!clips.walk || clips.walk.duration <= 0) {
		console.warn('Walk clip has no duration; the character will not animate.');
	}

	return {
		object: mesh,
		skinned: true,
		mixer: new AnimationMixer(mesh),
		clips,
		height,
		dispose() {
			body.dispose();
			bones.dispose();
			idle.dispose();
			walk.dispose();
			if (!merged) {
				for (const geometry of accessories) geometry.dispose();
			}
		}
	};
}

/**
 * Builds the avatar from the original player set when it has been mirrored,
 * then falls back to the office-worker NPC -- the only NPC in the current
 * mirror with a walk cycle.
 *
 * The final fallback is a static mesh, mirroring the NPC gallery, so a missing
 * attribute costs the animation rather than the scene.
 */
export async function createWalkRig(
	material: Material,
	height = CHARACTER_HEIGHT
): Promise<WalkRig> {
	try {
		return await loadSkinnedRig(
			avatarPaths,
			material,
			height,
			'avatar',
			Object.values(avatarAccessoryPaths)
		);
	} catch (error) {
		console.info('Avatar assets unavailable, using office-worker.', error);
	}

	try {
		return await loadSkinnedRig(walkCharacterPaths, material, height, 'office-worker');
	} catch (error) {
		console.warn('Character skin rig unavailable, using static mesh.', error);
	}

	const model = await loadDracoGeometry(walkCharacterPaths.model);
	ensureNormals(model);
	model.computeBoundingBox();
	const box = model.boundingBox;
	const nativeHeight = box ? box.max.y - box.min.y : 0;

	const mesh = new Mesh(model, material);
	mesh.name = 'WalkCharacter';
	mesh.userData.rigSource = 'static';
	if (nativeHeight > 0) mesh.scale.setScalar(height / nativeHeight);

	return {
		object: mesh,
		skinned: false,
		mixer: null,
		clips: { idle: null, walk: null },
		height,
		dispose() {
			model.dispose();
		}
	};
}

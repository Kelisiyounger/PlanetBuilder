import { AnimationMixer, Mesh, type AnimationClip, type Material, type Object3D } from 'three';
import { walkCharacterPaths } from './introAssets';
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

/**
 * Builds the avatar from the office-worker set -- the only NPC in the bundle
 * with a walk cycle.
 *
 * Degrades to a static mesh if the rig fails to decode, mirroring the NPC
 * gallery, so a missing attribute costs the animation rather than the scene.
 */
export async function createWalkRig(
	material: Material,
	height = CHARACTER_HEIGHT
): Promise<WalkRig> {
	const disposables: { dispose(): void }[] = [];

	try {
		const [model, bones, idle, walk] = await Promise.all([
			loadDracoGeometryWithRig(walkCharacterPaths.model),
			loadDracoGeometryWithRig(walkCharacterPaths.bones),
			loadDracoGeometryWithRig(walkCharacterPaths.idle),
			loadDracoGeometryWithRig(walkCharacterPaths.walk)
		]);

		const mesh = createSkin(model, bones, material);
		mesh.name = 'WalkCharacter';

		model.computeBoundingBox();
		const box = model.boundingBox;
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

		disposables.push(model, bones, idle, walk);

		return {
			object: mesh,
			skinned: true,
			mixer: new AnimationMixer(mesh),
			clips,
			height,
			dispose() {
				for (const item of disposables) item.dispose();
			}
		};
	} catch (error) {
		console.warn('Character skin rig unavailable, using static mesh.', error);

		const model = await loadDracoGeometry(walkCharacterPaths.model);
		model.computeVertexNormals();
		model.computeBoundingBox();
		const box = model.boundingBox;
		const nativeHeight = box ? box.max.y - box.min.y : 0;

		const mesh = new Mesh(model, material);
		mesh.name = 'WalkCharacter';
		if (nativeHeight > 0) mesh.scale.setScalar(height / nativeHeight);

		disposables.push(model);

		return {
			object: mesh,
			skinned: false,
			mixer: null,
			clips: { idle: null, walk: null },
			height,
			dispose() {
				for (const item of disposables) item.dispose();
			}
		};
	}
}

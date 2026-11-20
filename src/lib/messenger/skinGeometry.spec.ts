import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readDracoInfoMetadata } from './skinGeometry';

// The rig/animation attributes only survive decoding if we can read the `info`
// metadata out of each .drc and hand three explicit unique ids, so this file is
// the regression trap for the whole skinned-character path.
const asset = (relative: string) =>
	fileURLToPath(new URL(`../../../static/messenger/${relative}`, import.meta.url));

function readBuffer(relative: string): ArrayBuffer {
	const file = readFileSync(asset(relative));
	return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

function attributeNames(relative: string): string[] {
	const metadata = readDracoInfoMetadata(readBuffer(relative));
	if (!metadata) throw new Error(`no info metadata in ${relative}`);
	return metadata.attributes.map(([name]) => name);
}

function userDataOf(relative: string): Record<string, unknown> {
	const metadata = readDracoInfoMetadata(readBuffer(relative));
	if (!metadata) throw new Error(`no info metadata in ${relative}`);
	return metadata.userData ?? {};
}

const NPC = 'geometries/npcs/present/office-worker';

describe('readDracoInfoMetadata', () => {
	it('lists the model attributes in decode order, including the skin attributes', () => {
		// `position` is NOT first -- the unique id is the metadata index, not a
		// semantic ordering, which is exactly why the stock loader loses the rig.
		expect(attributeNames(`${NPC}/office-worker.drc`)).toEqual([
			'skinIndex',
			'skinWeight',
			'position',
			'normal',
			'uv',
			'surfaceId'
		]);
	});

	it('lists the bone rig attributes', () => {
		expect(attributeNames(`${NPC}/office-worker-bones.drc`)).toEqual([
			'position',
			'quaternion',
			'scale',
			'hierarchy'
		]);
	});

	it('lists the animation attributes', () => {
		expect(attributeNames(`${NPC}/office-worker-walk.drc`)).toEqual([
			'position',
			'quaternion',
			'scale'
		]);
	});

	it('reads the frame count and fps that createSkinAnimation needs', () => {
		// A zero-length clip is what you get without this, and the gallery then
		// silently plays nothing.
		expect(userDataOf(`${NPC}/office-worker-walk.drc`)).toMatchObject({ fps: 24, frames: 36 });
		expect(userDataOf(`${NPC}/office-worker-idle.drc`)).toMatchObject({ fps: 24, frames: 379 });
	});

	it('reports every attribute as a known Draco typed-array kind', () => {
		const metadata = readDracoInfoMetadata(readBuffer(`${NPC}/office-worker.drc`));
		expect(metadata?.attributes.every(([, type]) => type >= 0 && type <= 8)).toBe(true);
	});

	it('returns null instead of throwing on unusable input', () => {
		expect(readDracoInfoMetadata(new ArrayBuffer(4))).toBeNull();
		expect(readDracoInfoMetadata(new Uint8Array(64).buffer)).toBeNull();

		// Valid magic, truncated body.
		const truncated = readBuffer(`${NPC}/office-worker-walk.drc`).slice(0, 24);
		expect(readDracoInfoMetadata(truncated)).toBeNull();
	});
});

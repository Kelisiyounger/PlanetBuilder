import type { BufferGeometry } from 'three';
import { getDracoLoader } from './loadGeometry';

/**
 * three's DRACOLoader resolves attributes by Draco *type*
 * (`{ position: 'POSITION', normal: 'NORMAL', uv: 'TEX_COORD', ... }`), so every
 * custom attribute the original exporter wrote -- `skinIndex`, `skinWeight`,
 * and the whole bone rig (`quaternion`/`scale`/`hierarchy`) -- is silently
 * dropped. That is why `createSkin` throws "Bones geometry is missing skin rig
 * attributes" and the NPC gallery always falls back to a static mesh.
 *
 * The exporter writes a plaintext JSON blob named `info` right after the header,
 * listing every attribute in decode order along with its typed-array kind and,
 * for animation files, the frame count. Reading it back lets us drive
 * `decodeDracoFile` with explicit unique IDs instead (the loader sets
 * `useUniqueIDs: !!attributeIDs`, see three/examples/jsm/loaders/DRACOLoader.js).
 */

/** Draco `DataType` enum -> TypedArray name, as written into the `info` metadata. */
const DRACO_TYPES = [
	'Int8Array',
	'Uint8Array',
	'Uint8ClampedArray',
	'Int16Array',
	'Uint16Array',
	'Int32Array',
	'Uint32Array',
	'Float32Array',
	'Float64Array'
] as const;

export type SkinAnimationUserData = {
	frames?: number;
	fps?: number;
};

export type DracoInfoMetadata = {
	/** `[attributeName, dracoDataType]` in decode order; the index *is* the unique id. */
	attributes: Array<[string, number]>;
	userData?: SkinAnimationUserData;
};

const decoder = new TextDecoder();

/** LEB128 varint. Lengths above 127 use two bytes (e.g. the tree-leaves metadata). */
function readVarint(bytes: Uint8Array, offset: number): [value: number, next: number] {
	let value = 0;
	let shift = 0;
	let byte: number;
	do {
		byte = bytes[offset++];
		value += (byte & 0x7f) * 2 ** shift;
		shift += 7;
	} while (byte & 0x80);
	return [value, offset];
}

function readLengthPrefixed(bytes: Uint8Array, offset: number): [text: string, next: number] {
	const [length, start] = readVarint(bytes, offset);
	return [decoder.decode(bytes.subarray(start, start + length)), start + length];
}

/**
 * Reads the `info` blob the exporter writes straight after the 11-byte header:
 * `DRACO`(5) major(1) minor(1) encoderType(1) method(1) flags(2), then the
 * attribute-metadata list (always empty in this asset set) and the file
 * metadata list containing `info` -> JSON.
 *
 * Returns null rather than throwing for anything unexpected, so callers can fall
 * back to the plain loader.
 */
export function readDracoInfoMetadata(buffer: ArrayBuffer): DracoInfoMetadata | null {
	const bytes = new Uint8Array(buffer);
	if (bytes.length < 12) return null;
	if (decoder.decode(bytes.subarray(0, 5)) !== 'DRACO') return null;

	try {
		let offset = 11;

		// Per-attribute metadata blocks: a unique id followed by a metadata record.
		const [attributeBlocks, afterAttributeCount] = readVarint(bytes, offset);
		offset = afterAttributeCount;
		for (let index = 0; index < attributeBlocks; index++) {
			const [, afterId] = readVarint(bytes, offset);
			offset = skipMetadata(bytes, afterId);
		}

		const [entryCount, afterEntryCount] = readVarint(bytes, offset);
		offset = afterEntryCount;
		for (let index = 0; index < entryCount; index++) {
			const [name, afterName] = readLengthPrefixed(bytes, offset);
			const [value, afterValue] = readLengthPrefixed(bytes, afterName);
			offset = afterValue;
			if (name === 'info') return JSON.parse(value) as DracoInfoMetadata;
		}
		return null;
	} catch {
		return null;
	}
}

/** Advances past a `Metadata` record: sub-metadata entries then key/value entries. */
function skipMetadata(bytes: Uint8Array, offset: number): number {
	const [subMetadataCount, afterSubCount] = readVarint(bytes, offset);
	offset = afterSubCount;
	for (let index = 0; index < subMetadataCount; index++) {
		const [, afterKey] = readLengthPrefixed(bytes, offset);
		offset = skipMetadata(bytes, afterKey);
	}

	const [entryCount, afterEntryCount] = readVarint(bytes, offset);
	offset = afterEntryCount;
	for (let index = 0; index < entryCount; index++) {
		const [, afterKey] = readLengthPrefixed(bytes, offset);
		const [, afterValue] = readLengthPrefixed(bytes, afterKey);
		offset = afterValue;
	}

	return offset;
}

/**
 * three's bundled `DRACOLoader` typings stop at `load`/`parse` and omit
 * `decodeDracoFile`, which is the only entry point that accepts explicit
 * attribute ids (`useUniqueIDs: !!attributeIDs`). The method is present at
 * runtime -- see three/examples/jsm/loaders/DRACOLoader.js.
 */
type DracoLoaderWithUniqueIds = {
	decodeDracoFile(
		buffer: ArrayBuffer,
		callback: (geometry: BufferGeometry) => void,
		attributeIDs?: Record<string, number> | null,
		attributeTypes?: Record<string, string> | null,
		vertexColorSpace?: unknown,
		onError?: (error: unknown) => void
	): Promise<BufferGeometry>;
};

/**
 * Decodes a `.drc` preserving its own attribute names (`skinIndex`,
 * `skinWeight`, `quaternion`, `scale`, `hierarchy`, ...) and copies the metadata
 * `userData` onto the geometry so `createSkinAnimation` can read `frames`/`fps`.
 *
 * The caller must pass a private ArrayBuffer -- three transfers it to its worker.
 */
export async function loadDracoGeometryWithRig(path: string): Promise<BufferGeometry> {
	const buffer = await fetch(path).then((response) => response.arrayBuffer());
	const metadata = readDracoInfoMetadata(buffer.slice(0));
	if (!metadata) {
		throw new Error(`No Draco "info" metadata in ${path}`);
	}

	const attributeIDs: Record<string, number> = {};
	const attributeTypes: Record<string, string> = {};
	metadata.attributes.forEach(([name, type], uniqueId) => {
		attributeIDs[name] = uniqueId;
		attributeTypes[name] = DRACO_TYPES[type];
	});

	const loader = getDracoLoader() as unknown as DracoLoaderWithUniqueIds;
	const geometry = await new Promise<BufferGeometry>((resolve, reject) => {
		// `undefined` keeps three's default vertex colour space.
		void loader.decodeDracoFile(buffer, resolve, attributeIDs, attributeTypes, undefined, reject);
	});

	geometry.userData = (metadata.userData ?? {}) as Record<string, unknown>;
	return geometry;
}

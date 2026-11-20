import { Vector3, type Mesh } from 'three';

/**
 * A theta/phi bucket index over the planet's triangles, for radial ground
 * queries only.
 *
 * Why not `Mesh.raycast`: it loops every triangle with no spatial early-out, so
 * each ray costs ~2-4 ms over the planet's 59k triangles -- most of a frame
 * budget for the two queries the walker needs. Bucketing cuts the candidates to
 * a few dozen triangles and costs ~10-20 us per query instead.
 *
 * Why not a precomputed height map: it would smooth cliffs, buildings and the
 * tree line into the ground. Why not a BVH: it is a new runtime dependency for
 * a single rigid-sphere query. If this index ever misbehaves, swapping
 * `three-mesh-bvh`'s `raycastFirst` in behind this same interface is ~15 lines.
 *
 * Known limitation: a radial ray finds the outermost surface, so an arch or
 * overhang puts the walker on the roof. Acceptable for a stylised planet.
 */

export type GroundHit = {
	hit: boolean;
	radius: number;
	normal: Vector3;
};

export type PlanetCollisionIndex = {
	/** Planet centre in world space; `up` for the walker is `position - center`. */
	readonly center: Vector3;
	readonly maxRadius: number;
	/** Outermost surface along `direction`, measured from `center`. */
	queryRadial(direction: Vector3, out: GroundHit): GroundHit;
	dispose(): void;
};

/** Latitude rows. Cell arc is ~0.24 world units at the intro planet's scale. */
const THETA_BANDS = 64;

const MIN_PHI_CELLS = 8;

const TWO_PI = Math.PI * 2;

function wrapPhi(phi: number): number {
	const wrapped = phi % TWO_PI;
	return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function cellOfPhi(phi: number, cells: number): number {
	return Math.min(cells - 1, Math.floor((wrapPhi(phi) / TWO_PI) * cells));
}

/**
 * Treats the outermost of several surfaces as the ground.
 *
 * Used to fold the water shell into the terrain: without it the walker drops
 * into a drained-looking sea basin, because the planet mesh alone bottoms out
 * below the water surface. The result is that the character walks on the sea
 * rather than under it, which suits the stylised planet.
 */
export function combineCollisionIndices(
	surfaces: PlanetCollisionIndex[]
): PlanetCollisionIndex {
	if (surfaces.length === 1) return surfaces[0];
	const [primary, ...rest] = surfaces;
	const alternate: GroundHit = { hit: false, radius: 0, normal: new Vector3() };

	return {
		center: primary.center,
		get maxRadius() {
			let max = 0;
			for (const surface of surfaces) max = Math.max(max, surface.maxRadius);
			return max;
		},
		queryRadial(direction: Vector3, out: GroundHit): GroundHit {
			primary.queryRadial(direction, out);
			for (const surface of rest) {
				surface.queryRadial(direction, alternate);
				if (alternate.hit && (!out.hit || alternate.radius > out.radius)) {
					out.hit = true;
					out.radius = alternate.radius;
					out.normal.copy(alternate.normal);
				}
			}
			return out;
		},
		dispose() {
			for (const surface of surfaces) surface.dispose();
		}
	};
}

export function buildPlanetCollisionIndex(planet: Mesh, centerOverride?: Vector3): PlanetCollisionIndex {
	planet.updateMatrixWorld(true);

	const geometry = planet.geometry;
	const source = geometry.attributes.position;
	const vertexCount = source.count;
	const index = geometry.index;
	const triangleCount = index ? index.count / 3 : vertexCount / 3;

	// Bake the world transform so every query is plain world space; the intro
	// group's 0.1718 scale then never leaks into the movement maths.
	const positions = new Float32Array(vertexCount * 3);
	const scratch = new Vector3();
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;

	for (let vertex = 0; vertex < vertexCount; vertex++) {
		scratch.fromBufferAttribute(source, vertex).applyMatrix4(planet.matrixWorld);
		positions[vertex * 3] = scratch.x;
		positions[vertex * 3 + 1] = scratch.y;
		positions[vertex * 3 + 2] = scratch.z;
		if (scratch.x < minX) minX = scratch.x;
		if (scratch.y < minY) minY = scratch.y;
		if (scratch.z < minZ) minZ = scratch.z;
		if (scratch.x > maxX) maxX = scratch.x;
		if (scratch.y > maxY) maxY = scratch.y;
		if (scratch.z > maxZ) maxZ = scratch.z;
	}

	// fitGroup centres the planet's bounding box on the origin, so this lands
	// within a few percent of the true sphere centre. Meshes sharing a group
	// (the water shell) must be built with the planet's centre, or the two
	// indices would measure radii from different origins.
	const center =
		centerOverride?.clone() ??
		new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);

	const localX = new Float32Array(vertexCount);
	const localY = new Float32Array(vertexCount);
	const localZ = new Float32Array(vertexCount);
	const radius = new Float32Array(vertexCount);
	let maxRadius = 0;

	for (let vertex = 0; vertex < vertexCount; vertex++) {
		const x = positions[vertex * 3] - center.x;
		const y = positions[vertex * 3 + 1] - center.y;
		const z = positions[vertex * 3 + 2] - center.z;
		localX[vertex] = x;
		localY[vertex] = y;
		localZ[vertex] = z;
		const length = Math.hypot(x, y, z);
		radius[vertex] = length;
		if (length > maxRadius) maxRadius = length;
	}

	// Narrow phi rows near the poles so cells stay roughly square.
	const bandCells = new Int32Array(THETA_BANDS);
	for (let band = 0; band < THETA_BANDS; band++) {
		const theta = ((band + 0.5) / THETA_BANDS) * Math.PI;
		bandCells[band] = Math.max(MIN_PHI_CELLS, Math.round(2 * THETA_BANDS * Math.sin(theta)));
	}
	const bandStart = new Int32Array(THETA_BANDS + 1);
	for (let band = 0; band < THETA_BANDS; band++) {
		bandStart[band + 1] = bandStart[band] + bandCells[band];
	}
	const cellCount = bandStart[THETA_BANDS];
	const thetaStep = Math.PI / THETA_BANDS;

	const thetaOf = (vertex: number) =>
		Math.acos(Math.min(1, Math.max(-1, localY[vertex] / (radius[vertex] || 1))));

	// Pass 1: work out which cells each triangle touches.
	//
	// The (theta, phi) image of a triangle is not the triangle of its projected
	// vertices -- the parametrisation is curved, so a large triangle bows outside
	// its vertex bounding box in BOTH angles. The triangle lies within the union
	// of three discs of radius `longest edge` centred on its vertices, so padding
	// both ranges by that angular half-size is what keeps the bucket conservative.
	const counts = new Int32Array(cellCount);
	const cellLists: number[] = [];
	const listStart = new Int32Array(triangleCount);

	for (let triangle = 0; triangle < triangleCount; triangle++) {
		const a = index ? index.getX(triangle * 3) : triangle * 3;
		const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
		const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;

		const phis = [
			Math.atan2(localZ[a], localX[a]),
			Math.atan2(localZ[b], localX[b]),
			Math.atan2(localZ[c], localX[c])
		];
		let phiMin = Math.min(phis[0], phis[1], phis[2]);
		let phiMax = Math.max(phis[0], phis[1], phis[2]);
		if (phiMax - phiMin > Math.PI) {
			// Straddles the +/-pi seam; lift the low half so the span stays small.
			for (let i = 0; i < 3; i++) if (phis[i] < Math.PI) phis[i] += TWO_PI;
			phiMin = Math.min(phis[0], phis[1], phis[2]);
			phiMax = Math.max(phis[0], phis[1], phis[2]);
		}

		const thetas = [thetaOf(a), thetaOf(b), thetaOf(c)];

		const edgeAB = Math.hypot(localX[a] - localX[b], localY[a] - localY[b], localZ[a] - localZ[b]);
		const edgeBC = Math.hypot(localX[b] - localX[c], localY[b] - localY[c], localZ[b] - localZ[c]);
		const edgeCA = Math.hypot(localX[c] - localX[a], localY[c] - localY[a], localZ[c] - localZ[a]);
		const meanRadius = (radius[a] + radius[b] + radius[c]) / 3 || 1;
		const pad = Math.min(0.6, Math.max(edgeAB, edgeBC, edgeCA) / meanRadius);

		const thetaMin = Math.max(0, Math.min(thetas[0], thetas[1], thetas[2]) - pad);
		const thetaMax = Math.min(Math.PI, Math.max(thetas[0], thetas[1], thetas[2]) + pad);
		const bandLo = Math.min(THETA_BANDS - 1, Math.max(0, Math.floor(thetaMin / thetaStep)));
		const bandHi = Math.min(THETA_BANDS - 1, Math.max(0, Math.floor(thetaMax / thetaStep)));

		const phiLo = phiMin - pad;
		const phiHi = phiMax + pad;

		listStart[triangle] = cellLists.length;

		for (let band = bandLo; band <= bandHi; band++) {
			const cells = bandCells[band];
			// One extra cell of margin so a query landing just outside the padded
			// range still reaches this bucket.
			const cellArc = TWO_PI / cells;
			const lo = cellOfPhi(phiLo - cellArc, cells);
			const hi = cellOfPhi(phiHi + cellArc, cells);
			// The padded span may wrap the seam, in which case the whole row is in range.
			const spansWholeRow = phiHi - phiLo + 2 * cellArc >= TWO_PI || lo > hi;
			const from = spansWholeRow ? 0 : lo;
			const to = spansWholeRow ? cells - 1 : hi;

			for (let cell = from; cell <= to; cell++) {
				const global = bandStart[band] + cell;
				cellLists.push(global);
				counts[global]++;
			}
		}
	}

	// Pass 2: CSR scatter.
	const offsets = new Int32Array(cellCount + 1);
	for (let cell = 0; cell < cellCount; cell++) offsets[cell + 1] = offsets[cell] + counts[cell];

	const cursor = offsets.slice(0, cellCount);
	const entries = new Int32Array(offsets[cellCount]);
	for (let triangle = 0; triangle < triangleCount; triangle++) {
		const start = listStart[triangle];
		const end = triangle + 1 < triangleCount ? listStart[triangle + 1] : cellLists.length;
		for (let slot = start; slot < end; slot++) {
			const cell = cellLists[slot];
			entries[cursor[cell]++] = triangle;
		}
	}

	// --- query ---------------------------------------------------------------

	const rayOrigin = new Vector3();
	const rayDirection = new Vector3();
	const edge1 = new Vector3();
	const edge2 = new Vector3();
	const pvec = new Vector3();
	const tvec = new Vector3();
	const qvec = new Vector3();
	const vertexA = new Vector3();
	const vertexB = new Vector3();
	const vertexC = new Vector3();

	function loadVertex(target: Vector3, vertex: number): void {
		target.set(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
	}

	/** Moller-Trumbore; returns the ray parameter, or -1 for a miss. */
	function testTriangle(triangle: number): number {
		const a = index ? index.getX(triangle * 3) : triangle * 3;
		const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
		const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;

		loadVertex(vertexA, a);
		loadVertex(vertexB, b);
		loadVertex(vertexC, c);

		edge1.subVectors(vertexB, vertexA);
		edge2.subVectors(vertexC, vertexA);
		pvec.crossVectors(rayDirection, edge2);
		const determinant = edge1.dot(pvec);
		if (Math.abs(determinant) < 1e-12) return -1;

		const inverse = 1 / determinant;
		tvec.subVectors(rayOrigin, vertexA);
		const u = tvec.dot(pvec) * inverse;
		if (u < -1e-6 || u > 1 + 1e-6) return -1;

		qvec.crossVectors(tvec, edge1);
		const v = rayDirection.dot(qvec) * inverse;
		if (v < -1e-6 || u + v > 1 + 1e-6) return -1;

		return edge2.dot(qvec) * inverse;
	}

	function queryRadial(direction: Vector3, out: GroundHit): GroundHit {
		const startDistance = maxRadius + 2;
		// The ray starts outside the planet and travels back inwards, so the
		// march direction is the negative of the outward query direction.
		rayDirection.copy(direction).negate();
		rayOrigin.copy(center).addScaledVector(direction, startDistance);

		const theta = Math.acos(Math.min(1, Math.max(-1, direction.y)));
		const phi = Math.atan2(direction.z, direction.x);
		const band = Math.min(THETA_BANDS - 1, Math.floor(theta / thetaStep));

		let best = Infinity;
		let bestTriangle = -1;

		for (let row = Math.max(0, band - 1); row <= Math.min(THETA_BANDS - 1, band + 1); row++) {
			const cells = bandCells[row];
			const cell = cellOfPhi(phi, cells);
			for (let delta = -1; delta <= 1; delta++) {
				const target = bandStart[row] + ((cell + delta + cells) % cells);
				for (let slot = offsets[target]; slot < offsets[target + 1]; slot++) {
					const t = testTriangle(entries[slot]);
					if (t > 1e-6 && t < best) {
						best = t;
						bestTriangle = entries[slot];
					}
				}
			}
		}

		if (bestTriangle < 0) {
			out.hit = false;
			out.radius = 0;
			out.normal.copy(direction);
			return out;
		}

		out.hit = true;
		out.radius = startDistance - best;

		const a = index ? index.getX(bestTriangle * 3) : bestTriangle * 3;
		const b = index ? index.getX(bestTriangle * 3 + 1) : bestTriangle * 3 + 1;
		const c = index ? index.getX(bestTriangle * 3 + 2) : bestTriangle * 3 + 2;
		loadVertex(vertexA, a);
		loadVertex(vertexB, b);
		loadVertex(vertexC, c);
		edge1.subVectors(vertexB, vertexA);
		edge2.subVectors(vertexC, vertexA);
		out.normal.crossVectors(edge1, edge2);
		// The asset's winding is not guaranteed, so orient outward instead.
		if (out.normal.dot(direction) < 0) out.normal.negate();
		out.normal.normalize();
		return out;
	}

	return {
		center,
		maxRadius,
		queryRadial,
		dispose() {
			// Plain typed arrays; dropping the index is enough.
		}
	};
}

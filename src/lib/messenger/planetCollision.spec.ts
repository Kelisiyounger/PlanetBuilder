import { IcosahedronGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
	buildPlanetCollisionIndex,
	combineCollisionIndices,
	type GroundHit
} from './planetCollision';

/**
 * The index is a hand-rolled replacement for a BVH, so it has to earn that:
 * every query is compared against an exhaustive scan of all triangles.
 */

/** Deterministic radial displacement so the surface has real relief to trip over. */
function createBumpyPlanet(radius = 4.9, detail = 4): Mesh {
	const geometry = new IcosahedronGeometry(radius, detail);
	const position = geometry.attributes.position;
	const vertex = new Vector3();

	for (let i = 0; i < position.count; i++) {
		vertex.fromBufferAttribute(position, i);
		const bump =
			1 + 0.18 * Math.sin(vertex.x * 2.1) * Math.cos(vertex.y * 1.7) + 0.07 * Math.sin(vertex.z * 3.3);
		vertex.multiplyScalar(bump);
		position.setXYZ(i, vertex.x, vertex.y, vertex.z);
	}
	position.needsUpdate = true;
	geometry.computeVertexNormals();

	return new Mesh(geometry, new MeshBasicMaterial());
}

/** Exhaustive reference: outermost hit along `direction`, or null. */
function bruteForceRadius(planet: Mesh, center: Vector3, startDistance: number, direction: Vector3) {
	const position = planet.geometry.attributes.position;
	const index = planet.geometry.index;
	const triangleCount = index ? index.count / 3 : position.count / 3;

	const origin = center.clone().addScaledVector(direction, startDistance);
	const ray = direction.clone().negate();

	const edge1 = new Vector3();
	const edge2 = new Vector3();
	const pvec = new Vector3();
	const tvec = new Vector3();
	const qvec = new Vector3();
	const a = new Vector3();
	const b = new Vector3();
	const c = new Vector3();

	let best = Infinity;
	for (let triangle = 0; triangle < triangleCount; triangle++) {
		const ia = index ? index.getX(triangle * 3) : triangle * 3;
		const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
		const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
		a.fromBufferAttribute(position, ia);
		b.fromBufferAttribute(position, ib);
		c.fromBufferAttribute(position, ic);

		edge1.subVectors(b, a);
		edge2.subVectors(c, a);
		pvec.crossVectors(ray, edge2);
		const determinant = edge1.dot(pvec);
		if (Math.abs(determinant) < 1e-12) continue;

		const inverse = 1 / determinant;
		tvec.subVectors(origin, a);
		const u = tvec.dot(pvec) * inverse;
		if (u < -1e-6 || u > 1 + 1e-6) continue;

		qvec.crossVectors(tvec, edge1);
		const v = ray.dot(qvec) * inverse;
		if (v < -1e-6 || u + v > 1 + 1e-6) continue;

		const t = edge2.dot(qvec) * inverse;
		if (t > 1e-6 && t < best) best = t;
	}

	return best === Infinity ? null : startDistance - best;
}

/** Deterministic direction sampler; includes the poles. */
function* sampleDirections(count: number): Generator<Vector3> {
	let seed = 12345;
	const random = () => {
		seed = (seed * 1664525 + 1013904223) % 4294967296;
		return seed / 4294967296;
	};
	for (let i = 0; i < count; i++) {
		const z = 2 * random() - 1;
		const theta = 2 * Math.PI * random();
		const r = Math.sqrt(1 - z * z);
		yield new Vector3(r * Math.cos(theta), z, r * Math.sin(theta)).normalize();
	}
}

describe('buildPlanetCollisionIndex', () => {
	const planet = createBumpyPlanet();
	const collision = buildPlanetCollisionIndex(planet);

	it('takes the centre of the world bounding box', () => {
		// The test planet is deliberately asymmetric, so this is NOT the origin --
		// what matters is that it is the AABB midpoint, which is what makes it a
		// good stand-in for the sphere centre.
		const position = planet.geometry.attributes.position;
		const vertex = new Vector3();
		const min = new Vector3(Infinity, Infinity, Infinity);
		const max = new Vector3(-Infinity, -Infinity, -Infinity);
		for (let i = 0; i < position.count; i++) {
			vertex.fromBufferAttribute(position, i);
			min.min(vertex);
			max.max(vertex);
		}
		const expected = min.add(max).multiplyScalar(0.5);
		expect(collision.center.distanceTo(expected)).toBeLessThan(1e-5);
	});

	it('reports a max radius that bounds the whole surface', () => {
		const position = planet.geometry.attributes.position;
		const vertex = new Vector3();
		let furthest = 0;
		for (let i = 0; i < position.count; i++) {
			vertex.fromBufferAttribute(position, i);
			furthest = Math.max(furthest, vertex.distanceTo(collision.center));
		}
		expect(collision.maxRadius).toBeCloseTo(furthest, 5);
	});

	it('matches an exhaustive scan on every sampled direction', () => {
		const out: GroundHit = { hit: false, radius: 0, normal: new Vector3() };
		const startDistance = collision.maxRadius + 2;

		let checked = 0;
		let worstError = 0;
		const misses: Vector3[] = [];

		for (const direction of sampleDirections(2000)) {
			collision.queryRadial(direction, out);
			const expected = bruteForceRadius(planet, collision.center, startDistance, direction);

			if (expected === null) {
				if (out.hit) misses.push(direction.clone());
				continue;
			}
			if (!out.hit) {
				misses.push(direction.clone());
				continue;
			}
			worstError = Math.max(worstError, Math.abs(out.radius - expected));
			checked++;
		}

		expect(misses).toHaveLength(0);
		expect(checked).toBeGreaterThan(1900);
		expect(worstError).toBeLessThan(1e-3);
	});

	it('orients the hit normal outwards', () => {
		const out: GroundHit = { hit: false, radius: 0, normal: new Vector3() };
		let hits = 0;
		let worstFacing = Infinity;
		for (const direction of sampleDirections(200)) {
			collision.queryRadial(direction, out);
			if (!out.hit) continue;
			hits++;
			// The surface normal of a bumpy sphere still points broadly outward.
			worstFacing = Math.min(worstFacing, out.normal.dot(direction));
			expect(out.normal.length()).toBeCloseTo(1, 5);
		}
		expect(hits).toBe(200);
		// Facets on a strongly displaced sphere tilt well away from radial, so the
		// meaningful assertion is the sign: outward, never inward.
		expect(worstFacing).toBeGreaterThan(0);
	});

	it('resolves directions straight at the poles', () => {
		const out: GroundHit = { hit: false, radius: 0, normal: new Vector3() };
		for (const direction of [
			new Vector3(0, 1, 0),
			new Vector3(0, -1, 0),
			new Vector3(0, 0.9999, 0.0141).normalize()
		]) {
			collision.queryRadial(direction, out);
			expect(out.hit).toBe(true);
			expect(out.radius).toBeGreaterThan(3);
		}
	});
});

describe('combineCollisionIndices', () => {
	it('reports the outermost of the combined surfaces', () => {
		// A bumpy planet and a shell of a similar size, like terrain and sea. They
		// interleave, which is the interesting case -- neither simply wins.
		const terrain = buildPlanetCollisionIndex(createBumpyPlanet(4.9, 3));
		const shell = buildPlanetCollisionIndex(
			new Mesh(new IcosahedronGeometry(5.6, 3), new MeshBasicMaterial()),
			terrain.center
		);
		const combined = combineCollisionIndices([terrain, shell]);

		const a: GroundHit = { hit: false, radius: 0, normal: new Vector3() };
		const b: GroundHit = { hit: false, radius: 0, normal: new Vector3() };
		const c: GroundHit = { hit: false, radius: 0, normal: new Vector3() };

		let terrainWins = 0;
		let shellWins = 0;
		let checks = 0;
		for (const direction of sampleDirections(300)) {
			terrain.queryRadial(direction, a);
			shell.queryRadial(direction, b);
			combined.queryRadial(direction, c);

			expect(c.hit).toBe(true);
			expect(c.radius).toBeCloseTo(Math.max(a.radius, b.radius), 6);
			if (a.radius > b.radius) terrainWins++;
			else shellWins++;
			checks++;
		}

		expect(checks).toBe(300);
		// Both surfaces must actually contribute, or the test proves nothing.
		expect(terrainWins).toBeGreaterThan(0);
		expect(shellWins).toBeGreaterThan(0);
	});

	it('passes a single surface straight through', () => {
		const only = buildPlanetCollisionIndex(createBumpyPlanet(3, 3));
		expect(combineCollisionIndices([only])).toBe(only);
	});
});

describe('queryRadial allocation contract', () => {
	it('reuses the caller-provided hit object', () => {
		const collision = buildPlanetCollisionIndex(createBumpyPlanet(2, 2));
		const out: GroundHit = { hit: false, radius: 0, normal: new Vector3() };
		const returned = collision.queryRadial(new Vector3(0, 1, 0), out);
		expect(returned).toBe(out);
	});
});

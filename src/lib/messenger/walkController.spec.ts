import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { orientationFromUpAndHeading, signedAngleAround, tangentProjection } from './walkController';

/** A spread of surface points, deliberately including the poles. */
const UPHILL: Vector3[] = [
	new Vector3(0, 1, 0),
	new Vector3(0, -1, 0),
	new Vector3(1, 0, 0),
	new Vector3(0, 0, 1),
	new Vector3(0.577, 0.577, 0.577).normalize(),
	new Vector3(-0.2, 0.94, 0.27).normalize(),
	new Vector3(0.1, -0.99, -0.05).normalize()
];

describe('tangentProjection', () => {
	it('removes the component along up and normalises', () => {
		for (const up of UPHILL) {
			const out = tangentProjection(new Vector3(), new Vector3(0.3, -0.5, 0.81), up);
			expect(Math.abs(out.dot(up))).toBeLessThan(1e-6);
			expect(out.length()).toBeCloseTo(1, 6);
		}
	});

	it('is idempotent', () => {
		const up = new Vector3(0.3, 0.9, -0.2).normalize();
		const once = tangentProjection(new Vector3(), new Vector3(1, 0, 0), up);
		const twice = tangentProjection(new Vector3(), once.clone(), up);
		expect(twice.distanceTo(once)).toBeLessThan(1e-9);
	});

	it('leaves a zero vector alone rather than producing NaN', () => {
		const up = new Vector3(0, 1, 0);
		const out = tangentProjection(new Vector3(), new Vector3(0, 1, 0), up);
		expect(Number.isFinite(out.x)).toBe(true);
		expect(out.length()).toBeCloseTo(0, 9);
	});
});

describe('orientationFromUpAndHeading', () => {
	it('points the model up axis along `up` and its forward along `heading`', () => {
		const out = new Quaternion();
		for (const up of UPHILL) {
			for (const seed of [new Vector3(1, 0.2, -0.4), new Vector3(-0.7, 0.1, 0.6)]) {
				const heading = tangentProjection(new Vector3(), seed, up);
				orientationFromUpAndHeading(up, heading, out);

				const localUp = new Vector3(0, 1, 0).applyQuaternion(out);
				const localForward = new Vector3(0, 0, 1).applyQuaternion(out);

				expect(localUp.dot(up)).toBeCloseTo(1, 5);
				expect(localForward.dot(heading)).toBeCloseTo(1, 5);
			}
		}
	});

	it('produces a proper rotation', () => {
		const out = new Quaternion();
		const up = new Vector3(0.2, 0.9, 0.35).normalize();
		const heading = tangentProjection(new Vector3(), new Vector3(1, -0.4, 0.2), up);
		orientationFromUpAndHeading(up, heading, out);

		expect(out.length()).toBeCloseTo(1, 6);

		// A proper rotation maps an orthonormal triad to an orthonormal triad.
		const ex = new Vector3(1, 0, 0).applyQuaternion(out);
		const ey = new Vector3(0, 1, 0).applyQuaternion(out);
		const ez = new Vector3(0, 0, 1).applyQuaternion(out);
		expect(ex.dot(ey)).toBeCloseTo(0, 5);
		expect(ey.dot(ez)).toBeCloseTo(0, 5);
		expect(ex.dot(ez)).toBeCloseTo(0, 5);
		expect(new Vector3().crossVectors(ex, ey).dot(ez)).toBeCloseTo(1, 5);
	});
});

describe('signedAngleAround', () => {
	it('measures a quarter turn with the correct sign', () => {
		const axis = new Vector3(0, 1, 0);
		// Right-handed: +90 degrees about +Y takes +Z to +X.
		expect(signedAngleAround(axis, new Vector3(0, 0, 1), new Vector3(1, 0, 0))).toBeCloseTo(
			Math.PI / 2,
			6
		);
		expect(signedAngleAround(axis, new Vector3(1, 0, 0), new Vector3(0, 0, 1))).toBeCloseTo(
			-Math.PI / 2,
			6
		);
	});

	it('returns zero for identical directions and pi for opposite ones', () => {
		const axis = new Vector3(0, 1, 0);
		const from = new Vector3(1, 0, 0);
		expect(signedAngleAround(axis, from, from.clone())).toBeCloseTo(0, 9);
		expect(Math.abs(signedAngleAround(axis, from, from.clone().negate()))).toBeCloseTo(Math.PI, 6);
	});

	it('detects the shortest turn even when it crosses the seam', () => {
		const axis = new Vector3(0, 1, 0);
		const from = new Vector3(1, 0, 0.05).normalize();
		const to = new Vector3(1, 0, -0.05).normalize();
		const angle = signedAngleAround(axis, from, to);
		expect(Math.abs(angle)).toBeLessThan(0.2);
	});
});

import { IcosahedronGeometry, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { buildPlanetCollisionIndex } from './planetCollision';
import type { WalkInput } from './pointerLook';
import { createWalkController } from './walkController';

/**
 * Drives the real controller against a synthetic planet. The math helpers have
 * their own spec; this one covers the per-frame behaviour that only shows up
 * when update() runs repeatedly -- which is where a real bug hid: movement was
 * not gated on input, so the character wandered off on its own.
 */

const HEIGHT = 1.6;

function fakeInput(): WalkInput & { setMove(x: number, z: number): void } {
	const input: WalkInput & { setMove(x: number, z: number): void } = {
		moveX: 0,
		moveZ: 0,
		lookX: 0,
		lookY: 0,
		pointerLocked: true,
		onLockChange: null,
		consume() {
			input.lookX = 0;
			input.lookY = 0;
		},
		setMove(x, z) {
			input.moveX = x;
			input.moveZ = z;
		},
		dispose() {}
	};
	return input;
}

function setup() {
	const planet = new Mesh(new IcosahedronGeometry(5, 4), new MeshBasicMaterial());
	const collision = buildPlanetCollisionIndex(planet);
	const input = fakeInput();
	const object = new Object3D();
	const camera = new PerspectiveCamera(42, 1.6, 0.1, 500);
	const controller = createWalkController({
		object,
		collision,
		input,
		height: HEIGHT,
		mixer: null,
		clips: { idle: null, walk: null }
	});
	return { collision, input, object, camera, controller };
}

/** Runs `frames` frames at a fixed timestep. */
function run(controller: { update(step: number, camera: PerspectiveCamera): void }, camera: PerspectiveCamera, frames: number, step = 1 / 60) {
	for (let i = 0; i < frames; i++) controller.update(step, camera);
}

describe('walk controller integration', () => {
	it('does not move when no input is given', () => {
		const { controller, camera, collision } = setup();
		const before = controller.state.position.clone();

		run(controller, camera, 600);

		// Ten seconds of standing still must not budge it -- and must not creep.
		expect(controller.state.position.distanceTo(before)).toBeLessThan(1e-6);
		expect(controller.state.position.distanceTo(collision.center)).toBeGreaterThan(1);
	});

	it('walks forward when input is applied', () => {
		const { controller, camera, input } = setup();
		const before = controller.state.position.clone();

		input.setMove(0, 1);
		run(controller, camera, 60);

		const travelled = controller.state.position.distanceTo(before);
		// One second at WALK_SPEED (1.4 u/s), allowing for the ground snap.
		expect(travelled).toBeGreaterThan(0.5);
		expect(travelled).toBeLessThan(2);
	});

	it('stays on the surface the whole way', () => {
		const { controller, camera, input, collision } = setup();
		input.setMove(0, 1);

		const out = { hit: false, radius: 0, normal: controller.state.up.clone() };
		let worstGap = -Infinity;
		for (let i = 0; i < 900; i++) {
			controller.update(1 / 60, camera);
			const dir = controller.state.position.clone().sub(collision.center).normalize();
			collision.queryRadial(dir, out);
			const gap = controller.state.position.distanceTo(collision.center) - out.radius;
			worstGap = Math.max(worstGap, Math.abs(gap));
		}

		// Never floating, never buried.
		expect(worstGap).toBeLessThan(0.2);
	});

	it('keeps the up vector aligned to the surface and the heading in the tangent plane', () => {
		const { controller, camera, input } = setup();
		input.setMove(1, 1);

		for (let i = 0; i < 300; i++) {
			controller.update(1 / 60, camera);
			const { up, heading } = controller.state;
			expect(Math.abs(heading.dot(up))).toBeLessThan(1e-6);
			expect(heading.length()).toBeCloseTo(1, 4);
			expect(up.length()).toBeCloseTo(1, 4);
		}
	});

	it('survives a long frame without teleporting', () => {
		const { controller, camera, input, collision } = setup();
		input.setMove(0, 1);
		run(controller, camera, 30);

		const before = controller.state.position.clone();
		// A stalled tab hands the controller a huge delta; the caller clamps it,
		// but the controller must still be stable if it does not.
		controller.update(0.05, camera);
		expect(controller.state.position.distanceTo(before)).toBeLessThan(0.2);

		const radius = controller.state.position.distanceTo(collision.center);
		expect(Number.isFinite(radius)).toBe(true);
		expect(radius).toBeGreaterThan(1);
	});
});

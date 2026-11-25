import {
	Matrix4,
	Quaternion,
	Vector3,
	type AnimationAction,
	type AnimationClip,
	type AnimationMixer,
	type Camera,
	type Object3D
} from 'three';
import type { GroundHit, PlanetCollisionIndex } from './planetCollision';
import type { WalkInput } from './pointerLook';

const ZERO = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

const WALK_SPEED = 1.4;
const TURN_RATE = 12;
const YAW_SENSITIVITY = 0.0022;
const PITCH_SENSITIVITY = 0.0022;
/** Keeps the view off the up axis, where lookAt would degenerate. */
const MAX_PITCH = 1.15;
const CAM_DISTANCE = 4;
/** Ground clearance for the camera, so it does not clip into a hillside. */
const CAM_CLEARANCE = 0.25;
const HEAD_HEIGHT_RATIO = 0.75;
const MAX_FALL_SPEED = 4;
const GROUND_OFFSET = 0.01;
/**
 * Steepest ground the walker will climb, as rise over run. It has to be a
 * gradient rather than a step height: a per-frame height budget would grow
 * meaningless as the frame rate rises and let the character walk up walls.
 */
const MAX_SLOPE = 1.4;
/** Never let the camera end up inside the avatar. */
const MIN_CAM_DISTANCE = 1.2;
const CAM_PROBES = 6;
/** Upward tilts, in radians, tried in order until the boom has room. */
const CAMERA_TILTS = [0, 0.25, 0.5, 0.85];
const FADE_SECONDS = 0.25;
/**
 * Ground distance the in-place walk clip should cover per loop for a natural
 * cadence. A guess -- foot slide is visible if it is wrong, so tune by eye.
 */
const STRIDE_PER_CYCLE = 1.3;

const basis = new Matrix4();
const scratchVector = new Vector3();

export function tangentProjection(out: Vector3, v: Vector3, up: Vector3): Vector3 {
	out.copy(v).addScaledVector(up, -v.dot(up));
	const length = out.length();
	if (length > 1e-8) out.multiplyScalar(1 / length);
	return out;
}

/**
 * Rotation taking the model's local +Y to `up` and local +Z to `heading`.
 *
 * `Matrix4.lookAt` writes local +Z = normalize(eye - target) and +X = up x +Z,
 * so `lookAt(heading, origin, up)` is exactly this basis. The office-worker
 * model's forward is already +Z, so no yaw offset is needed.
 */
export function orientationFromUpAndHeading(
	up: Vector3,
	heading: Vector3,
	out: Quaternion
): Quaternion {
	basis.lookAt(heading, ZERO, up);
	out.setFromRotationMatrix(basis);
	return out;
}

/** Signed angle from `from` to `to` about `axis`, in (-pi, pi]. */
export function signedAngleAround(axis: Vector3, from: Vector3, to: Vector3): number {
	scratchVector.crossVectors(from, to);
	return Math.atan2(axis.dot(scratchVector), from.dot(to));
}

export type WalkControllerState = {
	position: Vector3;
	up: Vector3;
	heading: Vector3;
	camYaw: number;
	camPitch: number;
};

export type WalkController = {
	update(step: number, camera: Camera): void;
	readonly state: WalkControllerState;
	dispose(): void;
};

export type WalkControllerOptions = {
	object: Object3D;
	collision: PlanetCollisionIndex;
	input: WalkInput;
	height: number;
	mixer: AnimationMixer | null;
	clips: { idle: AnimationClip | null; walk: AnimationClip | null };
	/**
	 * Surfaces the camera should stay out of, when that differs from what the
	 * character stands on. The tree layer sits right at camera height but is not
	 * walkable, so it is excluded from the ground query and included here.
	 */
	cameraCollision?: PlanetCollisionIndex;
};

export function createWalkController(options: WalkControllerOptions): WalkController {
	const { object, collision, input, height, mixer, clips } = options;
	const cameraCollision = options.cameraCollision ?? collision;

	const state: WalkControllerState = {
		position: new Vector3(),
		up: new Vector3(0, 1, 0),
		heading: new Vector3(1, 0, 0),
		camYaw: 0,
		camPitch: -0.18
	};

	const hit: GroundHit = { hit: false, radius: 0, normal: new Vector3() };
	const scratchDirection = new Vector3();
	const candidate = new Vector3();
	const wish = new Vector3();
	const moveForward = new Vector3();
	const moveRight = new Vector3();
	const viewDirection = new Vector3();
	const frameForward = new Vector3(1, 0, 0);
	const frameRight = new Vector3(0, 0, 1);
	const transport = new Quaternion();
	const previousUp = new Vector3();
	const head = new Vector3();
	const desired = new Vector3();
	const offset = new Vector3();
	const backward = new Vector3();
	const probeDirection = new Vector3();
	const cameraDirection = new Vector3(0, 0, 1);

	function surfaceRadius(direction: Vector3): number {
		collision.queryRadial(direction, hit);
		return hit.hit ? hit.radius : collision.maxRadius;
	}

	function cameraSurfaceRadius(direction: Vector3): number {
		cameraCollision.queryRadial(direction, hit);
		return hit.hit ? hit.radius : cameraCollision.maxRadius;
	}

	/**
	 * Start on flat ground at a *typical* altitude.
	 *
	 * Flatness alone is the wrong probe: the planet bakes its buildings into the
	 * terrain mesh, and a flat roof looks exactly like flat ground to a radial
	 * ray, so "flattest" reliably lands the character on a rooftop. Altitude
	 * disambiguates -- rooftops and peaks sit well above the median, the sea
	 * floor well below -- so this takes the flattest sample near the median.
	 */
	function pickSpawn(): Vector3 {
		type Sample = { direction: Vector3; radius: number; flatness: number };
		const samples: Sample[] = [];

		for (let index = 0; index < 256; index++) {
			const y = 1 - (2 * (index + 0.5)) / 256;
			const theta = index * 2.399963;
			const ring = Math.sqrt(Math.max(0, 1 - y * y));
			const direction = new Vector3(ring * Math.cos(theta), y, ring * Math.sin(theta)).normalize();
			const radius = surfaceRadius(direction);
			// The surface normal is a much better flatness probe than the analytic
			// sphere direction, which cannot see cliffs or rooftops.
			samples.push({ direction, radius, flatness: hit.normal.dot(direction) });
		}

		const sortedRadii = samples.map((s) => s.radius).sort((a, b) => a - b);
		const median = sortedRadii[Math.floor(sortedRadii.length / 2)];
		const spread = Math.max(1e-6, sortedRadii[sortedRadii.length - 1] - sortedRadii[0]);

		let best = samples[0];
		let bestCost = Infinity;
		for (const sample of samples) {
			if (sample.flatness < 0.9) continue;
			// Altitude dominates; flatness only breaks ties among similar heights.
			const cost =
				Math.abs(sample.radius - median) / spread + (1 - sample.flatness) * 0.5;
			if (cost < bestCost) {
				bestCost = cost;
				best = sample;
			}
		}

		return best.direction.clone().multiplyScalar(best.radius + GROUND_OFFSET).add(collision.center);
	}

	state.position.copy(pickSpawn());
	state.up.copy(state.position).sub(collision.center).normalize();
	tangentProjection(state.heading, scratchVector.crossVectors(WORLD_UP, state.up), state.up);
	if (state.heading.lengthSq() < 0.5) {
		tangentProjection(state.heading, scratchVector.set(1, 0, 0), state.up);
	}

	// --- animation -----------------------------------------------------------
	const walkAction: AnimationAction | null =
		mixer && clips.walk && clips.walk.duration > 0 ? mixer.clipAction(clips.walk) : null;
	const idleAction: AnimationAction | null =
		mixer && clips.idle && clips.idle.duration > 0 ? mixer.clipAction(clips.idle) : null;

	if (walkAction && clips.walk) {
		// Match the loop to the ground speed so the feet do not skate.
		const naturalSpeed = STRIDE_PER_CYCLE / clips.walk.duration;
		walkAction.setEffectiveTimeScale(WALK_SPEED / naturalSpeed);
	}
	idleAction?.play();
	walkAction?.setEffectiveWeight(0).play();

	let walking = false;
	function setWalking(next: boolean): void {
		if (next === walking) return;
		walking = next;
		if (!walkAction || !idleAction) return;
		const from = next ? idleAction : walkAction;
		const to = next ? walkAction : idleAction;
		to.enabled = true;
		to.setEffectiveWeight(1);
		to.play();
		from.crossFadeTo(to, FADE_SECONDS, false);
	}

	// --- frame ---------------------------------------------------------------
	function update(step: number, camera: Camera): void {
		previousUp.copy(state.up);

		// 1. Carry the view reference frame along the surface, so mouse look feels
		//    the same everywhere on the planet.
		transport.setFromUnitVectors(previousUp, state.up);
		frameForward.applyQuaternion(transport);
		tangentProjection(frameForward, frameForward, state.up);
		// Screen-right for a camera looking along `frameForward` is
		// forward x up. Using up x forward gave the mirrored basis here, which
		// is why horizontal mouse look felt inverted.
		frameRight.crossVectors(frameForward, state.up);

		// 2. Mouse look.
		state.camYaw += input.lookX * YAW_SENSITIVITY;
		state.camPitch = Math.max(
			-MAX_PITCH,
			Math.min(MAX_PITCH, state.camPitch - input.lookY * PITCH_SENSITIVITY)
		);

		// 3. View direction in the tangent frame.
		const cosPitch = Math.cos(state.camPitch);
		viewDirection
			.copy(frameForward)
			.multiplyScalar(Math.cos(state.camYaw) * cosPitch)
			.addScaledVector(frameRight, Math.sin(state.camYaw) * cosPitch)
			.addScaledVector(state.up, Math.sin(state.camPitch))
			.normalize();

		// 4. Movement basis; the body turns toward where it is going.
		tangentProjection(moveForward, viewDirection, state.up);
		moveRight.crossVectors(viewDirection, state.up).normalize();
		wish
			.copy(moveForward)
			.multiplyScalar(input.moveZ)
			.addScaledVector(moveRight, input.moveX);

		const wantsToMove = wish.lengthSq() > 1e-6;
		if (wantsToMove) {
			wish.normalize();
			const turn = signedAngleAround(state.up, state.heading, wish);
			const clamped = Math.max(-TURN_RATE * step, Math.min(TURN_RATE * step, turn));
			state.heading.applyAxisAngle(state.up, clamped);
			tangentProjection(state.heading, state.heading, state.up);
		}
		input.consume();

		// 5. Move, then resolve against the ground.
		const currentRadius = state.position.distanceTo(collision.center);

		if (wantsToMove) {
			candidate.copy(state.position).addScaledVector(state.heading, WALK_SPEED * step);
			scratchDirection.copy(candidate).sub(collision.center).normalize();

			const terrainRadius = surfaceRadius(scratchDirection);
			// A wall. Committing the step anyway would slide the character sideways
			// at its current radius, straight into whatever is blocking it.
			const climbable = terrainRadius - currentRadius <= MAX_SLOPE * WALK_SPEED * step;

			if (climbable) {
				// Walking off a ledge slides down rather than teleporting.
				const nextRadius = Math.max(
					terrainRadius + GROUND_OFFSET,
					currentRadius - MAX_FALL_SPEED * step
				);
				state.position.copy(collision.center).addScaledVector(scratchDirection, nextRadius);
			}
		}

		// Settle the surface normal under wherever the character ended up. Doing
		// this unconditionally keeps `up` correct while standing still.
		scratchDirection.copy(state.position).sub(collision.center).normalize();
		surfaceRadius(scratchDirection);
		state.up
			.lerp(hit.hit ? hit.normal : scratchDirection, 1 - Math.exp(-10 * step))
			.normalize();
		tangentProjection(state.heading, state.heading, state.up);

		object.position.copy(state.position);
		orientationFromUpAndHeading(state.up, state.heading, object.quaternion);

		// 6. Animation: keep the cycle running while pressed against a wall.
		setWalking(wantsToMove);
		mixer?.update(step);

		// 7. Camera behind and above.
		head.copy(state.position).addScaledVector(state.up, HEAD_HEIGHT_RATIO * height);
		backward.copy(viewDirection).negate();

		// Try the requested angle first, then progressively higher ones. Tilting up
		// over an obstacle reads far better than reeling the boom all the way in,
		// which just jams the camera against the avatar's back.
		let bestDistance = 0;
		for (const tilt of CAMERA_TILTS) {
			probeDirection.copy(backward);
			if (tilt > 0) probeDirection.addScaledVector(state.up, Math.tan(tilt)).normalize();

			let distance = CAM_DISTANCE;
			for (let index = 1; index <= CAM_PROBES; index++) {
				const travelled = (index / CAM_PROBES) * CAM_DISTANCE;
				offset
					.copy(head)
					.addScaledVector(probeDirection, travelled)
					.sub(collision.center);
				const length = offset.length();
				if (length < 1e-4) continue;
				const surface = cameraSurfaceRadius(offset.multiplyScalar(1 / length));
				if (length < surface + CAM_CLEARANCE) {
					distance = Math.max(MIN_CAM_DISTANCE, travelled - CAM_DISTANCE / CAM_PROBES);
					break;
				}
			}

			if (distance > bestDistance) {
				bestDistance = distance;
				cameraDirection.copy(probeDirection);
			}
			if (distance >= CAM_DISTANCE * 0.7) break;
		}

		desired.copy(head).addScaledVector(cameraDirection, bestDistance);

		// Final safety: never leave the camera below the surface it sits over.
		offset.copy(desired).sub(collision.center);
		const distanceFromCentre = offset.length();
		if (distanceFromCentre > 1e-4) {
			const outward = offset.multiplyScalar(1 / distanceFromCentre);
			const minimum = surfaceRadius(outward) + CAM_CLEARANCE;
			if (distanceFromCentre < minimum) {
				desired.copy(collision.center).addScaledVector(outward, minimum);
			}
		}

		camera.position.copy(desired);
		// Taking `up` from the surface normal is what makes standing on the far
		// side of the planet look right.
		camera.up.copy(state.up);
		camera.lookAt(head);
	}

	return {
		update,
		state,
		dispose() {
			mixer?.stopAllAction();
			if (mixer) mixer.uncacheRoot(object);
		}
	};
}

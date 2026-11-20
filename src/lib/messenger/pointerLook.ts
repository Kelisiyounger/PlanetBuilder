/**
 * WASD + pointer-lock mouse look.
 *
 * The project had no input handling at all before this, so everything here is
 * new and everything it attaches must come off again in `dispose()` -- a
 * `mousemove` left on `document` would otherwise keep driving a dead controller
 * after the scene is torn down.
 */

/** Chromium emits one huge movement spike right after locking; cap every event. */
const MAX_STEP_PIXELS = 120;

const MOVE_KEYS: Record<string, { x: number; z: number }> = {
	KeyW: { x: 0, z: 1 },
	ArrowUp: { x: 0, z: 1 },
	KeyS: { x: 0, z: -1 },
	ArrowDown: { x: 0, z: -1 },
	KeyA: { x: -1, z: 0 },
	ArrowLeft: { x: -1, z: 0 },
	KeyD: { x: 1, z: 0 },
	ArrowRight: { x: 1, z: 0 }
};

export type WalkInput = {
	/** -1..1, A/D */
	moveX: number;
	/** -1..1, W/S */
	moveZ: number;
	/** Mouse movement accumulated since the last `consume()`. */
	lookX: number;
	lookY: number;
	consume(): void;
	pointerLocked: boolean;
	onLockChange: ((locked: boolean) => void) | null;
	dispose(): void;
};

export function createWalkInput(canvas: HTMLCanvasElement): WalkInput {
	const pressed = new Set<string>();
	let skipNextMove = false;
	let warned = false;

	const input: WalkInput = {
		moveX: 0,
		moveZ: 0,
		lookX: 0,
		lookY: 0,
		pointerLocked: false,
		onLockChange: null,
		consume() {
			input.lookX = 0;
			input.lookY = 0;
		},
		dispose() {
			canvas.removeEventListener('click', onCanvasClick);
			document.removeEventListener('pointerlockchange', onLockChange);
			document.removeEventListener('pointerlockerror', onLockError);
			document.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', clearKeys);
			pressed.clear();
			input.moveX = 0;
			input.moveZ = 0;
			// Must happen while the element is still attached; a dangling lock
			// would keep swallowing the pointer with no scene to drive.
			if (document.pointerLockElement === canvas) {
				try {
					document.exitPointerLock();
				} catch {
					// Already released.
				}
			}
		}
	};

	function refreshMoveAxes(): void {
		let x = 0;
		let z = 0;
		for (const code of pressed) {
			const axis = MOVE_KEYS[code];
			if (!axis) continue;
			x += axis.x;
			z += axis.z;
		}
		input.moveX = Math.max(-1, Math.min(1, x));
		input.moveZ = Math.max(-1, Math.min(1, z));
	}

	function clearKeys(): void {
		// Releasing the lock while holding W would otherwise leave W stuck on.
		pressed.clear();
		refreshMoveAxes();
	}

	function onCanvasClick(): void {
		if (input.pointerLocked) return;
		try {
			const result = canvas.requestPointerLock() as unknown;
			if (result && typeof (result as Promise<void>).catch === 'function') {
				(result as Promise<void>).catch(() => {});
			}
		} catch {
			// Denied; WASD still works and the hint stays up.
		}
	}

	function onLockChange(): void {
		const locked = document.pointerLockElement === canvas;
		input.pointerLocked = locked;
		if (locked) {
			skipNextMove = true;
		} else {
			clearKeys();
		}
		input.onLockChange?.(locked);
	}

	function onLockError(): void {
		if (warned) return;
		warned = true;
		console.warn('Pointer lock was refused; WASD still works without mouse look.');
	}

	function onMouseMove(event: MouseEvent): void {
		if (!input.pointerLocked) return;
		if (skipNextMove) {
			skipNextMove = false;
			return;
		}
		input.lookX += Math.max(-MAX_STEP_PIXELS, Math.min(MAX_STEP_PIXELS, event.movementX));
		input.lookY += Math.max(-MAX_STEP_PIXELS, Math.min(MAX_STEP_PIXELS, event.movementY));
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (!MOVE_KEYS[event.code]) return;
		// Never preventDefault Escape -- the browser needs it to release the lock.
		event.preventDefault();
		pressed.add(event.code);
		refreshMoveAxes();
	}

	function onKeyUp(event: KeyboardEvent): void {
		if (!MOVE_KEYS[event.code]) return;
		pressed.delete(event.code);
		refreshMoveAxes();
	}

	canvas.addEventListener('click', onCanvasClick);
	document.addEventListener('pointerlockchange', onLockChange);
	document.addEventListener('pointerlockerror', onLockError);
	document.addEventListener('mousemove', onMouseMove);
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', clearKeys);

	return input;
}

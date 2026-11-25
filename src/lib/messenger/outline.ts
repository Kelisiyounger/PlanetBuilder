import {
	Color,
	HalfFloatType,
	Mesh,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	Vector2,
	Vector3,
	WebGLRenderTarget,
	type Camera,
	type Material,
	type Object3D,
	type WebGLRenderer
} from 'three';

/**
 * Port of the reference game's `outlines` pass.
 *
 * The original renders two colour attachments in one pass: the scene colour
 * (alpha = face/surface id) and an "info" attachment (1 - depth, spheremap
 * normal, coverage). The outline shader compares five taps and draws a broken
 * contour where face ids, depth or normals disagree. That is what produces the
 * hand-drawn, dashed-looking edges around the characters and terrain.
 *
 * This port uses two render targets and two draws instead of MRT. The ids come
 * from `surfaceId` written into alpha by the atlas/terrain shaders; transparent
 * materials keep their alpha and therefore act as their own id.
 */

const fullscreenVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const infoVertexShader = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>

attribute float surfaceId;

varying vec3 vViewNormal;
varying vec2 vHighPrecisionZW;
varying vec3 vLocalPosition;
varying float vSurfaceId;

void main() {
	#include <beginnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	vViewNormal = normalize(normalMatrix * objectNormal);

	#include <begin_vertex>
	#include <skinning_vertex>

	// Bind-pose local position: the outline noise should stick to the surface,
	// not swim as the character animates.
	vLocalPosition = position;
	vSurfaceId = surfaceId;

	vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
	gl_Position = projectionMatrix * mvPosition;
	vHighPrecisionZW = gl_Position.zw;
}
`;

const infoFragmentShader = /* glsl */ `
precision highp float;

varying vec3 vViewNormal;
varying vec2 vHighPrecisionZW;
varying vec3 vLocalPosition;
varying float vSurfaceId;

vec2 encodeNormalSpheremap(vec3 n) {
	float f = sqrt(8.0 * n.z + 8.0);
	return n.xy / f * 2.0;
}

// Reference sinenoise1: the same 3D sine noise used to decide which parts
// of a contour are drawn and which are skipped.
#define sinlayer(frX, frY, frZ) val += sin(dot(p, vec3(frX, frY, frZ)));
float sinenoise1(vec3 p) {
	float val = 0.0;
	sinlayer(1.5, 3.4598, 1.234);
	sinlayer(3.12, -3.234, 4.221);
	sinlayer(0.355, 2.3, -1.375);
	sinlayer(-0.156, -3.34, -0.4566);
	sinlayer(-4.1235, -0.485, -1.45);
	sinlayer(2.54, -0.879, -2.123);
	return val / 6.0;
}

void main() {
	// Same packing as the reference: r = 1 - normalized depth, gb = normal,
	// a = outline contribution. The mask is what makes the contour broken and
	// selective instead of a continuous ring around every object.
	float depth = 0.5 * vHighPrecisionZW.x / vHighPrecisionZW.y + 0.5;
	float outlineNoise = sinenoise1(vLocalPosition * 4.0 + vec3(3.324, 34.2, 56.343) * vSurfaceId) * 0.5 + 0.5;
	float outlineContribution = step(0.47, outlineNoise);
	// Signed alpha carries two facts in one channel: |a| is geometry coverage,
	// sign(a) is the interior-line mask. The outline pass keeps the silhouette
	// (coverage) continuous and only breaks the interior face-id lines.
	float signedContribution = outlineContribution * 2.0 - 1.0;
	gl_FragColor = vec4(
		1.0 - depth,
		encodeNormalSpheremap(normalize(vViewNormal)),
		signedContribution
	);
}
`;

const outlineFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D tColor;
uniform sampler2D tInfo;
uniform vec2 uResolution;

uniform float uCameraNear;
uniform float uCameraFar;

uniform vec2 uOutlineFade;
uniform float uOutlineThickness;
uniform vec3 uOutlineColor;
uniform float uOutlineScale;
uniform float uTime;
uniform float uJitter;

uniform vec3 uInfoRange;
uniform vec3 uDepthRange;
uniform vec3 uNormalRange;
uniform float uSmoothMargin;
uniform float uInfoMinScale;

varying vec2 vUv;

float fit(float value, float inMin, float inMax, float outMin, float outMax) {
	if (abs(inMax - inMin) < 1.0e-7) return outMin;
	return outMin + (outMax - outMin) * clamp((value - inMin) / (inMax - inMin), 0.0, 1.0);
}

float perspectiveDepthToViewZ(float depth, float near, float far) {
	return (near * far) / ((far - near) * depth - far);
}

float viewZToOrthographicDepth(float viewZ, float near, float far) {
	return (viewZ + near) / (near - far);
}

float orthographicDepthToViewZ(float depth, float near, float far) {
	return -near - depth * (far - near);
}

float getLinearDepth(float depth, float near, float far) {
	return viewZToOrthographicDepth(perspectiveDepthToViewZ(depth, near, far), near, far);
}

vec3 decodeNormalSpheremap(vec2 n) {
	vec4 nn = vec4(n.xy, 1.0, -1.0);
	float l = dot(nn.xyz, -nn.xyw);
	nn.z = l;
	nn.xy *= sqrt(l);
	return nn.xyz * 2.0 + vec3(0.0, 0.0, -1.0);
}

#define sinlayer(frX, frY, frZ) val += sin(dot(p, vec3(frX, frY, frZ)));
float sinenoise1(vec3 p) {
	float val = 0.0;
	sinlayer(1.5, 3.4598, 1.234);
	sinlayer(3.12, -3.234, 4.221);
	sinlayer(0.355, 2.3, -1.375);
	sinlayer(-0.156, -3.34, -0.4566);
	sinlayer(-4.1235, -0.485, -1.45);
	sinlayer(2.54, -0.879, -2.123);
	return val / 6.0;
}

void main() {
	float scale = min(1.0, uResolution.y / 1300.0) * uOutlineScale;
	vec2 offset = (uOutlineThickness * scale) / uResolution;

	// Hand-drawn wobble: shift the whole five-tap kernel by a slowly moving
	// noise field so the contour is not a perfectly straight offset.
	float time = uTime * 0.6;
	vec2 jitter = vec2(
		sinenoise1(vec3(gl_FragCoord.xy * 0.05, time)),
		sinenoise1(vec3(gl_FragCoord.yx * 0.05 + 19.7, time))
	) * uJitter / uResolution;
	vec2 uv = vUv + jitter;

	vec2 leftUv = uv + vec2(-offset.x, 0.0);
	vec2 rightUv = uv + vec2(offset.x, 0.0);
	vec2 downUv = uv + vec2(0.0, -offset.y);
	vec2 upUv = uv + vec2(0.0, offset.y);

	// Keep the centre unjittered: a jittered centre sample can land on geometry
	// from a background pixel, painting a pale contour into the sky.
	vec4 n0 = texture2D(tInfo, vUv);
	vec4 n1 = texture2D(tInfo, leftUv);
	vec4 n2 = texture2D(tInfo, rightUv);
	vec4 n3 = texture2D(tInfo, downUv);
	vec4 n4 = texture2D(tInfo, upUv);

	float c0 = texture2D(tColor, vUv).a;
	float c1 = texture2D(tColor, leftUv).a;
	float c2 = texture2D(tColor, rightUv).a;
	float c3 = texture2D(tColor, downUv).a;
	float c4 = texture2D(tColor, upUv).a;

	float d0 = getLinearDepth(1.0 - n0.r, uCameraNear, uCameraFar);
	float d1 = getLinearDepth(1.0 - n1.r, uCameraNear, uCameraFar);
	float d2 = getLinearDepth(1.0 - n2.r, uCameraNear, uCameraFar);
	float d3 = getLinearDepth(1.0 - n3.r, uCameraNear, uCameraFar);
	float d4 = getLinearDepth(1.0 - n4.r, uCameraNear, uCameraFar);

	vec3 normal0 = decodeNormalSpheremap(n0.gb);
	vec3 normal1 = decodeNormalSpheremap(n1.gb);
	vec3 normal2 = decodeNormalSpheremap(n2.gb);
	vec3 normal3 = decodeNormalSpheremap(n3.gb);
	vec3 normal4 = decodeNormalSpheremap(n4.gb);

	float centerId = c0;
	float centerDepth = d0;
	float centerCoverage = abs(n0.a);
	float centerMask = step(0.0, n0.a);
	vec3 centerNormal = normal0;

	// A face-id change produces the broken/dashed contour; depth and normal
	// changes cover silhouettes and creases.
	vec2 idVariation = vec2((c1 - centerId) - (c2 - centerId), (c3 - centerId) - (c4 - centerId));
	vec2 depthVariation = vec2((d1 - centerDepth) - (d2 - centerDepth), (d3 - centerDepth) - (d4 - centerDepth));
	vec2 normalVariation = vec2(
		distance(normal1, centerNormal) - distance(normal2, centerNormal),
		distance(normal3, centerNormal) - distance(normal4, centerNormal)
	);

	float idVariationTotal = sqrt(idVariation.x * idVariation.x + idVariation.y * idVariation.y);
	float depthVariationTotal = sqrt(depthVariation.x * depthVariation.x + depthVariation.y * depthVariation.y);
	float normalVariationTotal = sqrt(normalVariation.x * normalVariation.x + normalVariation.y * normalVariation.y);

	float idContribution = fit(fit(idVariationTotal, uInfoRange.x, uInfoRange.y, 0.0, 1.0), uInfoRange.z, uInfoRange.z + uSmoothMargin, 0.0, 1.0);
	idContribution = mix(idContribution * uInfoMinScale, idContribution, clamp(scale, 0.0, 1.0));
	// Terrain writes a negative alpha; its per-vertex surface ids are not a
	// useful face id. Characters/props keep positive ids.
	idContribution *= step(0.0, centerId);
	// The noise mask breaks the interior lines; the silhouette below is not
	// gated by it, so the outer contour stays readable.
	idContribution *= centerMask;

	// Depth/normal creases are too dense on the low-poly terrain: every facet
	// becomes a dotted scratch. Keep only the large depth jump of a silhouette;
	// the face-id term supplies the interior contour.
	float silhouette = smoothstep(0.35, 0.65, depthVariationTotal);

	float viewZ = -orthographicDepthToViewZ(centerDepth, uCameraNear, uCameraFar);
	float coverageFade = fit(viewZ, uOutlineFade.x, uOutlineFade.y, 1.0, 0.0);

	float outlineValue = clamp(idContribution + silhouette, 0.0, 1.0) * centerCoverage * coverageFade;

	// Saturate weak partial edges: a 20-40% mix reads as a pale speckle on dark
	// geometry. Strong edges become a solid grey stroke; the mask still supplies
	// the irregular gaps.
	outlineValue = smoothstep(0.25, 0.55, outlineValue);

	// The gaps come from the surface-noise mask in the info pass; a second
	// high-frequency screen-space dash just turned the contour into speckles.

	// Sample the scene at the *unjittered* uv. Using the jittered uv here made
	// silhouette pixels sample the sky/building behind them, producing the pale
	// speckled halo around the contour.
	vec3 sceneColor = texture2D(tColor, vUv).rgb;
	sceneColor = mix(sceneColor, uOutlineColor, outlineValue);
	gl_FragColor = vec4(sceneColor, 1.0);
}
`;

export type OutlineComposer = {
	render(): void;
	resize(): void;
	dispose(): void;
};

export function createOutlineComposer(
	renderer: WebGLRenderer,
	scene: Scene,
	camera: Camera
): OutlineComposer {
	// The direct canvas render is MSAA'd; an offscreen target without samples
	// aliases the silhouette, and the dotted outline then reads as a pale fringe.
	const colorTarget = new WebGLRenderTarget(1, 1, {
		type: HalfFloatType,
		depthBuffer: true,
		samples: 4
	});
	const infoTarget = new WebGLRenderTarget(1, 1, {
		type: HalfFloatType,
		depthBuffer: true,
		samples: 4
	});

	const infoMaterial = new ShaderMaterial({
		name: 'MessengerOutlineInfo',
		vertexShader: infoVertexShader,
		fragmentShader: infoFragmentShader
	});

	const outlineMaterial = new ShaderMaterial({
		name: 'MessengerOutlines',
		depthTest: false,
		depthWrite: false,
		uniforms: {
			tColor: { value: null },
			tInfo: { value: null },
			uResolution: { value: new Vector2(1, 1) },
			uCameraNear: { value: 0.1 },
			uCameraFar: { value: 500 },
			// Tuned for this project's planet scale. The reference planet is
			// roughly 10x larger, where the fade is (50, 300).
			uOutlineFade: { value: new Vector2(10, 80) },
			uOutlineThickness: { value: 3 },
			uOutlineColor: { value: new Color('#555b60') },
			uOutlineScale: { value: 1 },
			uTime: { value: 0 },
			uJitter: { value: 0.3 },
			uInfoRange: { value: new Vector3(2e-4, 4e-4, 0.1) },
			uDepthRange: { value: new Vector3(0.01, 0.2, 0.7) },
			uNormalRange: { value: new Vector3(1.6, 2.2, 0.9) },
			uSmoothMargin: { value: 0.2 },
			uInfoMinScale: { value: 0.6 }
		},
		vertexShader: fullscreenVertexShader,
		fragmentShader: outlineFragmentShader
	});

	const quad = new Mesh(new PlaneGeometry(2, 2), outlineMaterial);
	quad.frustumCulled = false;
	const quadScene = new Scene();
	quadScene.add(quad);
	const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

	const drawingBuffer = new Vector2();
	const clearColor = new Color();
	let clearAlpha = 1;

	const resize = () => {
		renderer.getDrawingBufferSize(drawingBuffer);
		const width = Math.max(1, Math.floor(drawingBuffer.x));
		const height = Math.max(1, Math.floor(drawingBuffer.y));
		colorTarget.setSize(width, height);
		infoTarget.setSize(width, height);
		outlineMaterial.uniforms.uResolution.value.set(width, height);
	};

	const render = () => {
		outlineMaterial.uniforms.uTime.value = performance.now() / 1000;

		const perspective = camera as Camera & { isPerspectiveCamera?: boolean; near?: number; far?: number };
		if (perspective.isPerspectiveCamera && perspective.near !== undefined && perspective.far !== undefined) {
			outlineMaterial.uniforms.uCameraNear.value = perspective.near;
			outlineMaterial.uniforms.uCameraFar.value = perspective.far;
		}

		const previousTarget = renderer.getRenderTarget();
		const previousBackground = scene.background;
		const previousOverride = scene.overrideMaterial;
		renderer.getClearColor(clearColor);
		clearAlpha = renderer.getClearAlpha();

		// Colour pass: alpha now carries the face/surface id written by the
		// atlas and terrain shaders.
		renderer.setRenderTarget(colorTarget);
		renderer.clear();
		renderer.render(scene, camera);

		// Info pass: depth + view normal + coverage. Transparent water, clouds,
		// leaves and props are excluded: the override material would draw their
		// full geometry as opaque coverage and leave pale halos where the colour
		// pass is transparent.
		const hidden: Object3D[] = [];
		scene.traverse((object) => {
			const mesh = object as Object3D & { material?: Material | Material[] };
			const material = mesh.material;
			if (!material) return;
			const materials = Array.isArray(material) ? material : [material];
			if (object.visible && materials.some((item) => item?.transparent)) {
				object.visible = false;
				hidden.push(object);
			}
		});

		scene.background = null;
		scene.overrideMaterial = infoMaterial;
		renderer.setClearColor(0x000000, 0);
		renderer.setRenderTarget(infoTarget);
		renderer.clear();
		try {
			renderer.render(scene, camera);
		} finally {
			for (const object of hidden) object.visible = true;
			scene.overrideMaterial = previousOverride;
			scene.background = previousBackground;
			renderer.setClearColor(clearColor, clearAlpha);
		}

		renderer.setRenderTarget(previousTarget);
		outlineMaterial.uniforms.tColor.value = colorTarget.texture;
		outlineMaterial.uniforms.tInfo.value = infoTarget.texture;
		renderer.render(quadScene, quadCamera);
	};

	resize();

	return {
		render,
		resize,
		dispose() {
			colorTarget.dispose();
			infoTarget.dispose();
			infoMaterial.dispose();
			outlineMaterial.dispose();
			quad.geometry.dispose();
		}
	};
}

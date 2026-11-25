export const atlasVertexShader = /* glsl */ `
attribute float surfaceId;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vLightDirection;
varying float vSurfaceId;

uniform vec3 uLightPosition;

// Supplies boneTexture/bindMatrix and getBoneMatrix(); a no-op unless three
// defined USE_SKINNING, which it does automatically for any material on a
// SkinnedMesh. Harmless for the planet and trees.
#include <skinning_pars_vertex>

void main() {
	vUv = uv;
	vSurfaceId = surfaceId;

	vec3 transformed = vec3( position );
	vec3 objectNormal = vec3( normal );

	#ifdef USE_SKINNING
		mat4 boneMatX = getBoneMatrix( skinIndex.x );
		mat4 boneMatY = getBoneMatrix( skinIndex.y );
		mat4 boneMatZ = getBoneMatrix( skinIndex.z );
		mat4 boneMatW = getBoneMatrix( skinIndex.w );
		#include <skinnormal_vertex>
		#include <skinning_vertex>
	#endif

	// The fragment shader dots the normal against a WORLD-space light direction,
	// so the normal must be world-space too. A view-space normal makes the lit
	// side swim as the camera orbits, which reads as a metallic sheen.
	vNormal = normalize( mat3( modelMatrix ) * objectNormal );

	vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );
	vWorldPosition = worldPosition.xyz;
	vLightDirection = uLightPosition - worldPosition.xyz;
	gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const atlasFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D tAtlas;
uniform vec3 uLightPosition;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vLightDirection;
varying float vSurfaceId;

vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
	vec3 baseColor = texture2D(tAtlas, vUv).rgb;
	vec3 colorShadow = hsv2rgb(vec3(rgb2hsv(baseColor).xy, rgb2hsv(baseColor).z * 0.5));

	vec3 normal = normalize(vNormal);
	vec3 lightDir = normalize(vLightDirection);
	float shade = max(dot(normal, lightDir), 0.0);
	float shadow = 1.0 - step(0.4, shade);

	vec3 color = mix(baseColor, colorShadow, shadow * 0.85);
	// Alpha is a face/surface id for the outline pass, not opacity. Keeping it
	// small makes the id difference cross the outline threshold at each face.
	gl_FragColor = vec4(color, vSurfaceId * 0.001);
}
`;

export const waterVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vDistance;

void main() {
	vUv = uv;
	vNormal = normalize(mat3(modelMatrix) * normal);
	vec4 worldPosition = modelMatrix * vec4(position, 1.0);
	vWorldPosition = worldPosition.xyz;
	vDistance = length(position);
	gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const waterFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D tAtlas;
uniform sampler2D tNoise;
uniform float uTime;
uniform vec3 uLightPosition;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vDistance;

vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
	vec3 color = texture2D(tAtlas, vUv).rgb;
	vec2 noiseUv = vWorldPosition.xz * 0.07 + uTime * 0.05;
	float noise = texture2D(tNoise, noiseUv).r;

	float waves = fract(noise * 0.7 + vDistance * 3.0 + uTime * 0.1);
	waves *= 1.0 - step(0.7, vDistance);
	waves *= step(0.3, vDistance);
	waves = step(0.3, waves * noise);
	color = mix(color, vec3(1.0), waves * 0.35);

	vec3 colorShadow = hsv2rgb(vec3(rgb2hsv(color).xy, rgb2hsv(color).z * 0.5));
	vec3 lightDir = normalize(uLightPosition - vWorldPosition);
	float shade = max(dot(normalize(vNormal), lightDir), 0.0);
	color = mix(colorShadow, color, smoothstep(0.2, 0.4, shade));

	color += smoothstep(0.3, 0.0, step(0.2, vDistance - noise * 1.5)) * vec3(0.2, 0.8, 1.0) * 0.04;
	gl_FragColor = vec4(color, 0.92);
}
`;

export const cloudVertexShader = /* glsl */ `
uniform sampler2D tNoise;
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
	vUv = uv;
	vec3 pos = position;
	float noise = texture2D(tNoise, pos.xz * 0.07).r;
	pos += normalize(pos) * sin(noise * 180.0 + floor(uTime * 6.0) * 0.25) * 0.08;

	vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
	vWorldPosition = worldPosition.xyz;
	vNormal = normalize(mat3(modelMatrix) * normal);
	gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const cloudFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform sampler2D tNoise;
uniform vec3 uLightPosition;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;

vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
	vec3 color = uColor;
	float noise = texture2D(tNoise, vWorldPosition.xz * 0.07).g;

	vec3 colorShadow = hsv2rgb(vec3(rgb2hsv(color).xy, rgb2hsv(color).z * 0.5));
	vec3 lightDir = normalize(uLightPosition - vWorldPosition);
	float shade = max(dot(normalize(vNormal), lightDir), 0.0);
	color = mix(colorShadow, color, smoothstep(0.2, 0.55, shade));
	color = mix(color, vec3(1.0), noise * 0.08);

	gl_FragColor = vec4(color, 0.72);
}
`;

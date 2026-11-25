export const gameplayWaterVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vHighPrecisionZW;

void main() {
	vUv = uv;
	vNormal = normalize(mat3(modelMatrix) * normal);
	vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
	vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
	gl_Position = projectionMatrix * viewPosition;
	vHighPrecisionZW = gl_Position.zw;
}
`;

export const gameplayWaterFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColorWaves1;
uniform vec3 uColorWaves2;
uniform sampler2D tNoise;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform float uTime;
uniform float uUseSceneDepth;
uniform float uCameraNear;
uniform float uCameraFar;
uniform vec3 uLightPosition;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vHighPrecisionZW;

float linearizeDepth(float depth) {
	float z = depth * 2.0 - 1.0;
	return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
}

void main() {
	vec2 noiseUv = vWorldPosition.xz * 0.12 + uTime * 0.04;
	float noise = texture2D(tNoise, noiseUv).r;
	float waves = smoothstep(0.35, 0.85, fract(vUv.y * 4.0 + noise * 2.0 + uTime * 0.15));

	vec3 base = mix(uColor1, uColor2, noise * 0.5);
	vec3 color = mix(base, mix(uColorWaves1, uColorWaves2, waves), waves * 0.55);

	if (uUseSceneDepth > 0.5) {
		vec2 screenUv = gl_FragCoord.xy / uResolution;
		float sceneDepth = linearizeDepth(texture2D(tSceneDepth, screenUv).x);
		float waterDepth = linearizeDepth(0.5 * vHighPrecisionZW.x / vHighPrecisionZW.y + 0.5);
		float shore = smoothstep(0.0, 0.12, sceneDepth - waterDepth);
		color = mix(uColorWaves2 * 1.1, color, shore);
	}

	float shade = max(dot(normalize(vNormal), normalize(uLightPosition - vWorldPosition)), 0.0);
	color *= mix(0.65, 1.0, smoothstep(0.2, 0.4, shade));

	gl_FragColor = vec4(color, 0.88);
}
`;

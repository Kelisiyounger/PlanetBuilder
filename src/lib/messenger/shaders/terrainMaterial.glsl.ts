export const terrainVertexShader = /* glsl */ `
attribute float surfaceId;
attribute float elementId;

varying vec2 vUv;
varying vec3 wNormal;
varying vec3 wPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying float vSurfaceId;
flat varying int vElementId;

void main() {
	vUv = uv;
	vElementId = int(elementId + 0.5);
	vSurfaceId = surfaceId;

	vec4 worldPosition = modelMatrix * vec4(position, 1.0);
	wNormal = normal;
	wPos = position.xyz;
	vWorldNormal = normalize(mat3(modelMatrix) * normal);
	vWorldPosition = worldPosition.xyz;

	gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const terrainFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D tColors;
uniform sampler2D tNoiseTerrain;
uniform sampler2D tNoise;
uniform vec3 uLightPosition;

varying vec2 vUv;
varying vec3 wNormal;
varying vec3 wPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying float vSurfaceId;
flat varying int vElementId;

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

vec4 triplanar(sampler2D tex, vec3 normal, vec3 pos, float scale) {
	vec3 blend = abs(normal);
	blend = normalize(max(blend, 0.00001));
	float b = blend.x + blend.y + blend.z;
	blend /= vec3(b);
	vec4 x = texture2D(tex, pos.yz * scale);
	vec4 y = texture2D(tex, pos.xz * scale);
	vec4 z = texture2D(tex, pos.xy * scale);
	return x * blend.x + y * blend.y + z * blend.z;
}

void main() {
	float surfaceId = vSurfaceId;
	vec3 worldNormal = normalize(vWorldNormal);
	vec4 triplanarNoise = triplanar(tNoise, wNormal, wPos * 0.07, 1.0);
	float height = length(wPos);
	float grassMask = 0.0;

	if (vElementId == 1) {
		grassMask = step(
			0.15,
			max(0.0, -triplanarNoise.r * 1.5 + dot(wNormal, normalize(wPos)))
				- triplanarNoise.g * 0.35 + 0.1 - triplanarNoise.b * 0.05
		);

		float n1 = sin(height * 0.025 + (wNormal.x + wNormal.y + wNormal.z) * 0.05 + (wPos.x + wPos.y + wPos.z) * 1.5);
		float striations = texture2D(tNoise, vec2(n1 * 0.01, height * 0.07 - n1 * 0.02)).g;
		striations = step(0.47, striations + triplanarNoise.r * 0.2 + triplanarNoise.g * 0.05);
		surfaceId += striations * (1.0 - grassMask) * step(0.25, triplanarNoise.r);
	}

	vec2 colorUV = vUv;
	if (grassMask > 0.5) colorUV = vec2(0.15, 0.95);

	vec3 color = texture2D(tColors, colorUV).rgb;
	vec3 colorShadow = rgb2hsv(color);
	colorShadow.r -= 0.02;
	colorShadow.b *= 0.5;
	colorShadow = hsv2rgb(colorShadow);

	vec3 lightDir = normalize(uLightPosition - vWorldPosition);
	float shade = max(dot(worldNormal, lightDir), 0.0);
	float shadowCut = smoothstep(0.2, 0.4, shade);
	color = mix(colorShadow, color, shadowCut);

	float terrainDetail = texture2D(tNoiseTerrain, wPos.xz * 0.12).r;
	color *= 0.92 + terrainDetail * 0.08;

	// Negative alpha marks terrain: the outline pass then skips the per-face id
	// term for it. The terrain's surface ids vary per vertex, so using them as
	// face ids turned every facet into a dotted scratch. Its silhouette is
	// still drawn by the depth term.
	gl_FragColor = vec4(color, -1.0 - surfaceId * 0.001);
}
`;

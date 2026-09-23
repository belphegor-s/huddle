/*
 * One triangle that covers the viewport, placed from gl_VertexID so there is
 * no vertex buffer to create, upload or lose with the context.
 */
export const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

/*
 * A flow field folded into itself twice, lit from wherever the pointer rests,
 * with its level lines drawn as threads of light. The threads are contours of
 * the same field the colour comes from, so they bend with the light rather
 * than sitting on top of it.
 *
 * snoise is webgl-noise by Ashima Arts and Stefan Gustavson, MIT licensed,
 * https://github.com/stegu/webgl-noise. Copyright (C) 2011 Ashima Arts,
 * Copyright (C) 2011-2016 Stefan Gustavson. The full licence is served from
 * public/third-party/webgl-noise-LICENSE.txt.
 */
export const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform vec3 uGround;
uniform vec3 uSoft;
uniform vec3 uAccent;

out vec4 outColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    sum += amp * snoise(p);
    p = p * 2.03 + vec3(17.0, 5.0, 0.0);
    amp *= 0.5;
  }
  return sum;
}

// Interleaved gradient noise, enough to break the banding an 8 bit canvas
// shows across a gradient this soft, and no more.
float grain(vec2 frag) {
  return fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715)))) - 0.5;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float t = uTime;

  // The field leans a little, so the threads run on a diagonal like the
  // grid of the page does not.
  p = mat2(0.92, -0.39, 0.39, 0.92) * p;

  vec2 q = vec2(
    fbm(vec3(p * 0.8, t * 0.05)),
    fbm(vec3(p * 0.8 + vec2(5.2, 1.3), t * 0.05))
  );
  vec2 r = vec2(
    fbm(vec3(p * 0.8 + 1.6 * q + vec2(1.7, 9.2), t * 0.07)),
    fbm(vec3(p * 0.8 + 1.6 * q + vec2(8.3, 2.8), t * 0.07))
  );
  float f = fbm(vec3(p * 0.8 + 1.8 * r, t * 0.04));

  vec2 toPointer = p - mat2(0.92, -0.39, 0.39, 0.92) * uPointer;
  float light = exp(-dot(toPointer, toPointer) * 2.2);

  float body = smoothstep(-0.4, 0.7, f + 0.5 * light + 0.12 * length(q));
  vec3 color = mix(uGround, uSoft, body);
  float core = smoothstep(0.5, 1.1, body * (0.6 + length(r)) + 0.3 * light);
  color = mix(color, uAccent, core * 0.45);

  // The threads come from one smooth octave carried along the same warp, so
  // they run long and unbroken like silk rather than breaking up into the
  // contour map the full field would draw. fwidth keeps each about a device
  // pixel wide at any size, and they only show where there is light for them
  // to catch, so the edges of the backdrop stay calm.
  float strand = snoise(vec3(p * vec2(0.5, 1.0) + 0.7 * q, t * 0.03));
  float level = strand * 4.5 + 0.25 * f;
  float width = fwidth(level);
  float line = 1.0 - smoothstep(0.0, 1.2, abs(fract(level) - 0.5) / max(width, 1e-4));
  float lit = smoothstep(0.3, 0.95, body + 0.7 * light);
  color = mix(color, uAccent, line * lit * (0.32 + 0.5 * light));

  color += grain(gl_FragCoord.xy) * (2.0 / 255.0);
  outColor = vec4(color, 1.0);
}`;

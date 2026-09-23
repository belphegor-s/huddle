import { useEffect, useRef } from 'react';
import { cx } from '@huddle/ui';

/*
 * The shader is written here and the only borrowed part is snoise, from
 * webgl-noise by Ashima Arts and Stefan Gustavson (MIT). It is bundled, so the
 * landing page makes no third party request, and the licence it asks to travel
 * with it is served from public/third-party/webgl-noise-LICENSE.txt.
 */
export const SHADER_CREDIT =
  'Hero shader built on webgl-noise by Ashima Arts and Stefan Gustavson, MIT licence';
export const SHADER_URL = 'https://github.com/stegu/webgl-noise';

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

/*
 * A soft pool of accent light, and through it the level lines of a slowly
 * drifting noise field, drawn a device pixel wide. Nothing else.
 */
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uGround;
uniform vec3 uSoft;
uniform vec3 uAccent;
out vec4 outColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float t = uTime * 0.05;

  vec2 c = p - vec2(0.3, 0.05);
  float glow = exp(-dot(c, c) * 2.2);
  vec3 color = mix(uGround, uSoft, glow);

  float field = p.y * 1.4 + p.x * 0.5
    + 0.45 * snoise(p * 0.8 + vec2(t, 0.0))
    + 0.15 * snoise(p * 1.7 - vec2(0.0, t));
  float level = field * 7.0;
  float line = 1.0 - smoothstep(0.0, 1.0, abs(fract(level) - 0.5) / fwidth(level));
  color = mix(color, uAccent, line * glow * 0.55);

  // Enough grain to keep an 8 bit canvas from banding across the glow.
  color += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 128.0;
  outColor = vec4(color, 1.0);
}`;

/** A moment in the drift that looks right on its own, for reduced motion. */
const STILL_TIME = 12;

/*
 * The tokens may be in any syntax CSS accepts, so a 2d context resolves them
 * to sRGB rather than this file parsing colour strings.
 */
function readPalette(): number[][] {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const styles = getComputedStyle(document.documentElement);
  return ['--surface', '--accent-soft', '--accent'].map((token) => {
    if (!ctx) return [0, 0, 0];
    ctx.fillStyle = styles.getPropertyValue(token).trim() || '#000';
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((value) => value / 255);
  });
}

function mount(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!gl) return () => undefined;

  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return () => undefined;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return () => undefined;
  gl.useProgram(program);

  const at = (name: string) => gl.getUniformLocation(program, name);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  let frame = 0;

  const paint = () => {
    const [ground = [], soft = [], accent = []] = readPalette();
    gl.uniform3fv(at('uGround'), ground);
    gl.uniform3fv(at('uSoft'), soft);
    gl.uniform3fv(at('uAccent'), accent);
  };

  const draw = (now: number) => {
    gl.uniform1f(at('uTime'), motion.matches ? STILL_TIME : now / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.ready = '';
    frame = motion.matches ? 0 : requestAnimationFrame(draw);
  };

  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };

  // The glow is soft enough that a 1x canvas scaled up cannot be told apart
  // from a 3x one, and it costs a ninth of the pixels on a phone.
  const resize = () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(at('uResolution'), canvas.width, canvas.height);
    redraw();
  };

  const recolor = () => {
    paint();
    redraw();
  };

  const sizes = new ResizeObserver(resize);
  sizes.observe(canvas);
  scheme.addEventListener('change', recolor);
  motion.addEventListener('change', redraw);
  paint();

  return () => {
    cancelAnimationFrame(frame);
    sizes.disconnect();
    scheme.removeEventListener('change', recolor);
    motion.removeEventListener('change', redraw);
  };
}

/*
 * A soft ellipse that reaches zero exactly at the sides of the box, so no
 * straight edge of the shader is ever visible against the page.
 */
const MASK =
  'radial-gradient(ellipse closest-side at 56% 50%, #000 0%, #000 22%, transparent 100%)';

export function HeroShader({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => (canvas.current ? mount(canvas.current) : undefined), []);

  return (
    <div
      // The credit is the backdrop's own tooltip. The text and the panel sit
      // above this layer, so hovering them never raises it.
      title={SHADER_CREDIT}
      className={cx(
        // What shows when WebGL never starts, so there is never a blank hole.
        'overflow-hidden bg-[radial-gradient(70%_60%_at_68%_34%,var(--accent-soft),transparent_72%)]',
        className,
      )}
      style={{ maskImage: MASK, WebkitMaskImage: MASK }}
    >
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="size-full opacity-0 transition-opacity duration-700 data-ready:opacity-100 motion-reduce:transition-none"
      />
    </div>
  );
}

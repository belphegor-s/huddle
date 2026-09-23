import { FRAGMENT, VERTEX } from './hero-shader-source';

type Rgb = [number, number, number];

/*
 * Five passes of four octave noise per pixel is cheap on a laptop and not on
 * an old phone, so the canvas is sized to a pixel budget rather than to the
 * device ratio. The field is soft enough that nobody can see the difference.
 */
const PIXEL_BUDGET = 1_200_000;

/** Where the light rests without a pointer: behind the conversation panel. */
const REST = { x: 0.34, y: 0.06 };

/** A moment in the loop that looks good on its own, for reduced motion. */
const STILL_TIME = 38;

const TOKENS = ['--surface', '--accent-soft', '--accent'] as const;

/*
 * The tokens may be written in any syntax CSS accepts, so a 2d context
 * resolves them to sRGB rather than this file parsing colour strings.
 */
function readPalette(): Rgb[] {
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  const styles = getComputedStyle(document.documentElement);

  return TOKENS.map((token) => {
    if (!ctx) return [0, 0, 0];
    ctx.fillStyle = '#000';
    ctx.fillStyle = styles.getPropertyValue(token).trim() || '#000';
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  });
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function link(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment) return null;

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

/**
 * Starts the hero backdrop on a canvas and returns what stops it. Returns a
 * no-op when WebGL2 is unavailable, which leaves the CSS gradient behind the
 * canvas as the backdrop.
 */
export function mountShader(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return () => undefined;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const finePointer = window.matchMedia('(pointer: fine)');

  let program: WebGLProgram | null = null;
  let uniforms: Record<string, WebGLUniformLocation | null> = {};
  let palette = readPalette();

  let frame = 0;
  let last = 0;
  let clock = STILL_TIME;
  let onscreen = true;
  const pointer = { ...REST };
  const target = { ...REST };

  const setup = () => {
    program = link(gl);
    if (!program) return;
    gl.useProgram(program);
    uniforms = Object.fromEntries(
      ['uResolution', 'uTime', 'uPointer', 'uGround', 'uSoft', 'uAccent'].map((name) => [
        name,
        gl.getUniformLocation(program as WebGLProgram, name),
      ]),
    );
  };

  const draw = () => {
    if (!program || gl.isContextLost()) return;
    const [ground, soft, accent] = palette;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.uResolution ?? null, canvas.width, canvas.height);
    gl.uniform1f(uniforms.uTime ?? null, clock);
    gl.uniform2f(uniforms.uPointer ?? null, pointer.x, pointer.y);
    if (ground && soft && accent) {
      gl.uniform3fv(uniforms.uGround ?? null, ground);
      gl.uniform3fv(uniforms.uSoft ?? null, soft);
      gl.uniform3fv(uniforms.uAccent ?? null, accent);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.ready = '';
  };

  const running = () => onscreen && !document.hidden && !motion.matches;

  const tick = (now: number) => {
    // Capped so a tab coming back from the background does not lurch forward.
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
    last = now;
    clock += dt;
    const ease = 1 - Math.exp(-dt * 2.2);
    pointer.x += (target.x - pointer.x) * ease;
    pointer.y += (target.y - pointer.y) * ease;
    draw();
    frame = running() ? requestAnimationFrame(tick) : 0;
  };

  const resume = () => {
    if (frame || !running()) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };

  const pause = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const settle = () => {
    if (motion.matches) {
      pause();
      clock = STILL_TIME;
      Object.assign(pointer, REST);
      draw();
    } else {
      resume();
    }
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(PIXEL_BUDGET / Math.max(rect.width * rect.height, 1)),
    );
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    draw();
  };

  const repaint = () => {
    palette = readPalette();
    draw();
  };

  const follow = (event: PointerEvent) => {
    if (!finePointer.matches || motion.matches) return;
    const rect = canvas.getBoundingClientRect();
    const unit = Math.min(rect.width, rect.height) || 1;
    const x = (event.clientX - rect.left - rect.width / 2) / unit;
    const y = -(event.clientY - rect.top - rect.height / 2) / unit;
    // Past the edge of the hero the light stays at the edge rather than
    // following the pointer off into the rest of the page.
    const reach = Math.hypot(x, y);
    const clamp = reach > 1.1 ? 1.1 / reach : 1;
    target.x = x * clamp;
    target.y = y * clamp;
  };

  const lost = (event: Event) => {
    event.preventDefault();
    pause();
    program = null;
  };

  const restored = () => {
    setup();
    resize();
    settle();
  };

  setup();

  const sizes = new ResizeObserver(resize);
  sizes.observe(canvas);

  const visibility = new IntersectionObserver(([entry]) => {
    onscreen = entry?.isIntersecting ?? true;
    if (onscreen) resume();
    else pause();
  });
  visibility.observe(canvas);

  // The theme can be forced by an attribute as well as by the system setting.
  const theme = new MutationObserver(repaint);
  theme.observe(document.documentElement, { attributeFilter: ['data-theme', 'class'] });

  const shown = () => (document.hidden ? pause() : resume());

  scheme.addEventListener('change', repaint);
  motion.addEventListener('change', settle);
  document.addEventListener('visibilitychange', shown);
  window.addEventListener('pointermove', follow, { passive: true });
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);

  resize();
  settle();

  return () => {
    pause();
    sizes.disconnect();
    visibility.disconnect();
    theme.disconnect();
    scheme.removeEventListener('change', repaint);
    motion.removeEventListener('change', settle);
    document.removeEventListener('visibilitychange', shown);
    window.removeEventListener('pointermove', follow);
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
    if (program && !gl.isContextLost()) gl.deleteProgram(program);
  };
}

import { lazy, Suspense, useEffect, useState } from 'react';
import { cx } from '@huddle/ui';

/*
 * The animated backdrop is the MeshGradient from Paper Shaders, which is open
 * source under Apache-2.0. The package is bundled with the client, so the
 * landing page makes no third party request at runtime, and the licence notice
 * it requires is served from public/third-party.
 */
export const SHADER_CREDIT = 'Mesh gradient by Paper Shaders, Apache-2.0';
export const SHADER_URL = 'https://shaders.paper.design';

const MeshGradient = lazy(async () => {
  const { MeshGradient: Gradient } = await import('@paper-design/shaders-react');
  return { default: Gradient };
});

/*
 * The colours are read from the stylesheet rather than hard coded, so the
 * gradient keeps step with tokens.css across both schemes. A custom property
 * only resolves to its substituted value once the sheet has applied, which is
 * why this runs in an effect and re-runs when the scheme flips.
 */
const TOKENS = ['--surface', '--accent-soft', '--accent', '--border-strong'] as const;

function readPalette(): string[] {
  const styles = getComputedStyle(document.documentElement);
  return TOKENS.map((token) => styles.getPropertyValue(token).trim()).filter(Boolean);
}

function hasWebGL(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

/*
 * A soft ellipse that reaches zero exactly at the sides of the box, so no
 * straight edge of the shader is ever visible against the page, biased right
 * so the light reads as coming from behind the product panel.
 */
const MASK =
  'radial-gradient(ellipse closest-side at 56% 50%, #000 0%, #000 15%, transparent 100%)';

export function HeroShader({ className }: { className?: string }) {
  const [colors, setColors] = useState<string[]>([]);
  const [still, setStill] = useState(true);

  useEffect(() => {
    if (!hasWebGL()) return;

    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const read = () => setColors(readPalette());
    const settle = () => setStill(motion.matches);

    read();
    settle();
    scheme.addEventListener('change', read);
    motion.addEventListener('change', settle);
    return () => {
      scheme.removeEventListener('change', read);
      motion.removeEventListener('change', settle);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cx(
        // The plain gradient underneath is what shows when WebGL never starts,
        // so the hero is never left with a blank hole where the shader was.
        'pointer-events-none overflow-hidden bg-[radial-gradient(70%_60%_at_68%_34%,var(--accent-soft),transparent_72%)] opacity-60 dark:opacity-80',
        className,
      )}
      style={{ maskImage: MASK, WebkitMaskImage: MASK }}
    >
      {colors.length > 0 ? (
        <Suspense fallback={null}>
          <MeshGradient
            colors={colors}
            distortion={1}
            swirl={0.4}
            grainOverlay={0.015}
            // A stopped shader still paints one frame, which is the static
            // fallback reduced motion asks for.
            speed={still ? 0 : 0.35}
            maxPixelCount={2_000_000}
            minPixelRatio={1.5}
            className="size-full"
          />
        </Suspense>
      ) : null}
    </div>
  );
}

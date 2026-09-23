import { useEffect, useRef } from 'react';
import { cx } from '@huddle/ui';
import { mountShader } from './hero-shader-gl';

/*
 * The shader is written here and the only borrowed part is the simplex noise
 * from webgl-noise, which is MIT. It is bundled, so the landing page makes no
 * third party request, and the licence it asks to travel with it is served
 * from public/third-party.
 */
export const SHADER_CREDIT =
  'Hero shader built on webgl-noise by Ashima Arts and Stefan Gustavson, MIT licence';
export const SHADER_URL = 'https://github.com/stegu/webgl-noise';

/*
 * A soft ellipse that reaches zero exactly at the sides of the box, so no
 * straight edge of the shader is ever visible against the page, biased right
 * so the light reads as coming from behind the product panel.
 */
const MASK =
  'radial-gradient(ellipse closest-side at 56% 50%, #000 0%, #000 22%, transparent 100%)';

export function HeroShader({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvas.current) return;
    return mountShader(canvas.current);
  }, []);

  return (
    <div
      // The credit is the tooltip on the backdrop itself, so it is there for
      // anyone curious about it and invisible to everyone else. The text and
      // the panel sit above this layer, so hovering them never raises it.
      title={SHADER_CREDIT}
      className={cx(
        // The plain gradient underneath is what shows when WebGL never starts,
        // so the hero is never left with a blank hole where the shader was.
        'overflow-hidden bg-[radial-gradient(70%_60%_at_68%_34%,var(--accent-soft),transparent_72%)]',
        className,
      )}
      style={{ maskImage: MASK, WebkitMaskImage: MASK }}
    >
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="size-full opacity-0 transition-opacity duration-700 data-[ready]:opacity-100 motion-reduce:transition-none"
      />
    </div>
  );
}

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import './TextLoop.css';

// Adapted from the React Bits TextLoop source supplied for this landing page.
const WAVE = 'M -320 100 Q -160 20 0 100 T 320 100 T 640 100 T 960 100 T 1280 100 T 1520 100';

export default function TextLoop({ text, speed = 60 }: { text: string; speed?: number }) {
  const pathId = `text-loop-${useId().replace(/:/g, '')}`;
  const pathRef = useRef<SVGPathElement>(null);
  const measureRef = useRef<SVGTextElement>(null);
  const headRef = useRef<SVGTextPathElement>(null);
  const tailRef = useRef<SVGTextPathElement>(null);
  const [metrics, setMetrics] = useState({ length: 0, reps: 1 });
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const unit = `${text}\u00a0·\u00a0`;

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled || !pathRef.current || !measureRef.current) return;
      const length = pathRef.current.getTotalLength();
      const width = measureRef.current.getComputedTextLength();
      const reps = width ? Math.max(1, Math.round(length / width)) : 1;
      setMetrics((previous) =>
        previous.length === length && previous.reps === reps ? previous : { length, reps },
      );
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => {
      cancelled = true;
    };
  }, [unit]);

  const tweenRef = useRef<gsap.core.Tween | null>(null);
  useEffect(() => {
    const head = headRef.current;
    const tail = tailRef.current;
    const { length } = metrics;
    if (!head || !tail || !length) return;
    const apply = (offset: number) => {
      head.setAttribute('startOffset', String(offset));
      tail.setAttribute('startOffset', String(offset - length));
    };
    apply(0);
    if (speed <= 0) return;
    const state = { offset: 0 };
    const tween = gsap.to(state, {
      offset: length,
      duration: length / speed,
      ease: 'none',
      repeat: -1,
      paused: true,
      onUpdate: () => apply(state.offset),
    });
    tweenRef.current = tween;
    return () => {
      tween.kill();
      tweenRef.current = null;
    };
  }, [metrics, speed]);

  useEffect(() => {
    tweenRef.current?.paused(paused || hovered || reducedMotion);
  }, [metrics, speed, paused, hovered, reducedMotion]);

  const repeated = unit.repeat(metrics.reps);
  return (
    <div
      className="text-loop"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className="text-loop-heading">
        <span>Every kind of good time.</span>
        <button type="button" onClick={() => setPaused((value) => !value)} disabled={reducedMotion}>
          {reducedMotion ? 'Motion reduced' : paused ? 'Resume motion' : 'Pause motion'}
        </button>
      </div>
      <svg className="text-loop-svg" viewBox="0 0 1200 200" role="img" aria-label={text}>
        <defs>
          <path ref={pathRef} id={pathId} d={WAVE} />
        </defs>
        <use
          href={`#${pathId}`}
          fill="none"
          stroke="#f1de91"
          strokeWidth={86}
          strokeLinecap="round"
          aria-hidden="true"
        />
        <text ref={measureRef} className="text-loop-measure text-loop-text" aria-hidden="true">
          {unit}
        </text>
        <text
          className="text-loop-text"
          dominantBaseline="central"
          aria-hidden="true"
          textLength={metrics.length || undefined}
          lengthAdjust="spacing"
        >
          <textPath ref={headRef} href={`#${pathId}`}>
            {repeated}
          </textPath>
        </text>
        <text
          className="text-loop-text"
          dominantBaseline="central"
          aria-hidden="true"
          textLength={metrics.length || undefined}
          lengthAdjust="spacing"
        >
          <textPath ref={tailRef} href={`#${pathId}`}>
            {repeated}
          </textPath>
        </text>
      </svg>
    </div>
  );
}

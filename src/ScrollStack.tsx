// Adapted from the React Bits ScrollStack source supplied by the site owner.
// Sticky slots own layout; transforms only affect the card inside each slot.
import {
  Children,
  Fragment,
  isValidElement,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import './ScrollStack.css';

type Length = number | string;
const toLength = (value: Length) => (typeof value === 'number' ? `${value}px` : value);

export function ScrollStackItem({
  children,
  itemClassName = '',
  style,
  labelledBy,
}: {
  children: ReactNode;
  itemClassName?: string;
  style?: CSSProperties;
  labelledBy?: string;
}) {
  return (
    <article
      className={`scroll-stack-card ${itemClassName}`.trim()}
      style={style}
      aria-labelledby={labelledBy}
    >
      {children}
      <span className="scroll-stack-card__shade" aria-hidden="true" />
    </article>
  );
}

export default function ScrollStack({
  children,
  className = '',
  itemDistance = 100,
  itemStackDistance = 0,
  stackPosition = '15%',
  itemScale = 0.05,
  baseScale = 0.8,
  dimAmount = 0.2,
  blurAmount = 0,
  tiltAmount = 0,
  rotationAmount = 0,
  liftAmount = 0,
  holdDistance = 200,
  useWindowScroll = false,
  onStackComplete,
}: {
  children: ReactNode;
  className?: string;
  itemDistance?: Length;
  itemStackDistance?: number;
  stackPosition?: Length;
  itemScale?: number;
  baseScale?: number;
  dimAmount?: number;
  blurAmount?: number;
  tiltAmount?: number;
  rotationAmount?: number;
  liftAmount?: number;
  holdDistance?: Length;
  useWindowScroll?: boolean;
  onStackComplete?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const callback = useRef(onStackComplete);
  useLayoutEffect(() => {
    callback.current = onStackComplete;
  });
  const items = Children.toArray(children);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return;
    const slots = Array.from(inner.querySelectorAll<HTMLElement>(':scope > [data-stack-slot]'));
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const target = useWindowScroll ? window : root;
    const cache = new Map<HTMLElement, string>();
    let frame = 0;
    let complete = false;
    const update = () => {
      frame = 0;
      if (!slots.length) return;
      const viewTop = useWindowScroll ? 0 : root.getBoundingClientRect().top + root.clientTop;
      // Resolve CSS variables and percentage offsets through the actual sticky slot.
      const pinTop = parseFloat(getComputedStyle(slots[0]).top) || 0;
      const heights = slots.map((slot) => slot.offsetHeight);
      const tops = slots.map((slot) => slot.getBoundingClientRect().top);
      const depths = slots.map(() => 0);
      let lastCover = 0;
      if (!motion.matches) {
        for (let next = 1; next < slots.length; next++) {
          const previousPin = viewTop + pinTop + (next - 1) * itemStackDistance;
          const start = previousPin + heights[next - 1];
          const span = Math.max(1, heights[next - 1] - itemStackDistance);
          const cover = Math.min(1, Math.max(0, (start - tops[next]) / span));
          for (let previous = 0; previous < next; previous++) depths[previous] += cover;
          lastCover = cover;
        }
      }
      slots.forEach((slot, index) => {
        const card = slot.firstElementChild as HTMLElement | null;
        if (!card) return;
        const depth = depths[index];
        const scale = Math.max(baseScale, 1 - depth * itemScale);
        const tilt = -Math.min(depth, 1) * tiltAmount;
        const turn = Math.min(depth, 1) * rotationAmount * (index % 2 ? -1 : 1);
        const blur = depth * blurAmount;
        const dim = 1 - Math.pow(1 - Math.min(1, Math.max(0, dimAmount)), depth);
        const transform =
          depth < 0.0005
            ? ''
            : `perspective(1200px) translateY(${(-depth * liftAmount).toFixed(2)}px) rotateX(${tilt.toFixed(2)}deg) rotate(${turn.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
        const filter = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : '';
        const state = `${transform}|${filter}|${dim.toFixed(3)}`;
        if (cache.get(card) === state) return;
        cache.set(card, state);
        card.style.transform = transform;
        card.style.filter = filter;
        card.style.setProperty('--scroll-stack-dim', dim.toFixed(3));
        card.style.setProperty('--stack-scale', String(scale));
      });
      const done = slots.length > 1 && lastCover >= 0.999;
      if (done !== complete) {
        complete = done;
        if (done) callback.current?.();
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(inner);
    slots.forEach((slot) => observer.observe(slot));
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    motion.addEventListener('change', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      motion.removeEventListener('change', schedule);
    };
  }, [
    useWindowScroll,
    items.length,
    itemStackDistance,
    stackPosition,
    itemScale,
    baseScale,
    dimAmount,
    blurAmount,
    tiltAmount,
    rotationAmount,
    liftAmount,
  ]);

  return (
    <div
      ref={rootRef}
      className={`scroll-stack ${useWindowScroll ? 'scroll-stack--window' : 'scroll-stack--contained'} ${className}`}
    >
      <div ref={innerRef} className="scroll-stack__inner">
        {items.map((child, index) => (
          <Fragment key={isValidElement(child) ? (child.key ?? index) : index}>
            {index > 0 && (
              <div
                className="scroll-stack__gap"
                aria-hidden="true"
                style={{
                  height: `max(0px, calc(${toLength(itemDistance)} - ${(items.length - index) * itemStackDistance}px))`,
                  marginTop: `min(0px, calc(${toLength(itemDistance)} - ${(items.length - index) * itemStackDistance}px))`,
                }}
              />
            )}
            <div className="scroll-stack__marker" aria-hidden="true" />
            <div
              data-stack-slot=""
              className="scroll-stack__slot"
              style={{
                top: `calc(${toLength(stackPosition)} + ${index * itemStackDistance}px)`,
                marginBottom: (items.length - 1 - index) * itemStackDistance,
                zIndex: index + 1,
              }}
            >
              {child}
            </div>
          </Fragment>
        ))}
        <div
          className="scroll-stack__end"
          style={{ height: toLength(holdDistance) }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './context';
import './bottom-nav.css';

const ICONS = {
  home: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path class="accent-fill" d="M3.5 11.2 12 4l8.5 7.2V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z"/><path d="M9.5 20.5v-4.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4.2"/></svg>',
  cards:
    '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect class="accent-fill" x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9.5h18M7 15h2.5M12.5 15H15"/></svg>',
  funds:
    '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path class="accent-fill" d="M9 20h9a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4z"/><path d="M6 6V5.5A1.5 1.5 0 0 1 7.5 4H16M20 11h-3.5a1.5 1.5 0 0 0 0 3H20M6.5 14v6M3.5 17h6"/></svg>',
  tx: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3"/><path class="accent-stroke" d="M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/></svg>',
  profile:
    '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle class="accent-fill" cx="12" cy="10" r="3"/><path class="accent-fill" d="M6.5 18.2c1.2-2.3 3.3-3.4 5.5-3.4s4.3 1.1 5.5 3.4"/></svg>',
  scan: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path class="accent-stroke" d="M4 12h16"/></svg>',
};

type Tab = {
  id: string;
  label: string;
  icon: string;
  to?: string;
  end?: boolean;
  action?: 'more';
};

const ORGANIZER_TABS: Tab[] = [
  { id: 'home', label: 'Home', icon: ICONS.home, to: '/dashboard', end: true },
  { id: 'events', label: 'Events', icon: ICONS.cards, to: '/dashboard/events' },
  { id: 'orders', label: 'Orders', icon: ICONS.tx, to: '/dashboard/orders' },
  { id: 'revenue', label: 'Revenue', icon: ICONS.funds, to: '/dashboard/revenue' },
  { id: 'more', label: 'More', icon: ICONS.profile, action: 'more' },
];

const SCANNER_TABS: Tab[] = [
  { id: 'scan', label: 'Scan', icon: ICONS.scan, to: '/dashboard/scan' },
  { id: 'settings', label: 'Settings', icon: ICONS.profile, to: '/dashboard/settings' },
];

const PAD = 26;
const CORNER = 18;
const BUBBLE_R = 26;
const GAP = 5;
const NOTCH_R = BUBBLE_R + GAP;
const CENTER_Y = 2;
const FILLET = 10;
const SHOULDER = Math.sqrt(Math.pow(NOTCH_R + FILLET, 2) - Math.pow(FILLET - CENTER_Y, 2));

function buildPath(w: number, cxRaw: number) {
  const cx = Math.min(Math.max(cxRaw, SHOULDER + CORNER), w - SHOULDER - CORNER);
  const k = NOTCH_R / (NOTCH_R + FILLET);
  const dx = SHOULDER * k;
  const dy = CENTER_Y + (FILLET - CENTER_Y) * k;
  const r = CORNER;
  return [
    `M ${r} 0`,
    `L ${cx - SHOULDER} 0`,
    `A ${FILLET} ${FILLET} 0 0 1 ${cx - dx} ${dy}`,
    `A ${NOTCH_R} ${NOTCH_R} 0 0 0 ${cx + dx} ${dy}`,
    `A ${FILLET} ${FILLET} 0 0 1 ${cx + SHOULDER} 0`,
    `L ${w - r} 0`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `L ${w} ${78 - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} 78`,
    `L ${r} 78`,
    `A ${r} ${r} 0 0 1 0 ${78 - r}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}

function activeIndex(tabs: Tab[], pathname: string) {
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (!tab.to) continue;
    if (tab.end ? pathname === tab.to : pathname === tab.to || pathname.startsWith(`${tab.to}/`))
      return i;
  }
  return tabs.length - 1;
}

export function BottomNav({ onMore }: { onMore: () => void }) {
  const { user } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = user?.role === 'scanner' ? SCANNER_TABS : ORGANIZER_TABS;
  const index = activeIndex(tabs, location.pathname);

  const navRef = useRef<HTMLElement | null>(null);
  const shapeRef = useRef<SVGPathElement | null>(null);
  const stateRef = useRef({ x: 0, v: 0, target: 0, w: 0, ready: false, raf: 0, last: 0 });
  const indexRef = useRef(index);
  indexRef.current = index;
  const countRef = useRef(tabs.length);
  countRef.current = tabs.length;

  useEffect(() => {
    const nav = navRef.current;
    const shape = shapeRef.current;
    if (!nav || !shape) return;
    const s = stateRef.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const paint = () => {
      shape.setAttribute('d', buildPath(s.w, s.x));
      nav.style.setProperty('--notch-x', `${s.x}px`);
    };
    const targetFor = (i: number) => PAD + ((i + 0.5) * (s.w - PAD * 2)) / countRef.current;
    const run = () => {
      cancelAnimationFrame(s.raf);
      if (reduce) {
        s.x = s.target;
        s.v = 0;
        paint();
        return;
      }
      s.last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min((now - s.last) / 1000, 0.032);
        s.last = now;
        s.v += (-170 * (s.x - s.target) - 17 * s.v) * dt;
        s.x += s.v * dt;
        paint();
        if (Math.abs(s.v) > 0.05 || Math.abs(s.x - s.target) > 0.05)
          s.raf = requestAnimationFrame(tick);
        else {
          s.x = s.target;
          s.v = 0;
          paint();
        }
      };
      s.raf = requestAnimationFrame(tick);
    };
    const measure = () => {
      s.w = nav.offsetWidth;
      s.target = targetFor(indexRef.current);
      if (!s.ready) {
        s.x = s.target;
        s.ready = true;
        paint();
      } else run();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(s.raf);
    };
  }, []);

  useEffect(() => {
    const s = stateRef.current;
    if (!s.ready) return;
    const nav = navRef.current;
    if (!nav) return;
    s.target = PAD + ((index + 0.5) * (s.w - PAD * 2)) / countRef.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shape = shapeRef.current;
    if (!shape) return;
    const paint = () => {
      shape.setAttribute('d', buildPath(s.w, s.x));
      nav.style.setProperty('--notch-x', `${s.x}px`);
    };
    if (reduce) {
      cancelAnimationFrame(s.raf);
      s.x = s.target;
      s.v = 0;
      paint();
      return;
    }
    cancelAnimationFrame(s.raf);
    s.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - s.last) / 1000, 0.032);
      s.last = now;
      s.v += (-170 * (s.x - s.target) - 17 * s.v) * dt;
      s.x += s.v * dt;
      paint();
      if (Math.abs(s.v) > 0.05 || Math.abs(s.x - s.target) > 0.05)
        s.raf = requestAnimationFrame(tick);
      else {
        s.x = s.target;
        s.v = 0;
        paint();
      }
    };
    s.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(s.raf);
  }, [index]);

  return (
    <nav className="bn" ref={navRef} aria-label="Main navigation">
      <svg className="bn__shape" aria-hidden="true">
        <path ref={shapeRef} />
      </svg>
      <div className="bn__bubble" aria-hidden="true">
        <span key={tabs[index].id} dangerouslySetInnerHTML={{ __html: tabs[index].icon }} />
      </div>
      <ul className="bn__list" style={{ '--bn-count': tabs.length } as React.CSSProperties}>
        {tabs.map((tab, i) => (
          <li key={tab.id} style={{ display: 'contents' }}>
            <button
              type="button"
              className="bn__item"
              aria-current={i === index ? 'page' : undefined}
              onClick={() => (tab.action === 'more' ? onMore() : tab.to && navigate(tab.to))}
            >
              <span className="bn__icon" dangerouslySetInnerHTML={{ __html: tab.icon }} />
              <span className="bn__label">{tab.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <span className="bn__indicator" aria-hidden="true" />
    </nav>
  );
}

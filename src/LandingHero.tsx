import { ArrowUpRight, AudioLines, Check, MapPin, Ticket } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import TextLoop from './TextLoop';
import './landing-hero.css';

type HeroProps = { workspaceUrl: string; browse: (category?: string) => void };
const heroStories = {
  music: { category: 'Music', image: '/assets/sunset-sessions.jpg', title: 'Find your rhythm.' },
  nightlife: {
    category: 'Nightlife',
    image: '/assets/niffer-party.jpg',
    title: 'Make it a night.',
  },
  arts: { category: 'Arts', image: '/assets/creative-table.jpg', title: 'Make room for art.' },
};

function StoryPhoto({
  story,
  priority = false,
}: {
  story: typeof heroStories.music;
  priority?: boolean;
}) {
  return (
    <img
      src={story.image}
      alt=""
      width={640}
      height={800}
      fetchPriority={priority ? 'high' : 'auto'}
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
    />
  );
}

function HeroShowcase({ browse }: Pick<HeroProps, 'browse'>) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const frame = frameRef.current,
      stage = stageRef.current;
    if (!frame || !stage) return;
    const measure = () => {
      setScale(
        window.matchMedia('(min-width: 701px)').matches
          ? Math.min(1, frame.clientHeight / Math.max(1, stage.offsetHeight))
          : 1,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="hero-showcase-fit" ref={frameRef}>
      <div
        className="hero-showcase"
        ref={stageRef}
        style={{ '--showcase-scale': scale } as CSSProperties}
        aria-label="Discover your next experience"
      >
        <div className="hero-orbits" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <button
          className="hero-phone"
          onClick={() => browse('Nightlife')}
          aria-label="Explore nightlife events"
        >
          <span className="hero-phone-screen">
            <StoryPhoto story={heroStories.nightlife} priority />
            <span className="hero-phone-speaker" aria-hidden="true" />
            <span className="hero-phone-top">
              <span className="hero-profile-icon">
                <Ticket size={16} />
              </span>
              <span>
                golden.<small>YOUR NEXT NIGHT OUT</small>
              </span>
              <span className="hero-night-badge">
                <span />
                Nightlife
              </span>
            </span>
            <span className="hero-phone-caption">
              <span>AFTER DARK, ALL TOGETHER</span>
              <strong>{heroStories.nightlife.title}</strong>
              <span className="hero-phone-link">
                Explore nightlife
                <ArrowUpRight size={20} />
              </span>
            </span>
            <span className="hero-phone-home" aria-hidden="true" />
          </span>
        </button>

        <button
          className="hero-media-card"
          onClick={() => browse('Music')}
          aria-label="Explore music events"
        >
          <StoryPhoto story={heroStories.music} />
          <span className="hero-media-tag">
            <AudioLines size={13} />
            Music
          </span>
          <span className="hero-media-caption">
            <strong>{heroStories.music.title}</strong>
            <ArrowUpRight size={19} />
          </span>
        </button>

        <button
          className="hero-art-card"
          onClick={() => browse('Arts')}
          aria-label="Explore arts events"
        >
          <span className="hero-art-photo">
            <StoryPhoto story={heroStories.arts} />
            <span>ARTS & CULTURE</span>
          </span>
          <span className="hero-art-caption">
            <span>
              <small>A LITTLE INSPIRATION</small>
              <strong>{heroStories.arts.title}</strong>
            </span>
            <ArrowUpRight size={20} />
          </span>
        </button>

        <div className="hero-people-badge">
          <span>Good people. Great plans.</span>
        </div>

        <a href="#events" className="hero-ticket-card">
          <span className="hero-ticket-illustration" aria-hidden="true">
            <Ticket size={51} strokeWidth={1.4} />
            <span>
              <Check size={12} />
            </span>
          </span>
          <span>
            <small>LESS FUSS. MORE FUN.</small>
            <strong>
              Book. Scan. <br />
              You’re in.
            </strong>
          </span>
          <ArrowUpRight size={18} />
        </a>

        <a href="#experiences" className="hero-moment-card">
          <span className="hero-moment-kicker">GO WHERE YOU FEEL IT.</span>
          <strong>
            Your kind
            <br />
            of good time.
          </strong>
          <span className="hero-location-pill">
            <MapPin size={12} />
            Dar es Salaam & beyond
          </span>
          <ArrowUpRight className="hero-moment-arrow" size={20} />
        </a>
      </div>
    </div>
  );
}

export function LandingHero({ workspaceUrl, browse }: HeroProps) {
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [wordWindowWidth, setWordWindowWidth] = useState<number>();
  const wordWindowRef = useRef<HTMLSpanElement>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const interval = window.setInterval(() => {
      setHeadlineIndex((current) => (current + 1) % 2);
    }, 2600);
    return () => window.clearInterval(interval);
  }, []);

  useLayoutEffect(() => {
    const windowElement = wordWindowRef.current;
    const activeWord = wordRefs.current[headlineIndex];
    if (!windowElement || !activeWord) return;

    const measure = () => {
      const style = window.getComputedStyle(windowElement);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setWordWindowWidth(Math.ceil(activeWord.getBoundingClientRect().width + padding));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(activeWord);
    return () => observer.disconnect();
  }, [headlineIndex]);

  return (
    <div className="landing-opening-chapter">
      <section
        className="landing-hero-v2 landing-hero-split"
        aria-labelledby="hero-title"
      >
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <span />
            DAR ES SALAAM & BEYOND
          </div>
          <h1 id="hero-title">
            <span className="sr-only">Great stories</span>
            <span className="hero-headline-visual" aria-hidden="true">
              Great
              <span
                className="hero-word-window"
                ref={wordWindowRef}
                style={wordWindowWidth ? { width: `${wordWindowWidth}px` } : undefined}
              >
                <span
                  className="hero-word-track"
                  style={{ transform: `translateY(-${headlineIndex * 1.08}em)` }}
                >
                  <span ref={(element) => { wordRefs.current[0] = element; }}>
                    stories <i>✨</i>
                  </span>
                  <span ref={(element) => { wordRefs.current[1] = element; }}>
                    times <i>🎉</i>
                  </span>
                </span>
              </span>
            </span>
          </h1>
          <p>
            The nights you talk about. The people you meet. <br />
            Find your next unforgettable moment, right here.
          </p>
          <div className="hero-actions">
            <a className="hero-action hero-action-primary" href="#events">
              Find your next event
              <ArrowUpRight size={18} />
            </a>
            <a className="hero-action hero-action-secondary" href={workspaceUrl}>
              Create an event
              <ArrowUpRight size={18} />
            </a>
          </div>
        </div>
        <HeroShowcase browse={browse} />
      </section>
      <div className="hero-loop-reveal" data-scroll-reveal>
        <TextLoop text="Music · Nightlife · Community · Arts" />
      </div>
    </div>
  );
}

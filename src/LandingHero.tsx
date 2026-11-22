import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ScrollStack, { ScrollStackItem } from './ScrollStack';
import TextLoop from './TextLoop';
import './landing-hero.css';
import './hero-stack.css';

const stories = [
  {
    category: 'Sports',
    title: 'For the love\nof the game.',
    eyebrow: 'THE CROWD. THE RUSH. THE MOMENT.',
    description:
      'From the first whistle to the final roar. Find match days, races, and sporting moments that bring everyone to their feet.',
    tags: ['Match days', 'Outdoor adventures', 'Big energy'],
    image: 'sports',
    alt: 'Crowds watching a football match in a floodlit stadium',
    accent: '#356448',
  },
  {
    category: 'Music',
    title: 'Feel every\nsingle beat.',
    eyebrow: 'YOUR SOUND. YOUR PEOPLE.',
    description:
      'Live voices. Hands in the air. That one song you’ll remember forever. Get closer to the music you love.',
    tags: ['Live concerts', 'Festivals', 'Good vibrations'],
    image: 'music',
    alt: 'Music fans raising their hands beneath blue confetti',
    accent: '#7565a5',
  },
  {
    category: 'Nightlife',
    title: 'A little later.\nA lot louder.',
    eyebrow: 'AFTER DARK, ALL TOGETHER.',
    description:
      'Find your dance floor. Meet your next favourite DJ. Make a night of it, with good company and one more song.',
    tags: ['DJ sets', 'Dance floors', 'After hours'],
    image: 'nightlife',
    alt: 'A crowd enjoying a live show after dark',
    accent: '#a7482c',
  },
  {
    category: 'Community',
    title: 'Good people.\nGreat company.',
    eyebrow: 'STRANGERS TODAY. FRIENDS TOMORROW.',
    description:
      'Shared interests, fresh faces, and a reason to get together. Discover gatherings that make your world feel a little closer.',
    tags: ['Meet-ups', 'Shared passions', 'New connections'],
    image: 'community',
    alt: 'People spending an afternoon together in a green park',
    accent: '#356448',
  },
  {
    category: 'Culture',
    filter: 'Arts',
    title: 'Many stories.\nOne rhythm.',
    eyebrow: 'ROOTED HERE. SHARED TOGETHER.',
    description:
      'Celebrate the traditions, creativity, and stories that make us who we are. There’s always something worth being part of.',
    tags: ['Arts & culture', 'Local traditions', 'Creative moments'],
    image: 'culture',
    alt: 'A community celebrating together with traditional drumming',
    accent: '#a7482c',
  },
];

export function LandingHero({
  workspaceUrl,
  browse,
}: {
  workspaceUrl: string;
  browse: (category?: string) => void;
}) {
  const [word, setWord] = useState(0);
  const wordWindow = useRef<HTMLSpanElement>(null);
  const [wordWidth, setWordWidth] = useState<number>();
  useLayoutEffect(() => {
    const windowElement = wordWindow.current;
    const active = windowElement?.querySelector('.hero-word-track')?.children[word];
    if (!windowElement || !(active instanceof HTMLElement)) return;
    const measure = () => {
      const style = getComputedStyle(windowElement);
      setWordWidth(
        Math.ceil(
          active.getBoundingClientRect().width +
            parseFloat(style.paddingLeft) +
            parseFloat(style.paddingRight),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(active);
    return () => observer.disconnect();
  }, [word]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      if (preference.matches) setWord(0);
      else timer = setInterval(() => setWord((value) => (value + 1) % 2), 2600);
    };
    update();
    preference.addEventListener('change', update);
    return () => {
      clearInterval(timer);
      preference.removeEventListener('change', update);
    };
  }, []);

  return (
    <div className="landing-opening-chapter">
      <section className="hero-stack-lead" aria-labelledby="hero-title">
        <div className="hero-eyebrow">
          <span /> DAR ES SALAAM &amp; BEYOND
        </div>
        <h1 id="hero-title">
          <span className="sr-only">Great stories. Great times.</span>
          <span aria-hidden="true" className="hero-headline-visual">
            Great{' '}
            <span
              className="hero-word-window"
              ref={wordWindow}
              style={wordWidth ? { width: wordWidth } : undefined}
            >
              <span
                className="hero-word-track"
                style={{ transform: `translateY(-${word * 1.08}em)` }}
              >
                <span>
                  stories <i>✨</i>
                </span>
                <span>
                  times <i>🎉</i>
                </span>
              </span>
            </span>
          </span>
        </h1>
        <p>
          The nights you talk about. The people you meet.
          <br />
          Find your next unforgettable moment, right here.
        </p>
        <div className="hero-actions">
          <a className="hero-action hero-action-primary" href="#events">
            Find your next event <ArrowUpRight size={18} />
          </a>
          <a className="hero-action hero-action-secondary" href={workspaceUrl}>
            Create an event <ArrowUpRight size={18} />
          </a>
        </div>
      </section>
      <section className="hero-stack-section" aria-label="Find your kind of event">
        <div className="hero-stack-intro">
          <span>EVERY KIND OF GOOD TIME.</span>
          <span>
            Scroll to find yours <ArrowDown size={14} />
          </span>
        </div>
        <ScrollStack
          className="hero-stack"
          useWindowScroll
          itemDistance="var(--hero-stack-gap)"
          stackPosition="var(--hero-stack-top)"
          itemScale={0.045}
          liftAmount={12}
          baseScale={0.82}
          dimAmount={0.035}
          holdDistance="100svh"
        >
          {stories.map((story, index) => (
            <ScrollStackItem
              key={story.category}
              itemClassName={`hero-stack-card${index % 2 ? ' hero-stack-reverse' : ''}`}
              labelledBy={`hero-story-${index}`}
            >
              <div className="hero-stack-copy">
                <span className="hero-stack-eyebrow" style={{ color: story.accent }}>
                  {story.eyebrow}
                </span>
                <h2 id={`hero-story-${index}`} style={{ color: story.accent }}>
                  {story.title}
                </h2>
                <p>{story.description}</p>
                <ul aria-label={`${story.category} experiences`}>
                  {story.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
                <button
                  className="hero-stack-cta"
                  style={{ background: story.accent }}
                  onClick={() => browse(story.filter || story.category)}
                >
                  Explore {story.category.toLowerCase()} <ArrowUpRight size={18} />
                </button>
                <span className="hero-stack-number">
                  <span>{String(index + 1).padStart(2, '0')} / 05</span>
                  {story.category}
                </span>
              </div>
              <div className="hero-stack-photo">
                <img
                  src={`/assets/hero-${story.image}.webp`}
                  alt={story.alt}
                  width={900}
                  height={1000}
                  fetchPriority={index === 0 ? 'high' : 'auto'}
                  loading={index < 2 ? 'eager' : 'lazy'}
                />
                <span>{story.category}</span>
              </div>
            </ScrollStackItem>
          ))}
        </ScrollStack>
      </section>
      <div className="hero-loop-reveal" data-scroll-reveal>
        <TextLoop text="Music · Nightlife · Community · Arts" />
      </div>
    </div>
  );
}

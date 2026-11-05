import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  Menu,
  X,
  Ticket,
  Wallet,
  ScanLine,
  BarChart3,
  Plus,
} from 'lucide-react';
import { Brand } from './ui';
import { useApp } from './context';
import { money } from './api';
import './landing.css';
import './pricing.css';

export function PricingPage() {
  const { config, user } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const [price, setPrice] = useState('20000');
  const [quantity, setQuantity] = useState('100');
  const rate = config.platformFeeBps;
  const valid =
    price !== '' &&
    quantity !== '' &&
    Number.isInteger(Number(price)) &&
    Number(price) >= 100 &&
    Number(price) <= 10000000 &&
    Number.isInteger(Number(quantity)) &&
    Number(quantity) >= 1 &&
    Number(quantity) <= 100000;
  // The Revenue ledger rounds the fee once per order, to whole TZS.
  const gross = Number(price) * Number(quantity);
  const fee = Math.floor((Number(price) * rate + 5000) / 10000) * Number(quantity);
  const workspace = `${config.appOrigin}${user ? '/dashboard' : '/login'}`;
  useEffect(() => {
    const title = document.title;
    document.title = 'Pricing · Golden Events';
    return () => {
      document.title = title;
    };
  }, []);
  return (
    <div className="landing-page pricing-page" id="top">
      <a className="landing-skip" href="#pricing-main">
        Skip to pricing
      </a>
      <header
        className="landing-header landing-header-v2 landing-container"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setMenuOpen(false);
            menu.current?.focus();
          }
        }}
      >
        <Link to="/" aria-label="Golden Events home" className="landing-logo-link">
          <Brand ticketLogo />
        </Link>
        <nav className="landing-desktop-nav" aria-label="Main navigation">
          <a href="/#events">Discover events</a>
          <a href="/#experiences">Experiences</a>
          <a href="/#organizers">For organizers</a>
          <Link to="/pricing" aria-current="page">
            Pricing
          </Link>
        </nav>
        <div className="landing-header-actions">
          <a className="landing-button landing-button-outline" href={workspace}>
            {user ? 'My workspace' : 'Create an event'} <ArrowUpRight size={17} />
          </a>
          <button
            ref={menu}
            className="landing-icon-button landing-menu-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="pricing-mobile-nav"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        {menuOpen && (
          <nav
            id="pricing-mobile-nav"
            className="landing-mobile-nav"
            aria-label="Mobile navigation"
          >
            <a href="/#events">Discover events</a>
            <a href="/#experiences">Experiences</a>
            <a href="/#organizers">For organizers</a>
            <Link to="/pricing" aria-current="page" onClick={() => setMenuOpen(false)}>
              Pricing
            </Link>
          </nav>
        )}
      </header>
      <main id="pricing-main">
        <section className="pricing-hero landing-container">
          <div className="pricing-intro">
            <span className="landing-label">GOOD EVENTS. CLEAR NUMBERS.</span>
            <h1>
              Your moment.
              <br />
              <span>More possibility.</span>
            </h1>
            <p>Bring people together. We’ll help with the tickets. Here’s how the numbers work.</p>
            <a href="#calculator" className="pricing-text-link">
              Work out your earnings <ArrowUpRight size={20} />
            </a>
            <div className="pricing-location">
              <span>●</span> Tanzania · All amounts in TZS
            </div>
          </div>
          <div className="pricing-ticket">
            <div className="pricing-ticket-top">
              <Ticket size={27} />
              <span>THE GOLDEN EVENTS FEE</span>
            </div>
            <div className="pricing-rate">
              {rate / 100}
              <span>%</span>
            </div>
            <h2>On your ticket sales.</h2>
            <p>The Golden Events platform fee is deducted from successful ticket sales.</p>
            <div className="pricing-ticket-divider" />
            <div className="pricing-charge">
              <Wallet size={20} />
              <div>
                <strong>Provider charges, separately</strong>
                <p>
                  Collection and payout charges depend on the provider. Final withdrawal charges are
                  confirmed before sending.
                </p>
              </div>
            </div>
            <a className="landing-button pricing-dark-button" href={workspace}>
              Create your event <ArrowUpRight size={18} />
            </a>
            <small>Your sales and fee breakdown live in the Revenue tab.</small>
          </div>
        </section>
        <section className="pricing-included landing-container" aria-labelledby="included-title">
          <div>
            <span className="landing-label">LESS ADMIN. MORE EVENT.</span>
            <h2 id="included-title">
              The tools behind
              <br />a good time.
            </h2>
          </div>
          <ul>
            {[
              'Your own event page and shareable link',
              'Mobile money ticket checkout',
              'Individual QR tickets and gate scanning',
              'Sales, guest lists, and revenue reports',
            ].map((text) => (
              <li key={text}>
                <Check size={18} />
                {text}
              </li>
            ))}
          </ul>
        </section>
        <section
          className="pricing-calculator landing-container"
          id="calculator"
          aria-labelledby="calculator-title"
        >
          <div className="pricing-calculator-intro">
            <span className="landing-label">LET’S RUN THE NUMBERS</span>
            <h2 id="calculator-title">
              Big plans.
              <br />
              Clear earnings.
            </h2>
            <p>
              Try a ticket price and an expected crowd. See what remains after the {rate / 100}%
              Golden Events fee.
            </p>
            <span className="pricing-calculator-icon">
              <BarChart3 size={48} strokeWidth={1.4} />
            </span>
          </div>
          <div className="pricing-calculator-form">
            <div className="pricing-inputs">
              <label>
                Ticket price (TZS)
                <input
                  type="number"
                  min="100"
                  max="10000000"
                  step="1"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label>
                Tickets sold
                <input
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
            </div>
            <div className="pricing-calculation" aria-live="polite" aria-atomic="true">
              <div>
                <span>Gross ticket sales</span>
                <strong>{valid ? `TZS ${money(gross)}` : '—'}</strong>
              </div>
              <div>
                <span>Golden Events fee ({rate / 100}%)</span>
                <strong>{valid ? `− TZS ${money(fee)}` : '—'}</strong>
              </div>
              <div className="pricing-net">
                <span>You keep, before provider charges</span>
                <strong>{valid ? `TZS ${money(gross - fee)}` : '—'}</strong>
              </div>
            </div>
            <p className="pricing-estimate-note">
              {valid
                ? 'Estimate assumes one ticket per order. Fees are rounded per order to whole TZS. Collection and payout charges are additional; refunds and actual order sizes can change the final amount.'
                : 'Enter a whole-shilling price from TZS 100 to 10,000,000 and 1 to 100,000 tickets.'}
            </p>
          </div>
        </section>
        <section className="pricing-faq landing-container" aria-labelledby="faq-title">
          <div>
            <span className="landing-label">A FEW GOOD QUESTIONS</span>
            <h2 id="faq-title">
              Before the
              <br />
              doors open.
            </h2>
            <p>
              Know what goes in.
              <br />
              Know what comes out.
            </p>
          </div>
          <div>
            {[
              [
                'How is the Golden Events fee calculated?',
                `The platform fee is ${rate / 100}% of successful ticket sales. The fee is calculated per order and rounded to the nearest whole Tanzanian shilling. Your Revenue tab shows the breakdown.`,
              ],
              [
                'Are payment provider charges included?',
                'Provider charges are separate from the Golden Events fee. Collection charges and confirmed payout charges are reflected in your earnings. Any final withdrawal charge is shown before sending.',
              ],
              [
                'Where can I track my earnings?',
                'Open Revenue in your organizer dashboard to see your sales and earnings. Your live dashboard is the source of truth for confirmed fees and available balances.',
              ],
              [
                'Does this calculator show my final payout?',
                'It is a planning estimate, before collection and payout charges. It assumes one ticket per order. Your actual order sizes, refunds, provider charges, and available balance determine the final amount.',
              ],
              [
                'What do guests need to buy a ticket?',
                'Guests choose their tickets and enter their mobile money number. Payment is confirmed by the provider before tickets are issued. Guests never enter their mobile money PIN on Golden Events.',
              ],
            ].map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <Plus size={19} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="pricing-cta landing-container">
          <ScanLine size={40} strokeWidth={1.5} />
          <span className="landing-label">FROM THE FIRST TICKET TO THE LAST DANCE.</span>
          <h2>
            Make it a<br />
            <span>Golden moment.</span>
          </h2>
          <div>
            <a className="landing-button pricing-dark-button" href={workspace}>
              Create an event <ArrowUpRight size={18} />
            </a>
            <a className="landing-button landing-button-outline" href="/#events">
              Discover events <ArrowUpRight size={18} />
            </a>
          </div>
        </section>
      </main>
      <footer className="pricing-footer landing-container">
        <Link to="/" aria-label="Golden Events home">
          <Brand ticketLogo />
        </Link>
        <span>© {new Date().getFullYear()} Golden Creation</span>
        <Link to="/pricing">Pricing</Link>
        <Link to="/status">
          System status <ArrowUpRight size={14} />
        </Link>
      </footer>
    </div>
  );
}

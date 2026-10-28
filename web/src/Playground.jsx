// "Lumen": a small, made-up product page to pick from. Ours, so judges can
// capture freely; every piece has something worth keeping.
import "./playground.css";

export const SAMPLES = [
  {
    target: "cta",
    label: "The pill button",
    title: "Calm pill button with sliding arrow",
    note: "Love how calm this button is. Fully rounded, soft inner highlight, and the arrow slides right on hover instead of the whole thing moving. I want this for the contact link on my portfolio. #hover",
    project: "portfolio",
  },
  {
    target: "pricing",
    label: "Pricing card depth",
    title: "Featured pricing card",
    note: "The featured plan lifts off the page with a tinted border and a long, very soft shadow, so it feels chosen without shouting. Good reference for my pricing section.",
    project: "portfolio",
  },
  {
    target: "nav",
    label: "Glass nav",
    title: "Frosted glass navigation",
    note: "Frosted nav that blurs the page behind it, with a hairline border at the bottom. The links are muted until hover. Keep the blur subtle like this.",
    project: "",
  },
  {
    target: "headline",
    label: "Serif headline",
    title: "Serif headline with gradient words",
    note: "A serif headline with a warm gradient on the last two words. Tight letter spacing at this size. #typography",
    project: "",
  },
];

export function Playground({ frameRef }) {
  return (
    <div className="lumen" ref={frameRef}>
      <nav className="lumen-nav" data-sample="nav" aria-label="Lumen (demo site)">
        <span className="lumen-logo">
          <span className="lumen-dot" aria-hidden="true" /> Lumen
        </span>
        <span className="lumen-links">
          <a href="#lumen" onClick={(e) => e.preventDefault()}>Product</a>
          <a href="#lumen" onClick={(e) => e.preventDefault()}>Pricing</a>
          <a href="#lumen" onClick={(e) => e.preventDefault()}>Changelog</a>
        </span>
        <a className="lumen-ghost" href="#lumen" onClick={(e) => e.preventDefault()}>Sign in</a>
      </nav>

      <header className="lumen-hero">
        <p className="lumen-eyebrow">Calm analytics for small teams</p>
        <h3 className="lumen-headline" data-sample="headline">
          Numbers you can <em>actually read</em>
        </h3>
        <p className="lumen-lead">One quiet dashboard instead of twelve loud ones. Lumen tells you what changed and why.</p>
        <div className="lumen-actions">
          <a className="lumen-cta" data-sample="cta" href="#lumen" onClick={(e) => e.preventDefault()}>
            Start free
          </a>
          <span className="lumen-note">No card needed</span>
        </div>
      </header>

      <section className="lumen-pricing" aria-label="Lumen pricing (demo)">
        <article className="lumen-plan">
          <p className="lumen-plan-name">Solo</p>
          <p className="lumen-price">$0</p>
          <p className="lumen-plan-text">One project, all the charts.</p>
        </article>
        <article className="lumen-plan lumen-plan--featured" data-sample="pricing">
          <p className="lumen-badge">Most teams</p>
          <p className="lumen-plan-name">Team</p>
          <p className="lumen-price">
            $24<span>/mo</span>
          </p>
          <p className="lumen-plan-text">Unlimited projects, shared views, weekly digest.</p>
        </article>
      </section>

      <figure className="lumen-quote" data-sample="quote">
        <blockquote>“It's the first dashboard my whole team opens without being asked.”</blockquote>
        <figcaption>
          <span className="lumen-avatar" aria-hidden="true">MK</span> Mira K., head of growth
        </figcaption>
      </figure>
    </div>
  );
}

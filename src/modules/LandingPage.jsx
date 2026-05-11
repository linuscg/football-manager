export default function LandingPage({ onLogin, onRequestInvite }) {
  return (
    <div className="land-root">

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="land-hero">
        <div className="land-hero-inner">

          <div className="land-brand">
            <img src="/favicon.svg" alt="FM" className="land-logo" />
            <span className="land-wordmark">Football Manager</span>
          </div>

          <h1 className="land-headline">
            Production management<br />
            <span className="land-headline-accent">built for film.</span>
          </h1>

          <p className="land-tagline">
            Schedules, call sheets, crew bookings, budgets and catering — all in one place.
          </p>

          <div className="land-ctas">
            <button className="land-btn land-btn--primary" onClick={onLogin}>
              Log In
            </button>
            <button className="land-btn land-btn--outline" onClick={onRequestInvite}>
              Request Invite
            </button>
          </div>
        </div>

        {/* decorative grid lines */}
        <div className="land-hero-grid" aria-hidden="true" />
      </section>

      {/* ── About ─────────────────────────────────────────────────────────────── */}
      <section className="land-about">
        <div className="land-about-inner">
          <div className="land-about-label">About</div>
          <h2 className="land-about-heading">What is Football Manager?</h2>
          <p className="land-about-body">
            Football Manager is a production-management platform designed for the pace and
            complexity of real film sets. From pre-production scheduling and cast breakdowns
            to daily call sheets, crew-time tracking, and catering numbers — everything lives
            in a single, fast, collaborative workspace. Invite your whole team, assign roles,
            and keep every department in sync from first day of prep through final wrap.
          </p>
          <div className="land-about-pills">
            <span className="land-pill">Shoot scheduling</span>
            <span className="land-pill">Call sheets</span>
            <span className="land-pill">Crew gantt</span>
            <span className="land-pill">Cost tracking</span>
            <span className="land-pill">Catering</span>
            <span className="land-pill">Timesheets</span>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
      <footer className="land-footer">
        <span>© 2026 Football Manager</span>
        <span className="land-footer-sep">·</span>
        <span>All rights reserved</span>
      </footer>

    </div>
  )
}

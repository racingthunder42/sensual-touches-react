import { useEffect } from "react";
import { privacySections, terms } from "../data/policies";

const pageContent = {
  terms: {
    eyebrow: "Policies",
    title: "Terms & Conditions",
    introduction:
      "These terms explain the booking, payment, conduct, privacy, and mobile-service expectations that apply when reserving a session.",
    sections: terms,
  },
  privacy: {
    eyebrow: "Privacy",
    title: "Privacy Policy",
    introduction:
      "This policy explains what the current site stores, why it is used, and the choices available to clients.",
    sections: privacySections,
  },
};

export default function LegalPage({ type }) {
  const content = pageContent[type] || pageContent.terms;

  useEffect(() => {
    document.title = `${content.title} | Sensual Touches by Lotus`;
    window.scrollTo(0, 0);
  }, [content.title]);

  return (
    <div className="legal-shell">
      <header className="legal-header">
        <a className="legal-logo" href="/">
          Sensual Touches <span>by Lotus</span>
        </a>
        <nav className="legal-links" aria-label="Legal pages">
          <a href="/terms" aria-current={type === "terms" ? "page" : undefined}>
            Terms
          </a>
          <a
            href="/privacy"
            aria-current={type === "privacy" ? "page" : undefined}
          >
            Privacy
          </a>
          <a className="btn-primary" href="/#booking">
            Book a Session
          </a>
        </nav>
      </header>

      <main className="legal-page">
        <div className="legal-intro">
          <p className="section-label">{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p>{content.introduction}</p>
          <small>Last updated: 3 July 2026</small>
        </div>

        <article className="legal-document">
          {content.sections.map((section) => (
            <section className="legal-section" key={section.title}>
              <h2>
                {"icon" in section && <span aria-hidden="true">{section.icon}</span>}
                {section.title}
              </h2>
              <p>{section.text}</p>
            </section>
          ))}
        </article>

        <div className="legal-bottom-actions">
          <a className="btn-outline" href="/">
            Back to Main Site
          </a>
          <a className="btn-primary" href="/#booking">
            Book a Session
          </a>
        </div>
      </main>

      <footer className="legal-footer">
        <div className="footer-logo">Sensual Touches</div>
        <p className="footer-note">
          Private, discreet mobile wellness sessions by appointment.
        </p>
      </footer>
    </div>
  );
}

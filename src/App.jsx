import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import VisitorChat from "./chat/VisitorChat";
import { apiRequest } from "./lib/chatApi";
import { terms } from "./data/policies";

const services = [
  {
    name: "Oasis Aloe Body Wrap",
    summary: "Hydrating aloe treatment that soothes and restores the skin.",
    description:
      "A deeply nourishing full-body treatment using aloe vera to hydrate, soothe, and rejuvenate your skin. Perfect for restoration and relaxation.",
    price: 200,
  },
  {
    name: "Keratin Permanent Straightener",
    summary: "Long-lasting smoothing for frizz-free, manageable hair.",
    description:
      "Professional keratin treatment for smooth, frizz-free hair with long-lasting results. Restores shine and manageability.",
    price: 200,
  },
  {
    name: "Energy Healing Session",
    summary: "A guided holistic session focused on stress relief and balance.",
    description:
      "A holistic session designed to realign your body's energy, reduce stress, and restore inner balance through guided energetic techniques.",
    price: 210,
  },
  {
    name: "Aromatherapy Massage",
    summary: "Relaxing massage with essential oils selected for your needs.",
    description:
      "A therapeutic massage incorporating premium essential oils chosen for your mood and needs. Calms the mind while relieving muscle tension.",
    price: 200,
  },
  {
    name: "Deep Tissue Massage",
    summary: "Focused pressure for chronic tension, knots, and discomfort.",
    description:
      "Targeting deeper muscle layers, this intense massage relieves chronic pain, knots, and tension. Ideal for athletes and those with persistent discomfort.",
    price: 250,
  },
  {
    name: "Swedish Massage",
    summary: "Classic flowing strokes for full-body relaxation.",
    description:
      "The classic full-body relaxation massage using long, flowing strokes to ease tension, improve circulation, and melt away stress.",
    price: 300,
  },
  {
    name: "Nuru Massage",
    summary: "Japanese-inspired body-to-body massage using specialist gel.",
    description:
      "An indulgent Japanese-inspired body-to-body massage experience using a special gel for a uniquely immersive and therapeutic session.",
    price: 350,
    badge: "Special",
  },
];

const paymentMethods = [
  { name: "CashApp", icon: "$" },
  { name: "Venmo", icon: "V" },
  { name: "Bitcoin", icon: "₿" },
  { name: "Zelle", icon: "Z" },
  { name: "Apple Pay", icon: "A" },
  { name: "Chime", icon: "C" },
  { name: "PayPal", icon: "P" },
];
const autoReplies = {
  price:
    "Our sessions range from $200 to $350 depending on the service. Check the Services section for full pricing! 💆",
  book:
    "You can book directly on this page. Go to the Book Your Session section and fill out the form. 📅",
  payment:
    "We accept CashApp, Venmo, Bitcoin, Zelle, Apple Pay, Chime, and PayPal. A $150 booking fee is required upfront and deducted from your total. 💳",
  service:
    "We offer seven services: Oasis Aloe Body Wrap, Keratin Treatment, Energy Healing, Aromatherapy, Deep Tissue, Swedish, and Nuru Massage. 🌿",
  location:
    "Lotus is mobile and comes to you. Outcall sessions within the city have an additional $75 travel fee. 🚗",
  cancel:
    "Bookings are non-refundable once confirmed. Please reach out before your session if you need to reschedule. 🙏",
  hours:
    "Sessions are by appointment only. Book online and we'll confirm a time that works for both parties. 🕐",
  privacy:
    "Everything is confidential. We never share client information, and recording is not permitted during sessions. 🔒",
  default:
    "Thanks for your message. For immediate assistance, complete the booking form or check the Terms section. We'll be in touch soon! 🌸",
};

const initialForm = {
  name: "",
  masseuseId: "",
  date: "",
  time: "",
  service: "",
  paymentMethod: "",
  notes: "",
};

function SectionHeading({ label, title, children }) {
  return (
    <div className="section-head">
      <div className="section-label">{label}</div>
      <h2 className="section-title">{title}</h2>
      <div className="divider" />
      <p className="section-desc">{children}</p>
    </div>
  );
}

function SectionCta({ text, label = "Book a Session" }) {
  return (
    <div className="section-cta">
      <p>{text}</p>
      <a href="#booking" className="btn-primary">
        {label}
      </a>
    </div>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <nav aria-label="Primary navigation">
      <a href="#home" className="nav-logo" onClick={closeMenu}>
        Sensual touches <span>by lotus</span>
      </a>
      <button
        className="nav-toggle"
        type="button"
        aria-label="Toggle navigation"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ☰
      </button>
      <ul className={`nav-links${menuOpen ? " open" : ""}`}>
        {["services", "booking", "payment", "terms"].map((item) => (
          <li key={item}>
            <a href={`#${item}`} onClick={closeMenu}>
              {item === "booking" ? "Book" : item}
            </a>
          </li>
        ))}
      </ul>
      <a href="#booking" className="nav-cta">
        Book Now
      </a>
    </nav>
  );
}

function Services() {
  return (
    <section id="services">
      <SectionHeading label="Our Offerings" title="Premium Wellness Services">
        Compare the essentials first, then expand only the treatments that
        interest you. All sessions are 60 minutes.
      </SectionHeading>
      <div className="services-grid">
        {services.map((service) => (
          <article className="service-card" key={service.name}>
            <div className="service-duration">60 Minutes</div>
            <h3 className="service-name">
              {service.name}
              {service.badge && (
                <span className="service-badge">{service.badge}</span>
              )}
            </h3>
            <p className="service-desc">{service.summary}</p>
            <div className="service-price">${service.price}</div>
            <details className="service-details">
              <summary>View treatment details</summary>
              <p>{service.description}</p>
            </details>
          </article>
        ))}
      </div>
      <SectionCta
        text="Found a treatment that fits your needs? Reserve your preferred time."
        label="Choose a Time"
      />
    </section>
  );
}

function Booking({ onConfirmation, masseuses }) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  const updateField = ({ target: { name, value } }) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submitBooking = async (event) => {
    event.preventDefault();
    const required = ["name", "masseuseId", "date", "time", "service", "paymentMethod"];
    if (required.some((field) => !form[field])) {
      setError("Please complete all required fields.");
      return;
    }

    setError("");
    setSubmitting(true);
    const clientToken = crypto.randomUUID();

    try {
      const { booking } = await apiRequest("/api/bookings", {
        method: "POST",
        body: JSON.stringify({ ...form, clientToken }),
      });
      onConfirmation({ ...booking, clientToken });
      setForm(initialForm);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="booking">
      <SectionHeading label="Reservations" title="Book Your Session">
        Fill out the form below. A $150 booking fee is required to confirm your
        reservation — deducted from your total.
      </SectionHeading>
      <form className="booking-wrapper" onSubmit={submitBooking}>
        <div className="form-grid">
          <div className="form-group form-full">
            <label htmlFor="name">Name</label>
            <input
              type="text"
              id="name"
              name="name"
              value={form.name}
              onChange={updateField}
              placeholder="Your name"
              autoComplete="name"
              required
            />
          </div>
          <div className="form-group form-full">
            <label htmlFor="masseuseId">Preferred Masseuse</label>
            <select
              id="masseuseId"
              name="masseuseId"
              value={form.masseuseId}
              onChange={updateField}
              required
            >
              <option value="">
                {masseuses.length ? "— Choose a masseuse —" : "Loading masseuses…"}
              </option>
              {masseuses.map((masseuse) => (
                <option value={masseuse.id} key={masseuse.id}>
                  {masseuse.name}
                </option>
              ))}
            </select>
          </div>          <div className="form-group">
            <label htmlFor="date">Preferred Date</label>
            <input
              type="date"
              id="date"
              name="date"
              min={today}
              value={form.date}
              onChange={updateField}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="time">Preferred Time</label>
            <input
              type="time"
              id="time"
              name="time"
              value={form.time}
              onChange={updateField}
              required
            />
          </div>
          <div className="form-group form-full">
            <label htmlFor="service">Select Service</label>
            <select
              id="service"
              name="service"
              value={form.service}
              onChange={updateField}
              required
            >
              <option value="">— Choose a service —</option>
              {services.map((service) => (
                <option
                  value={`${service.name}${service.badge ? " (Special)" : ""} - $${service.price}`}
                  key={service.name}
                >
                  {service.name}
                  {service.badge ? " (Special)" : ""} — ${service.price}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="form-full payment-fieldset">
            <legend>Payment Method</legend>
            <select
              id="paymentMethod"
              name="paymentMethod"
              value={form.paymentMethod}
              onChange={updateField}
              required
            >
              <option value="">— Choose a payment method —</option>
              {paymentMethods.map((method) => (
                <option value={method.name} key={method.name}>
                  {method.name}
                </option>
              ))}
            </select>
          </fieldset>
          <div className="form-group form-full">
            <label htmlFor="notes">Special Requests / Notes</label>
            <textarea
              id="notes"
              name="notes"
              value={form.notes}
              onChange={updateField}
              placeholder="Any preferences, health considerations, or notes…"
            />
          </div>
          <div className="form-full booking-fee-note">
            <span>ℹ️</span>
            <span>
              A non-refundable $150 booking fee is required to confirm your
              session. This fee is deducted from your total service cost.
              You will choose a payment method during checkout.
            </span>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn-primary form-submit"
          type="submit"
          disabled={submitting || masseuses.length === 0}
        >
          {submitting ? "Preparing Payment…" : "Continue to Checkout"}
        </button>
      </form>
    </section>
  );
}

function Payment() {
  return (
    <section id="payment">
      <SectionHeading label="Payments" title="Accepted Payment Methods">
        Choose from seven discreet payment options. Destination details and a
        unique reference appear only after checkout.
      </SectionHeading>
      <ul className="payment-methods" aria-label="Accepted payment methods">
        {paymentMethods.map((method) => (
          <li className="payment-method-item" key={method.name}>
            <span className="payment-method-icon" aria-hidden="true">
              {method.icon}
            </span>
            <span>{method.name}</span>
          </li>
        ))}
      </ul>
      <div className="payment-flow">
        <h3>How payment works</h3>
        <ol>
          <li>
            <strong>Choose a method</strong>
            <span>Select your preferred option in the booking form.</span>
          </li>
          <li>
            <strong>Receive payment details</strong>
            <span>Checkout generates your destination and unique reference.</span>
          </li>
          <li>
            <strong>Complete and confirm</strong>
            <span>Pay $150, then receive your booking code after confirmation.</span>
          </li>
        </ol>
      </div>
    </section>
  );
}

function Terms() {
  return (
    <section id="terms">
      <SectionHeading label="Policies" title="Important Things to Know">
        Review the essentials below. Complete terms and privacy information now
        live on their own dedicated pages.
      </SectionHeading>
      <div className="terms-grid">
        {terms.map((term) => (
          <article className="term-card" key={term.title}>
            <h3 className="term-card-title">
              {term.icon} {term.title}
            </h3>
            <p>{term.summary}</p>
          </article>
        ))}
      </div>
      <div className="section-actions legal-actions">
        <a href="/terms" className="btn-outline">
          Read Full Terms
        </a>
        <a href="/privacy" className="btn-outline">
          Privacy Policy
        </a>
        <a href="#booking" className="btn-primary">
          Book a Session
        </a>
      </div>
    </section>
  );
}

function BookingModal({ booking, onClose, onUpdate }) {
  useEffect(() => {
    if (!booking?.id || !booking.clientToken || booking.status === "confirmed") {
      return undefined;
    }

    const applyUpdate = (incoming) => {
      if (incoming?.id !== booking.id) return;
      onUpdate((current) => ({
        ...incoming,
        clientToken: current?.clientToken || booking.clientToken,
      }));
    };

    const socket = io();
    socket.on("connect", () => {
      socket.emit(
        "booking:join",
        { bookingId: booking.id, clientToken: booking.clientToken },
        (result) => {
          if (result?.ok) applyUpdate(result.booking);
        },
      );
    });
    socket.on("booking:updated", applyUpdate);

    const poll = window.setInterval(() => {
      apiRequest(
        `/api/bookings/${booking.id}?clientToken=${encodeURIComponent(booking.clientToken)}`,
      )
        .then(({ booking: latest }) => applyUpdate(latest))
        .catch(() => {});
    }, 5000);

    return () => {
      window.clearInterval(poll);
      socket.disconnect();
    };
  }, [booking?.clientToken, booking?.id, booking?.status, onUpdate]);

  if (!booking) return null;

  const isConfirmed = booking.status === "confirmed";
  const date = new Date(`${booking.date}T${booking.time}`).toLocaleString(
    "en-US",
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  return (
    <div
      className="modal-overlay open"
      role="presentation"
      onMouseDown={isConfirmed ? onClose : undefined}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-confirmation-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-check">{isConfirmed ? "✅" : "⏳"}</div>
        <h2 className="modal-title" id="booking-confirmation-title">
          {isConfirmed ? "Payment Confirmed!" : "Awaiting Payment Confirmation"}
        </h2>
        <p className="modal-sub">
          {isConfirmed
            ? "Your payment was successful and your session is fully ready."
            : "Complete the $150 payment below. Your booking code will appear after an agent confirms receipt."}
        </p>
        {isConfirmed && (
          <div className="modal-code-box">
            <div className="modal-code-label">Your Booking Code</div>
            <div className="modal-code">{booking.bookingCode}</div>
          </div>
        )}
        <div className="modal-details">
          <strong>{booking.name}</strong>
          <br />
          Masseuse: <strong>{booking.masseuseName}</strong>
          <br />
          {booking.service}
          <br />
          {date}
          <br />
          Payment via <strong>{booking.paymentMethod}</strong>
        </div>
        <div className="modal-payment-box">
          <div className="modal-payment-label">
            Send $150 via {booking.paymentMethod}
          </div>
          <div className="modal-payment-destination">
            {booking.paymentDestination}
          </div>
          <div className="modal-payment-reference">
            Payment reference: <strong>{booking.paymentReference}</strong>
          </div>
        </div>
        <p
          className={`modal-payment-status ${isConfirmed ? "confirmed" : "pending"}`}
          role="status"
          aria-live="polite"
        >
          {isConfirmed
            ? "Payment successful. You are fully booked and ready."
            : "Waiting for an agent to confirm your payment…"}
        </p>
        {isConfirmed && (
          <button className="modal-close" type="button" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}
function Chat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
      author: "bot",
      text: "Hi there 🌸 Welcome to Sensual Touches by Lotus! How can I help you today?",
    },
    {
      author: "bot",
      text: "You can ask about our services, booking process, pricing, or payment methods.",
    },
  ]);
  const messageList = useRef(null);

  const getReply = (message) => {
    const lower = message.toLowerCase();
    if (/price|cost|how much/.test(lower)) return autoReplies.price;
    if (/book|appoint|schedul/.test(lower)) return autoReplies.book;
    if (/pay|cashapp|venmo|bitcoin|crypto/.test(lower))
      return autoReplies.payment;
    if (/service|massage|what do/.test(lower)) return autoReplies.service;
    if (/location|where|travel|mobile/.test(lower))
      return autoReplies.location;
    if (/cancel|refund/.test(lower)) return autoReplies.cancel;
    if (/hour|open|time|when/.test(lower)) return autoReplies.hours;
    if (/privat|confidential|record/.test(lower)) return autoReplies.privacy;
    return autoReplies.default;
  };

  const sendMessage = (event) => {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;

    setMessages((current) => [...current, { author: "user", text: message }]);
    setInput("");
    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { author: "bot", text: getReply(message) },
      ]);
      window.requestAnimationFrame(() => {
        if (messageList.current) {
          messageList.current.scrollTop = messageList.current.scrollHeight;
        }
      });
    }, 600);
  };

  return (
    <>
      <button
        className="chat-bubble"
        type="button"
        aria-label={open ? "Close chat" : "Open chat"}
        onClick={() => setOpen((current) => !current)}
      >
        💬
      </button>
      <aside className={`chat-panel${open ? " open" : ""}`} aria-label="Chat">
        <div className="chat-header">
          <div className="chat-avatar">🌸</div>
          <div className="chat-header-info">
            <div className="chat-header-name">Lotus Support</div>
            <div className="chat-header-status">
              ● Online — usually replies instantly
            </div>
          </div>
          <button
            className="chat-close"
            type="button"
            aria-label="Close chat"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className="chat-messages" ref={messageList} aria-live="polite">
          {messages.map((message, index) => (
            <div className={`chat-msg ${message.author}`} key={index}>
              {message.text}
            </div>
          ))}
        </div>
        <form className="chat-input-row" onSubmit={sendMessage}>
          <input
            className="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type a message…"
            aria-label="Chat message"
          />
          <button className="chat-send" type="submit" aria-label="Send message">
            ➤
          </button>
        </form>
      </aside>
    </>
  );
}

export default function App() {
  const [masseuses, setMasseuses] = useState([]);
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    window.localStorage.removeItem("lotus-active-booking");
    window.history.replaceState(null, "", window.location.pathname);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });

    let cancelled = false;
    apiRequest("/api/masseuses")
      .then(({ masseuses: availableMasseuses }) => {
        if (!cancelled) setMasseuses(availableMasseuses);
      })
      .catch((requestError) => console.error(requestError));

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Header />
      <main>
        <section className="hero" id="home">
          <div className="hero-inner">
            <div className="hero-badge">
              Must Be 18+ &nbsp;·&nbsp; Private & Confidential
            </div>
            <h1 className="hero-logo">Sensual touches</h1>
            <div className="hero-by">By Lotus</div>
            <p className="hero-tagline">
              “Where touch becomes transformation.”
            </p>
            <p className="hero-sub">
              Premium mobile massage & wellness sessions. Fully private, fully
              professional. Booking by appointment only.
            </p>
            <div className="hero-actions">
              <a href="#booking" className="btn-primary">
                Book a Session
              </a>
              <a href="#services" className="btn-outline">
                View Services
              </a>
            </div>
          </div>
        </section>
        <Services />
        <Booking onConfirmation={setBooking} masseuses={masseuses} />
        <Payment />
        <Terms />
      </main>
      <footer>
        <div className="footer-logo">Sensual touches</div>
        <div className="footer-by">By Lotus</div>
        <div className="footer-18">🔞 Must Be 18+ to Book</div>
        <p className="footer-note">
          All sessions are private and confidential. &nbsp;|&nbsp; Mobile
          service available. &nbsp;|&nbsp; Booking by appointment only.
        </p>
        <div className="footer-links">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </div>
      </footer>
      <VisitorChat masseuses={masseuses} />
      <BookingModal
        booking={booking}
        onClose={() => setBooking(null)}
        onUpdate={setBooking}
      />
    </>
  );
}

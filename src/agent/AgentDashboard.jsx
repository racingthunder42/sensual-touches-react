import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { agentRequest, apiRequest } from "../lib/chatApi";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

function mergeConversation(current, incoming) {
  const updated = current.some((item) => item.id === incoming.id)
    ? current.map((item) =>
        item.id === incoming.id ? { ...item, ...incoming } : item,
      )
    : [incoming, ...current];
  return updated.sort((left, right) => {
    if (left.status !== right.status) return left.status === "open" ? -1 : 1;
    return new Date(right.updated_at) - new Date(left.updated_at);
  });
}

function mergeBooking(current, incoming) {
  const updated = current.some((item) => item.id === incoming.id)
    ? current.map((item) =>
        item.id === incoming.id ? { ...item, ...incoming } : item,
      )
    : [incoming, ...current];
  return updated.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "pending_payment" ? -1 : 1;
    }
    return new Date(right.createdAt) - new Date(left.createdAt);
  });
}

function addMessage(current, incoming) {
  return current.some((message) => message.id === incoming.id)
    ? current
    : [...current, incoming];
}

function getVisitorLabel(conversation) {
  return (
    conversation.visitor_name ||
    `Visitor ${conversation.visitor_id.slice(0, 8)}`
  );
}

export default function AgentDashboard() {
  const [token, setToken] = useState(() =>
    isSupabaseConfigured ? null : window.sessionStorage.getItem("lotus-agent-token"),
  );
  const [agent, setAgent] = useState(() => {
    if (isSupabaseConfigured) return null;
    const saved = window.sessionStorage.getItem("lotus-agent");
    return saved ? JSON.parse(saved) : null;
  });
  const [credentials, setCredentials] = useState({
    agentId: "",
    password: "",
  });
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [inviteSession, setInviteSession] = useState(null);
  const [profileSetup, setProfileSetup] = useState({
    displayName: "",
    password: "",
  });
  const [conversations, setConversations] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const selectedIdRef = useRef(null);
  const socketRef = useRef(null);
  const messageListRef = useRef(null);

  const storeAgentSession = useCallback((session, profile) => {
    const nextAgent = { id: profile.id, name: profile.display_name };
    window.sessionStorage.setItem("lotus-agent-token", session.access_token);
    window.sessionStorage.setItem("lotus-agent", JSON.stringify(nextAgent));
    setToken(session.access_token);
    setAgent(nextAgent);
    setInviteSession(null);
  }, []);

  const loadSupabaseSession = useCallback(async (session) => {
    if (!session) {
      setAuthReady(true);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("agent_profiles")
      .select("id, display_name, active")
      .eq("id", session.user.id)
      .single();

    if (profileError) {
      setError(profileError.message);
    } else if (!profile.active || !profile.display_name) {
      setInviteSession(session);
      setProfileSetup((current) => ({
        ...current,
        displayName: profile.display_name || "",
      }));
    } else {
      storeAgentSession(session, profile);
    }
    setAuthReady(true);
  }, [storeAgentSession]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) loadSupabaseSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "TOKEN_REFRESHED" && session) {
          window.sessionStorage.setItem("lotus-agent-token", session.access_token);
          setToken(session.access_token);
        }
      },
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadSupabaseSession]);

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedId,
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    agentRequest("/api/agent/conversations", token)
      .then(({ conversations: queue }) => {
        if (!cancelled) setConversations(queue);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError.message);
          if (requestError.message === "Unauthorized") logout();
        }
      });

    agentRequest("/api/agent/bookings", token)
      .then(({ bookings: queue }) => {
        if (!cancelled) setBookings(queue);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message);
      });

    const socket = io({ auth: { token } });
    socketRef.current = socket;
    socket.on("conversation:created", (conversation) => {
      setConversations((current) =>
        mergeConversation(current, conversation),
      );
    });
    socket.on("conversation:updated", (conversation) => {
      setConversations((current) =>
        mergeConversation(current, conversation),
      );
    });
    socket.on("booking:created", (booking) => {
      setBookings((current) => mergeBooking(current, booking));
    });
    socket.on("booking:updated", (booking) => {
      setBookings((current) => mergeBooking(current, booking));
    });
    socket.on("message:new", (message) => {
      if (message.conversation_id === selectedIdRef.current) {
        setMessages((current) => addMessage(current, message));
      }
    });

    return () => {
      cancelled = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedId) {
      setMessages([]);
      return;
    }
    setError("");
    agentRequest(`/api/agent/conversations/${selectedId}/messages`, token)
      .then(({ messages: history }) => setMessages(history))
      .catch((requestError) => setError(requestError.message));
  }, [selectedId, token]);

  useEffect(() => {
    if (!messageListRef.current) return;
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messages]);

  const login = async (event) => {
    event.preventDefault();
    setError("");
    try {
      if (isSupabaseConfigured) {
        const { data, error: loginError } = await supabase.auth.signInWithPassword({
          email: credentials.agentId.trim(),
          password: credentials.password,
        });
        if (loginError) throw loginError;
        await loadSupabaseSession(data.session);
        return;
      }

      const result = await apiRequest("/api/agent/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
      window.sessionStorage.setItem("lotus-agent-token", result.token);
      window.sessionStorage.setItem("lotus-agent", JSON.stringify(result.agent));
      setToken(result.token);
      setAgent(result.agent);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const completeProfile = async (event) => {
    event.preventDefault();
    const displayName = profileSetup.displayName.trim();
    if (displayName.length < 2 || profileSetup.password.length < 12) {
      setError("Use a display name and a password containing at least 12 characters.");
      return;
    }

    setError("");
    try {
      const { error: passwordError } = await supabase.auth.updateUser({
        password: profileSetup.password,
      });
      if (passwordError) throw passwordError;

      const { data: profile, error: profileError } = await supabase
        .from("agent_profiles")
        .update({
          display_name: displayName,
          active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inviteSession.user.id)
        .select("id, display_name, active")
        .single();
      if (profileError) throw profileError;

      const { data: { session } } = await supabase.auth.getSession();
      storeAgentSession(session, profile);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const logout = async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut();
    window.sessionStorage.removeItem("lotus-agent-token");
    window.sessionStorage.removeItem("lotus-agent");
    setToken(null);
    setAgent(null);
    setInviteSession(null);
    setSelectedId(null);
    setConversations([]);
    setBookings([]);
    setMessages([]);
  };

  const closeConversation = async () => {
    try {
      const { conversation } = await agentRequest(
        `/api/agent/conversations/${selectedId}/close`,
        token,
        { method: "POST" },
      );
      setConversations((current) =>
        mergeConversation(current, conversation),
      );
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const confirmPayment = async (bookingId) => {
    try {
      const { booking } = await agentRequest(
        `/api/agent/bookings/${bookingId}/confirm`,
        token,
        { method: "POST" },
      );
      setBookings((current) => mergeBooking(current, booking));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const sendMessage = (event) => {
    event.preventDefault();
    const body = input.trim();
    if (!body || !selectedId) return;
    setInput("");
    socketRef.current?.emit(
      "agent:message",
      { conversationId: selectedId, body },
      (result) => {
        if (!result?.ok) {
          setInput(body);
          setError(result?.error || "Message could not be sent.");
        }
      },
    );
  };

  if (!authReady) {
    return (
      <main className="agent-login-page">
        <div className="agent-login-card">Checking your invitationâ€¦</div>
      </main>
    );
  }

  if (inviteSession) {
    return (
      <main className="agent-login-page">
        <form className="agent-login-card" onSubmit={completeProfile}>
          <div className="footer-logo">Sensual touches</div>
          <p className="section-label">Agent invitation</p>
          <h1>Finish account setup</h1>
          <label htmlFor="displayName">Masseuse name</label>
          <input
            id="displayName"
            value={profileSetup.displayName}
            onChange={(event) =>
              setProfileSetup((current) => ({
                ...current,
                displayName: event.target.value,
              }))
            }
            required
          />
          <label htmlFor="newAgentPassword">Create password</label>
          <input
            id="newAgentPassword"
            type="password"
            minLength="12"
            value={profileSetup.password}
            onChange={(event) =>
              setProfileSetup((current) => ({
                ...current,
                password: event.target.value,
              }))
            }
            autoComplete="new-password"
            required
          />
          {error && <p className="form-error">{error}</p>}
          <button className="btn-primary" type="submit">
            Activate Account
          </button>
        </form>
      </main>
    );
  }

  if (!token || !agent) {
    return (
      <main className="agent-login-page">
        <form className="agent-login-card" onSubmit={login}>
          <div className="footer-logo">Sensual touches</div>
          <p className="section-label">Support dashboard</p>
          <h1>Agent sign in</h1>
          <label htmlFor="agentId">{isSupabaseConfigured ? "Email" : "Agent ID"}</label>
          <input
            id="agentId"
            type={isSupabaseConfigured ? "email" : "text"}
            value={credentials.agentId}
            onChange={(event) =>
              setCredentials((current) => ({
                ...current,
                agentId: event.target.value,
              }))
            }
            autoComplete="username"
            required
          />
          <label htmlFor="agentPassword">Password</label>
          <input
            id="agentPassword"
            type="password"
            value={credentials.password}
            onChange={(event) =>
              setCredentials((current) => ({
                ...current,
                password: event.target.value,
              }))
            }
            autoComplete="current-password"
            required
          />
          {error && <p className="form-error">{error}</p>}
          <button className="btn-primary" type="submit">
            Sign In
          </button>
        </form>
      </main>
    );
  }

  const canReply =
    selectedConversation?.status === "open" &&
    selectedConversation.assigned_agent_id === agent.id;
  const pendingBookings = bookings.filter(
    (booking) => booking.status === "pending_payment",
  );
  const confirmedBookings = bookings.filter(
    (booking) => booking.status === "confirmed",
  );

  return (
    <main className="agent-dashboard">
      <header className="agent-toolbar">
        <div>
          <div className="nav-logo">
            Sensual touches <span>support</span>
          </div>
        </div>
        <div className="agent-toolbar-actions">
          <span>Private queue</span>

          <strong>{agent.name}</strong>
          <button className="btn-outline agent-small-button" onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>

      <div className="agent-workspace">
        <aside className="conversation-list">
          <div className="payment-queue-heading">
            <h1>Pending Payments</h1>
            <span>{pendingBookings.length}</span>
          </div>
          {pendingBookings.length === 0 && (
            <p className="agent-empty payment-empty">No payments awaiting confirmation.</p>
          )}
          {pendingBookings.map((booking) => (
            <article className="payment-queue-item" key={booking.id}>
              <div className="payment-queue-summary">
                <strong>Client: {booking.name}</strong>
                <span>{booking.paymentMethod} · $150 awaiting confirmation</span>
                <small>Appointment: {booking.date} at {booking.time}</small>
                <small>Service: {booking.service}</small>
                <small>Masseuse: {booking.masseuseName}</small>
                {booking.notes && <small>Notes: {booking.notes}</small>}
                <code>Payment reference: {booking.paymentReference}</code>
              </div>
              <button
                className="btn-primary agent-small-button"
                type="button"
                onClick={() => confirmPayment(booking.id)}
              >
                Confirm Payment
              </button>
            </article>
          ))}
          <details className="payment-history" open>
            <summary>
              <span>Payment History</span>
              <strong>{confirmedBookings.length}</strong>
            </summary>
            {confirmedBookings.length === 0 && (
              <p className="agent-empty payment-empty">No confirmed payments yet.</p>
            )}
            {confirmedBookings.map((booking) => (
              <article className="payment-queue-item confirmed" key={booking.id}>
                <div className="payment-queue-summary">
                  <strong>Client: {booking.name}</strong>
                  <span>{booking.paymentMethod} · $150 confirmed</span>
                  <small>Appointment: {booking.date} at {booking.time}</small>
                  <small>Service: {booking.service}</small>
                  <small>Masseuse: {booking.masseuseName}</small>
                  {booking.notes && <small>Notes: {booking.notes}</small>}
                  <code>Payment reference: {booking.paymentReference}</code>
                  {booking.bookingCode && (
                    <code>Booking code: {booking.bookingCode}</code>
                  )}
                  {booking.confirmedAt && (
                    <small>
                      Confirmed: {new Date(booking.confirmedAt).toLocaleString()}
                    </small>
                  )}
                </div>
              </article>
            ))}
          </details>
          <div className="conversation-list-heading">
            <h1>Conversations</h1>
            <span>{conversations.filter((item) => item.status === "open").length} open</span>
          </div>
          {conversations.length === 0 && (
            <p className="agent-empty">No conversations yet.</p>
          )}
          {conversations.map((conversation) => (
            <button
              className={`conversation-item${selectedId === conversation.id ? " active" : ""}`}
              key={conversation.id}
              onClick={() => setSelectedId(conversation.id)}
            >
              <span className={`conversation-status ${conversation.status}`} />
              <span className="conversation-summary">
                <strong>{getVisitorLabel(conversation)}</strong>
                <small>{conversation.last_message || "New conversation"}</small>
              </span>
              <span className="conversation-owner">
                Private
              </span>
            </button>
          ))}
        </aside>

        <section className="agent-conversation">
          {!selectedConversation ? (
            <div className="agent-empty-state">
              Select a conversation from the queue.
            </div>
          ) : (
            <>
              <header className="conversation-header">
                <div>
                  <h2>{getVisitorLabel(selectedConversation)}</h2>
                  <p>
                    {selectedConversation.status} · private conversation
                  </p>
                </div>
                <div className="conversation-actions">

                  {canReply && (
                    <button
                      className="btn-outline agent-small-button"
                      onClick={closeConversation}
                    >
                      Close
                    </button>
                  )}
                </div>
              </header>
              {error && (
                <p className="agent-banner-error" role="alert">
                  {error}
                </p>
              )}
              <div className="agent-message-list" ref={messageListRef}>
                {messages.map((message) => (
                  <div
                    className={`agent-message ${message.sender_type}`}
                    key={message.id}
                  >
                    <span>{message.sender_type}</span>
                    <p>{message.body}</p>
                  </div>
                ))}
              </div>
              <form className="agent-reply-form" onSubmit={sendMessage}>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={
                    canReply
                      ? "Write a reply…"
                      : "This conversation is read-only"
                  }
                  disabled={!canReply}
                />
                <button
                  className="btn-primary"
                  type="submit"
                  disabled={!canReply || !input.trim()}
                >
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

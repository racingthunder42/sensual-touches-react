import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { apiRequest } from "../lib/chatApi";

function getVisitorId() {
  return crypto.randomUUID();
}

function addMessage(current, incoming) {
  return current.some((message) => message.id === incoming.id)
    ? current
    : [...current, incoming];
}

export default function VisitorChat({ masseuses }) {
  const visitorId = useMemo(getVisitorId, []);
  const [open, setOpen] = useState(false);
  const [visitorName, setVisitorName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [masseuseId, setMasseuseId] = useState("");
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const socketRef = useRef(null);
  const messageListRef = useRef(null);

  useEffect(() => {
    if (!open || !visitorName || !masseuseId || conversation) return;
    let cancelled = false;

    async function beginConversation() {
      setStatus("loading");
      setError("");
      try {
        const { conversation: activeConversation } = await apiRequest(
          "/api/chat/conversations",
          {
            method: "POST",
            body: JSON.stringify({ visitorId, visitorName, agentId: masseuseId }),
          },
        );
        const { messages: history } = await apiRequest(
          `/api/chat/conversations/${activeConversation.id}/messages?visitorId=${encodeURIComponent(visitorId)}`,
        );
        if (!cancelled) {
          setConversation(activeConversation);
          setMessages(history);
          setStatus("connecting");
        }
      } catch (requestError) {
        if (!cancelled) {
          setStatus("error");
          setError("Support is temporarily unavailable. Please try again.");
          console.error(requestError);
        }
      }
    }

    beginConversation();
    return () => {
      cancelled = true;
    };
  }, [conversation, masseuseId, open, visitorId, visitorName]);

  useEffect(() => {
    if (!conversation) return;
    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit(
        "visitor:join",
        { conversationId: conversation.id, visitorId },
        (result) => {
          if (result?.ok) {
            setStatus("online");
            setError("");
          } else {
            setStatus("error");
            setError(result?.error || "Unable to join support chat.");
          }
        },
      );
    });
    socket.on("connect_error", () => {
      setStatus("error");
      setError("Unable to connect to live support.");
    });
    socket.on("message:new", (message) => {
      if (message.conversation_id === conversation.id) {
        setMessages((current) => addMessage(current, message));
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [conversation, visitorId]);

  useEffect(() => {
    if (!messageListRef.current) return;
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = (event) => {
    event.preventDefault();
    const body = input.trim();
    if (!body || status !== "online") return;
    setInput("");
    socketRef.current?.emit("visitor:message", { body }, (result) => {
      if (!result?.ok) {
        setInput(body);
        setError(result?.error || "Message could not be sent.");
      }
    });
  };

  const submitName = (event) => {
    event.preventDefault();
    const name = nameInput.trim();
    if (!name || !masseuseId) return;
    setVisitorName(name);
  };

  const selectedMasseuse = masseuses.find(
    (masseuse) => masseuse.id === masseuseId,
  );

  return (
    <>
      <button
        className="chat-bubble"
        type="button"
        aria-label={open ? "Close support chat" : "Open support chat"}
        onClick={() => setOpen((current) => !current)}
      >
        💬
      </button>
      <aside className={`chat-panel${open ? " open" : ""}`} aria-label="Support chat">
        <div className="chat-header">
          <div className="chat-avatar">🌸</div>
          <div className="chat-header-info">
            <div className="chat-header-name">Lotus Support</div>
            <div className="chat-header-status">
              {!visitorName
                ? "Choose your masseuse to begin"
                : status === "online"
                  ? "● Live support connected"
                  : "Connecting…"}
            </div>
          </div>
          <button
            className="chat-close"
            type="button"
            aria-label="Close support chat"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
        {!visitorName ? (
          <form className="chat-name-form" onSubmit={submitName}>
            <p>What name should our support team use?</p>
            <label htmlFor="supportVisitorName">Your name</label>
            <input
              id="supportVisitorName"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Enter your name"
              autoComplete="name"
              maxLength={80}
              required
            />
            <label htmlFor="supportMasseuse">Preferred masseuse</label>
            <select
              id="supportMasseuse"
              value={masseuseId}
              onChange={(event) => setMasseuseId(event.target.value)}
              required
            >
              <option value="">
                {masseuses.length ? "Choose a masseuse" : "Loading masseuses…"}
              </option>
              {masseuses.map((masseuse) => (
                <option value={masseuse.id} key={masseuse.id}>
                  {masseuse.name}
                </option>
              ))}
            </select>
            <button className="btn-primary" type="submit" disabled={!masseuseId}>
              Start Chat
            </button>
          </form>
        ) : (
          <>
            <div className="chat-messages" ref={messageListRef} aria-live="polite">
              <div className="chat-msg bot">
                Hi {visitorName}. This is your private chat with
                {` ${selectedMasseuse?.name || "your masseuse"}.`} Send a message when ready.
              </div>
              {messages.map((message) => (
                <div
                  className={`chat-msg ${message.sender_type === "visitor" ? "user" : "bot"}`}
                  key={message.id}
                >
                  {message.body}
                </div>
              ))}
              {status === "loading" && (
                <div className="chat-system-message">Opening conversation…</div>
              )}
              {error && (
                <div className="chat-system-message chat-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <form className="chat-input-row" onSubmit={sendMessage}>
              <input
                className="chat-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Type a message…"
                aria-label="Chat message"
                disabled={status !== "online"}
              />
              <button
                className="chat-send"
                type="submit"
                aria-label="Send message"
                disabled={status !== "online" || !input.trim()}
              >
                ➤
              </button>
            </form>
          </>
        )}
      </aside>
    </>
  );
}

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import rateLimit from "express-rate-limit";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const isProduction = process.env.NODE_ENV === "production";
const requiredProductionVariables = [
  "AGENT_ACCOUNTS", "APP_ORIGIN", "CHAT_AUTH_SECRET", "CHAT_DATABASE_PATH",
  "CASHAPP_PAYMENT_DESTINATION", "VENMO_PAYMENT_DESTINATION",
  "BITCOIN_PAYMENT_DESTINATION", "ZELLE_PAYMENT_DESTINATION",
  "APPLE_PAY_PAYMENT_DESTINATION", "CHIME_PAYMENT_DESTINATION",
  "PAYPAL_PAYMENT_DESTINATION",
];
const missingProductionVariables = requiredProductionVariables.filter(
  (name) => !process.env[name],
);
if (isProduction && missingProductionVariables.length) {
  throw new Error(`Missing required production environment variables: ${missingProductionVariables.join(", ")}`);
}
if (isProduction && process.env.CHAT_AUTH_SECRET.length < 32) {
  throw new Error("CHAT_AUTH_SECRET must contain at least 32 characters.");
}
const dataDirectory = path.join(projectRoot, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath =
  process.env.CHAT_DATABASE_PATH || path.join(dataDirectory, "support.sqlite");
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    visitor_name TEXT,
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'closed')),
    assigned_agent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS conversations_status_updated
    ON conversations(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'agent', 'system')),
    sender_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS messages_conversation_created
    ON messages(conversation_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    client_token TEXT NOT NULL,
    client_name TEXT NOT NULL,
    masseuse_id TEXT,
    booking_date TEXT NOT NULL,
    booking_time TEXT NOT NULL,
    service TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL,
    payment_destination TEXT NOT NULL,
    payment_reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending_payment'
      CHECK (status IN ('pending_payment', 'confirmed')),
    booking_code TEXT UNIQUE,
    confirmed_by TEXT,
    confirmed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS bookings_status_created
    ON bookings(status, created_at DESC);
`);

const conversationColumns = database
  .prepare("PRAGMA table_info(conversations)")
  .all()
  .map((column) => column.name);
if (!conversationColumns.includes("visitor_name")) {
  database.exec("ALTER TABLE conversations ADD COLUMN visitor_name TEXT");
}

const bookingColumns = database
  .prepare("PRAGMA table_info(bookings)")
  .all()
  .map((column) => column.name);
if (!bookingColumns.includes("masseuse_id")) {
  database.exec("ALTER TABLE bookings ADD COLUMN masseuse_id TEXT");
}

database.exec(`
  CREATE INDEX IF NOT EXISTS conversations_agent_status
    ON conversations(assigned_agent_id, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS bookings_masseuse_status
    ON bookings(masseuse_id, status, created_at DESC);
`);

const app = express();
const server = http.createServer(app);
const allowedOrigins = new Set(
  (process.env.APP_ORIGIN || "http://127.0.0.1:5173,http://localhost:5173")
    .split(",").map((origin) => origin.trim()).filter(Boolean),
);
const io = new Server(server, {
  allowRequest: (request, callback) =>
    callback(null, !request.headers.origin || allowedOrigins.has(request.headers.origin)),
});
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    "default-src": ["'self'"],
    "style-src": ["'self'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:"],
    "connect-src": ["'self'", "ws:", "wss:"],
    "object-src": ["'none'"],
  }},
}));
app.use(express.json({ limit: "32kb" }));

const developmentAccounts = [
  { id: "lotus", name: "Sasha", password: "change-me" },
  { id: "support-two", name: "Britney", password: "change-me" },
];

const paymentDestinations = new Map([
  [
    "CashApp",
    process.env.CASHAPP_PAYMENT_DESTINATION || "$SensualTouchesLotus",
  ],
  ["Venmo", process.env.VENMO_PAYMENT_DESTINATION || "@SensualTouches-Lotus"],
  [
    "Bitcoin",
    process.env.BITCOIN_PAYMENT_DESTINATION ||
      "bc1qctvvp63hr6uzxryfakly7kuvar5xwadu3qhqxd",
  ],
  [
    "Zelle",
    process.env.ZELLE_PAYMENT_DESTINATION ||
      "Contact support for Zelle payment details",
  ],
  [
    "Apple Pay",
    process.env.APPLE_PAY_PAYMENT_DESTINATION ||
      "Contact support for Apple Pay payment details",
  ],
  [
    "Chime",
    process.env.CHIME_PAYMENT_DESTINATION ||
      "Contact support for Chime payment details",
  ],
  [
    "PayPal",
    process.env.PAYPAL_PAYMENT_DESTINATION ||
      "Contact support for PayPal payment details",
  ],
]);

function loadAgentAccounts() {
  if (!process.env.AGENT_ACCOUNTS) {
    console.warn(
      "[support] AGENT_ACCOUNTS is not configured. Development logins are enabled; do not expose this server publicly.",
    );
    return developmentAccounts;
  }

  const accounts = JSON.parse(process.env.AGENT_ACCOUNTS);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("AGENT_ACCOUNTS must be a non-empty JSON array.");
  }

  const normalizedAccounts = accounts.map((account, index) => {
    const id = typeof account?.id === "string" ? account.id.trim() : "";
    const name = typeof account?.name === "string" ? account.name.trim() : "";
    const password =
      typeof account?.password === "string" ? account.password : "";
    const passwordHash =
      typeof account?.passwordHash === "string" ? account.passwordHash : "";
    const validHash = /^scrypt\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{32,}$/.test(passwordHash);
    if (!/^[a-z0-9][a-z0-9_-]{1,49}$/i.test(id) || !name || (!password && !validHash)) {
      throw new Error(
        `AGENT_ACCOUNTS entry ${index + 1} requires a valid id, name, and passwordHash.`,
      );
    }
    if (isProduction && password) {
      throw new Error(`AGENT_ACCOUNTS entry ${index + 1} must use passwordHash in production.`);
    }
    return { id, name: name.slice(0, 80), password, passwordHash };
  });

  if (new Set(normalizedAccounts.map(({ id }) => id)).size !== normalizedAccounts.length) {
    throw new Error("AGENT_ACCOUNTS ids must be unique.");
  }
  return normalizedAccounts;
}

const agentAccounts = loadAgentAccounts();
const agentsById = new Map(agentAccounts.map((agent) => [agent.id, agent]));
const defaultAgentId = agentAccounts[0].id;
database
  .prepare("UPDATE conversations SET assigned_agent_id = ? WHERE assigned_agent_id IS NULL")
  .run(defaultAgentId);
database
  .prepare("UPDATE bookings SET masseuse_id = ? WHERE masseuse_id IS NULL")
  .run(defaultAgentId);

const storedAgentIds = new Set([
  ...database.prepare(
    "SELECT DISTINCT assigned_agent_id AS id FROM conversations WHERE assigned_agent_id IS NOT NULL",
  ).all().map(({ id }) => id),
  ...database.prepare(
    "SELECT DISTINCT masseuse_id AS id FROM bookings WHERE masseuse_id IS NOT NULL",
  ).all().map(({ id }) => id),
]);
const removedAgentIds = [...storedAgentIds].filter((id) => !agentsById.has(id));
if (removedAgentIds.length) {
  const message = `Stored records reference removed agents: ${removedAgentIds.join(", ")}. Restore or reassign those IDs first.`;
  if (isProduction) throw new Error(message);
  console.warn(`[support] ${message}`);
}

const authSecret =
  process.env.CHAT_AUTH_SECRET || crypto.randomBytes(32).toString("hex");

if (!process.env.CHAT_AUTH_SECRET) {
  console.warn(
    "[support] CHAT_AUTH_SECRET is temporary. Set it before deployment so agent sessions survive restarts.",
  );
}

function createToken(agent) {
  const payload = Buffer.from(
    JSON.stringify({
      agentId: agent.id,
      name: agent.name,
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", authSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", authSecret)
    .update(payload)
    .digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (session.expiresAt < Date.now() || !agentsById.has(session.agentId)) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function requireAgent(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const agent = verifyToken(token);
  if (!agent) return response.status(401).json({ error: "Unauthorized" });
  request.agent = agent;
  next();
}

function verifyPassword(password, agent) {
  if (typeof password !== "string") return false;
  if (!agent.passwordHash) {
    return crypto.timingSafeEqual(
      crypto.createHash("sha256").update(password).digest(),
      crypto.createHash("sha256").update(agent.password || "").digest(),
    );
  }
  const [, saltValue, hashValue] = agent.passwordHash.split("$");
  const expected = Buffer.from(hashValue, "base64url");
  const actual = crypto.scryptSync(password, Buffer.from(saltValue, "base64url"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeMessage(body) {
  return typeof body === "string" ? body.trim().slice(0, 2000) : "";
}

function normalizeField(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getBooking(id) {
  return database.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
}

function getBookingForClient(id, clientToken) {
  return database
    .prepare("SELECT * FROM bookings WHERE id = ? AND client_token = ?")
    .get(id, clientToken);
}

function serializeBooking(booking) {
  if (!booking) return null;
  return {
    id: booking.id,
    name: booking.client_name,
    masseuseId: booking.masseuse_id,
    masseuseName: agentsById.get(booking.masseuse_id)?.name || booking.masseuse_id,
    date: booking.booking_date,
    time: booking.booking_time,
    service: booking.service,
    notes: booking.notes,
    paymentMethod: booking.payment_method,
    paymentDestination: booking.payment_destination,
    paymentReference: booking.payment_reference,
    status: booking.status,
    bookingCode: booking.booking_code,
    confirmedBy: booking.confirmed_by,
    confirmedAt: booking.confirmed_at,
    createdAt: booking.created_at,
    updatedAt: booking.updated_at,
  };
}

function listBookings(agentId) {
  return database
    .prepare(`
      SELECT * FROM bookings
      WHERE masseuse_id = ?
      ORDER BY
        CASE status WHEN 'pending_payment' THEN 0 ELSE 1 END,
        created_at DESC
    `)
    .all(agentId)
    .map(serializeBooking);
}

function createUniqueBookingValue(prefix, column) {
  if (!["payment_reference", "booking_code"].includes(column)) {
    throw new Error("Unsupported booking code column");
  }
  while (true) {
    const value = `${prefix}${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const exists = database
      .prepare(`SELECT 1 FROM bookings WHERE ${column} = ?`)
      .get(value);
    if (!exists) return value;
  }
}

function emitBookingUpdate(booking) {
  const publicBooking = serializeBooking(booking);
  io.to(`booking:${booking.id}`).emit("booking:updated", publicBooking);
  io.to(`agent:${booking.masseuse_id}`).emit("booking:updated", publicBooking);
}

function getConversation(id) {
  return database
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(id);
}

function getConversationForVisitor(id, visitorId) {
  return database
    .prepare(
      "SELECT * FROM conversations WHERE id = ? AND visitor_id = ?",
    )
    .get(id, visitorId);
}

function listConversations(agentId) {
  return database
    .prepare(`
      SELECT
        conversations.*,
        (
          SELECT body FROM messages
          WHERE messages.conversation_id = conversations.id
          ORDER BY messages.created_at DESC LIMIT 1
        ) AS last_message
      FROM conversations
      WHERE assigned_agent_id = ?
      ORDER BY
        CASE conversations.status WHEN 'open' THEN 0 ELSE 1 END,
        conversations.updated_at DESC
    `)
    .all(agentId);
}

function listMessages(conversationId) {
  return database
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
    )
    .all(conversationId);
}

function createMessage({ conversationId, senderType, senderId, body }) {
  const message = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    sender_type: senderType,
    sender_id: senderId,
    body,
    created_at: new Date().toISOString(),
  };
  database
    .prepare(`
      INSERT INTO messages
        (id, conversation_id, sender_type, sender_id, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      message.id,
      message.conversation_id,
      message.sender_type,
      message.sender_id,
      message.body,
      message.created_at,
    );
  database
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .run(message.created_at, conversationId);
  return message;
}

function emitConversationUpdate(conversationId) {
  const conversation = getConversation(conversationId);
  if (!conversation) return;
  io.to(`agent:${conversation.assigned_agent_id}`).emit(
    "conversation:updated",
    conversation,
  );
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/masseuses", (_request, response) => {
  response.json({
    masseuses: agentAccounts.map(({ id, name }) => ({ id, name })),
  });
});

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const bookingLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

app.post("/api/bookings", bookingLimiter, (request, response) => {
  const clientToken = normalizeField(request.body.clientToken, 100);
  const name = normalizeField(request.body.name, 80);
  const date = normalizeField(request.body.date, 10);
  const time = normalizeField(request.body.time, 5);
  const service = normalizeField(request.body.service, 160);
  const notes = normalizeField(request.body.notes, 1000);
  const masseuseId = normalizeField(request.body.masseuseId, 100);
  const paymentMethod = normalizeField(request.body.paymentMethod, 30);
  const paymentDestination = paymentDestinations.get(paymentMethod);
  const appointment = Date.parse(`${date}T${time}:00${process.env.BOOKING_TIMEZONE_OFFSET || "Z"}`);

  if (
    clientToken.length < 16 ||
    !name ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}$/.test(time) ||
    Number.isNaN(appointment) ||
    !service ||
    !agentsById.has(masseuseId) ||
    !paymentDestination
  ) {
    return response.status(400).json({ error: "Invalid booking details" });
  }

  const minimumLeadMinutes = Number(process.env.BOOKING_MIN_LEAD_MINUTES || 30);
  if (appointment < Date.now() + minimumLeadMinutes * 60_000) {
    return response.status(400).json({ error: `Bookings require at least ${minimumLeadMinutes} minutes of notice.` });
  }
  const occupied = database.prepare(
    "SELECT 1 FROM bookings WHERE masseuse_id = ? AND booking_date = ? AND booking_time = ?",
  ).get(masseuseId, date, time);
  if (occupied) {
    return response.status(409).json({ error: "That masseuse is already booked at the selected time." });
  }

  const now = new Date().toISOString();
  const booking = {
    id: crypto.randomUUID(),
    client_token: clientToken,
    client_name: name,
    masseuse_id: masseuseId,
    booking_date: date,
    booking_time: time,
    service,
    notes,
    payment_method: paymentMethod,
    payment_destination: paymentDestination,
    payment_reference: createUniqueBookingValue("PAY-", "payment_reference"),
    status: "pending_payment",
    created_at: now,
    updated_at: now,
  };

  database
    .prepare(`
      INSERT INTO bookings
        (id, client_token, client_name, masseuse_id, booking_date, booking_time, service, notes,
         payment_method, payment_destination, payment_reference, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      booking.id,
      booking.client_token,
      booking.client_name,
      booking.masseuse_id,
      booking.booking_date,
      booking.booking_time,
      booking.service,
      booking.notes,
      booking.payment_method,
      booking.payment_destination,
      booking.payment_reference,
      booking.status,
      booking.created_at,
      booking.updated_at,
    );

  const publicBooking = serializeBooking(getBooking(booking.id));
  io.to(`agent:${booking.masseuse_id}`).emit("booking:created", publicBooking);
  response.status(201).json({ booking: publicBooking });
});

app.get("/api/bookings/:id", (request, response) => {
  const clientToken = normalizeField(request.query.clientToken, 100);
  const booking = getBookingForClient(request.params.id, clientToken);
  if (!booking) {
    return response.status(404).json({ error: "Booking not found" });
  }
  response.json({ booking: serializeBooking(booking) });
});

app.post("/api/chat/conversations", chatLimiter, (request, response) => {
  const visitorId =
    typeof request.body.visitorId === "string"
      ? request.body.visitorId.slice(0, 100)
      : "";
  const visitorName =
    typeof request.body.visitorName === "string"
      ? request.body.visitorName.trim().slice(0, 80)
      : "";
  const agentId = normalizeField(request.body.agentId, 100);
  if (!visitorId || !visitorName || !agentsById.has(agentId)) {
    return response
      .status(400)
      .json({ error: "visitorId, visitorName, and agentId are required" });
  }

  let conversation = database
    .prepare(`
      SELECT * FROM conversations
      WHERE visitor_id = ? AND assigned_agent_id = ? AND status = 'open'
      ORDER BY created_at DESC LIMIT 1
    `)
    .get(visitorId, agentId);

  if (!conversation) {
    const now = new Date().toISOString();
    conversation = {
      id: crypto.randomUUID(),
      visitor_id: visitorId,
      visitor_name: visitorName,
      status: "open",
      assigned_agent_id: agentId,
      created_at: now,
      updated_at: now,
    };
    database
      .prepare(`
        INSERT INTO conversations
          (id, visitor_id, visitor_name, status, assigned_agent_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        conversation.id,
        conversation.visitor_id,
        conversation.visitor_name,
        conversation.status,
        conversation.assigned_agent_id,
        conversation.created_at,
        conversation.updated_at,
      );
    io.to(`agent:${agentId}`).emit("conversation:created", conversation);
  } else if (conversation.visitor_name !== visitorName) {
    database
      .prepare(
        "UPDATE conversations SET visitor_name = ?, updated_at = ? WHERE id = ?",
      )
      .run(visitorName, new Date().toISOString(), conversation.id);
    conversation = getConversation(conversation.id);
    emitConversationUpdate(conversation.id);
  }

  response.status(201).json({ conversation });
});

app.get("/api/chat/conversations/:id/messages", (request, response) => {
  const visitorId = request.query.visitorId;
  if (!getConversationForVisitor(request.params.id, visitorId)) {
    return response.status(404).json({ error: "Conversation not found" });
  }
  response.json({ messages: listMessages(request.params.id) });
});

app.post("/api/agent/login", loginLimiter, (request, response) => {
  const { agentId, password } = request.body;
  const agent = agentsById.get(agentId);
  if (!agent || !verifyPassword(password, agent)) {
    return response.status(401).json({ error: "Invalid credentials" });
  }
  response.json({
    token: createToken(agent),
    agent: { id: agent.id, name: agent.name },
  });
});

app.get("/api/agent/bookings", requireAgent, (request, response) => {
  response.json({ bookings: listBookings(request.agent.agentId) });
});

app.post(
  "/api/agent/bookings/:id/confirm",
  requireAgent,
  (request, response) => {
    const current = getBooking(request.params.id);
    if (!current || current.masseuse_id !== request.agent.agentId) {
      return response.status(404).json({ error: "Booking not found" });
    }
    if (current.status === "confirmed") {
      return response.json({ booking: serializeBooking(current) });
    }

    const now = new Date().toISOString();
    const bookingCode = createUniqueBookingValue("LTB-", "booking_code");
    database
      .prepare(`
        UPDATE bookings
        SET status = 'confirmed', booking_code = ?, confirmed_by = ?,
            confirmed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending_payment'
      `)
      .run(
        bookingCode,
        request.agent.agentId,
        now,
        now,
        request.params.id,
      );

    const booking = getBooking(request.params.id);
    emitBookingUpdate(booking);
    response.json({ booking: serializeBooking(booking) });
  },
);

app.get("/api/agent/conversations", requireAgent, (request, response) => {
  response.json({
    conversations: listConversations(request.agent.agentId),
  });
});

app.get(
  "/api/agent/conversations/:id/messages",
  requireAgent,
  (request, response) => {
    const conversation = getConversation(request.params.id);
    if (
      !conversation ||
      conversation.assigned_agent_id !== request.agent.agentId
    ) {
      return response.status(404).json({ error: "Conversation not found" });
    }
    response.json({ messages: listMessages(request.params.id) });
  },
);

app.post(
  "/api/agent/conversations/:id/claim",
  requireAgent,
  (request, response) => {
    const conversation = getConversation(request.params.id);
    if (
      !conversation ||
      conversation.assigned_agent_id !== request.agent.agentId
    ) {
      return response.status(404).json({ error: "Conversation not found" });
    }
    response.json({ conversation });
  },
);

app.post(
  "/api/agent/conversations/:id/close",
  requireAgent,
  (request, response) => {
    const conversation = getConversation(request.params.id);
    if (
      !conversation ||
      conversation.assigned_agent_id !== request.agent.agentId
    ) {
      return response.status(404).json({ error: "Conversation not found" });
    }
    database
      .prepare(`
        UPDATE conversations
        SET status = 'closed', assigned_agent_id = COALESCE(assigned_agent_id, ?),
            updated_at = ?
        WHERE id = ?
      `)
      .run(request.agent.agentId, new Date().toISOString(), request.params.id);
    emitConversationUpdate(request.params.id);
    response.json({ conversation: getConversation(request.params.id) });
  },
);

const onlineAgents = new Map();

function broadcastPresence() {
  io.to("agents").emit(
    "agents:presence",
    Array.from(onlineAgents.entries()).map(([agentId, sockets]) => ({
      agentId,
      name: agentsById.get(agentId)?.name || agentId,
      online: sockets.size > 0,
    })),
  );
}

io.on("connection", (socket) => {
  const token = socket.handshake.auth?.token;
  const agent = verifyToken(token);

  if (agent) {
    socket.data.agent = agent;
    socket.join("agents");
    socket.join(`agent:${agent.agentId}`);
    const sockets = onlineAgents.get(agent.agentId) || new Set();
    sockets.add(socket.id);
    onlineAgents.set(agent.agentId, sockets);
    broadcastPresence();
  }

  socket.on("visitor:join", ({ conversationId, visitorId }, acknowledge) => {
    const conversation = getConversationForVisitor(conversationId, visitorId);
    if (!conversation) {
      return acknowledge?.({ ok: false, error: "Conversation not found" });
    }
    socket.data.visitor = { conversationId, visitorId };
    socket.join(`conversation:${conversationId}`);
    acknowledge?.({ ok: true });
  });

  socket.on("booking:join", ({ bookingId, clientToken }, acknowledge) => {
    const booking = getBookingForClient(bookingId, clientToken);
    if (!booking) {
      return acknowledge?.({ ok: false, error: "Booking not found" });
    }
    socket.join(`booking:${booking.id}`);
    acknowledge?.({ ok: true, booking: serializeBooking(booking) });
  });

  socket.on("visitor:message", ({ body }, acknowledge) => {
    const now = Date.now();
    socket.data.messageTimes = (socket.data.messageTimes || []).filter((time) => now - time < 60_000);
    if (socket.data.messageTimes.length >= 30) {
      return acknowledge?.({ ok: false, error: "Too many messages. Please wait." });
    }
    socket.data.messageTimes.push(now);
    const visitor = socket.data.visitor;
    const messageBody = normalizeMessage(body);
    if (!visitor || !messageBody) {
      return acknowledge?.({ ok: false, error: "Invalid message" });
    }
    const conversation = getConversationForVisitor(
      visitor.conversationId,
      visitor.visitorId,
    );
    if (!conversation || conversation.status !== "open") {
      return acknowledge?.({ ok: false, error: "Conversation is closed" });
    }
    const message = createMessage({
      conversationId: conversation.id,
      senderType: "visitor",
      senderId: visitor.visitorId,
      body: messageBody,
    });
    io.to(`conversation:${conversation.id}`).emit("message:new", message);
    io.to(`agent:${conversation.assigned_agent_id}`).emit("message:new", message);
    emitConversationUpdate(conversation.id);
    acknowledge?.({ ok: true, message });
  });

  socket.on("agent:message", ({ conversationId, body }, acknowledge) => {
    const currentAgent = socket.data.agent;
    const messageBody = normalizeMessage(body);
    if (!currentAgent || !messageBody) {
      return acknowledge?.({ ok: false, error: "Unauthorized" });
    }
    const conversation = getConversation(conversationId);
    if (
      !conversation ||
      conversation.status !== "open" ||
      conversation.assigned_agent_id !== currentAgent.agentId
    ) {
      return acknowledge?.({
        ok: false,
        error: "Claim this open conversation before replying",
      });
    }
    const message = createMessage({
      conversationId,
      senderType: "agent",
      senderId: currentAgent.agentId,
      body: messageBody,
    });
    io.to(`conversation:${conversationId}`).emit("message:new", message);
    io.to(`agent:${conversation.assigned_agent_id}`).emit("message:new", message);
    emitConversationUpdate(conversationId);
    acknowledge?.({ ok: true, message });
  });

  socket.on("disconnect", () => {
    const currentAgent = socket.data.agent;
    if (!currentAgent) return;
    const sockets = onlineAgents.get(currentAgent.agentId);
    sockets?.delete(socket.id);
    if (!sockets?.size) onlineAgents.delete(currentAgent.agentId);
    broadcastPresence();
  });
});

const distDirectory = path.join(projectRoot, "dist");
if (fs.existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api") || request.path.startsWith("/socket.io")) {
      return next();
    }
    response.sendFile(path.join(distDirectory, "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  console.error("[support] request failed", error);
  response.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 3001);
server.listen(port, "0.0.0.0", () => {
  console.log(`[support] server listening on http://127.0.0.1:${port}`);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";

const port = 3101;
const origin = `http://127.0.0.1:${port}`;
const verificationAccounts = [
  { id: "lotus", name: "Lotus", password: "change-me" },
  { id: "support-two", name: "Support Two", password: "change-me" },
  { id: "wellness-three", name: "Wellness Three", password: "change-me" },
];
const databasePath = path.join(os.tmpdir(), `lotus-support-${process.pid}.sqlite`);
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    CHAT_DATABASE_PATH: databasePath,
    CHAT_AUTH_SECRET: "verification-only-secret",
    APP_ORIGIN: origin,
    AGENT_ACCOUNTS: JSON.stringify(verificationAccounts),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk;
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk;
});

const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const { response } = await request("/api/health");
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await pause(100);
  }
  throw new Error(`Support server did not start.\n${serverOutput}`);
}

function waitForSocket(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket connection timed out")), 3000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForEvent(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`${event} timed out`));
    }, 3000);
    const listener = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
}

function socketAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 3000);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      if (!result?.ok) reject(new Error(result?.error || `${event} failed`));
      else resolve(result);
    });
  });
}

function socketResult(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 3000);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

async function login(agentId) {
  const { response, body } = await request("/api/agent/login", {
    method: "POST",
    body: JSON.stringify({ agentId, password: "change-me" }),
  });
  if (!response.ok) throw new Error(`Login failed for ${agentId}`);
  return body.token;
}

async function createConversation(visitorId, visitorName, agentId) {
  const { response, body } = await request("/api/chat/conversations", {
    method: "POST",
    body: JSON.stringify({ visitorId, visitorName, agentId }),
  });
  if (!response.ok) throw new Error(`Conversation failed for ${visitorId}`);
  return body.conversation;
}

async function getAgentQueue(pathname, token) {
  const result = await request(pathname, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result.response.ok) throw new Error(`Queue request failed: ${pathname}`);
  return result.body;
}

async function main() {
  await waitForServer();

  const masseuseResult = await request("/api/masseuses");
  const masseuseIds = masseuseResult.body.masseuses?.map(({ id }) => id).sort();
  if (!masseuseResult.response.ok || masseuseIds?.join(",") !== "lotus,support-two,wellness-three") {
    throw new Error("Public masseuse discovery failed");
  }

  const [lotusToken, supportToken] = await Promise.all([
    login("lotus"),
    login("support-two"),
  ]);
  const [first, second] = await Promise.all([
    createConversation("verification-visitor-one", "Ada Visitor", "lotus"),
    createConversation("verification-visitor-two", "Grace Visitor", "support-two"),
  ]);
  if (
    first.visitor_name !== "Ada Visitor" ||
    first.assigned_agent_id !== "lotus" ||
    second.visitor_name !== "Grace Visitor" ||
    second.assigned_agent_id !== "support-two"
  ) {
    throw new Error("Conversation ownership was not persisted");
  }

  const [lotusQueue, supportQueue] = await Promise.all([
    getAgentQueue("/api/agent/conversations", lotusToken),
    getAgentQueue("/api/agent/conversations", supportToken),
  ]);
  if (
    lotusQueue.conversations.length !== 1 ||
    lotusQueue.conversations[0].id !== first.id ||
    supportQueue.conversations.length !== 1 ||
    supportQueue.conversations[0].id !== second.id
  ) {
    throw new Error("Conversation queues were not isolated by masseuse");
  }

  const crossRead = await request(
    `/api/agent/conversations/${first.id}/messages`,
    { headers: { Authorization: `Bearer ${supportToken}` } },
  );
  if (crossRead.response.status !== 404) {
    throw new Error("Cross-agent conversation read was not blocked");
  }

  const visitorSocket = io(origin);
  const lotusSocket = io(origin, { auth: { token: lotusToken } });
  const supportSocket = io(origin, { auth: { token: supportToken } });
  await Promise.all([
    waitForSocket(visitorSocket),
    waitForSocket(lotusSocket),
    waitForSocket(supportSocket),
  ]);
  await socketAck(visitorSocket, "visitor:join", {
    conversationId: first.id,
    visitorId: "verification-visitor-one",
  });

  let supportSawLotusMessage = false;
  supportSocket.on("message:new", (message) => {
    if (message.conversation_id === first.id) supportSawLotusMessage = true;
  });
  const lotusVisitorMessage = waitForEvent(
    lotusSocket,
    "message:new",
    (message) => message.body === "Hello from visitor one",
  );
  await socketAck(visitorSocket, "visitor:message", {
    body: "Hello from visitor one",
  });
  await lotusVisitorMessage;
  await pause(150);
  if (supportSawLotusMessage) {
    throw new Error("A private visitor message leaked to another agent");
  }

  const visitorReply = waitForEvent(
    visitorSocket,
    "message:new",
    (message) => message.body === "Hello from Lotus",
  );
  await socketAck(lotusSocket, "agent:message", {
    conversationId: first.id,
    body: "Hello from Lotus",
  });
  await visitorReply;

  const unauthorizedReply = await socketResult(supportSocket, "agent:message", {
    conversationId: first.id,
    body: "This must be rejected",
  });
  if (unauthorizedReply?.ok) {
    throw new Error("Cross-agent reply was not blocked");
  }

  const clientToken = "verification-booking-client-token";
  let supportSawLotusBooking = false;
  supportSocket.on("booking:created", (booking) => {
    if (booking.masseuseId === "lotus") supportSawLotusBooking = true;
  });
  const bookingCreated = waitForEvent(
    lotusSocket,
    "booking:created",
    (booking) => booking.masseuseId === "lotus",
  );
  const creation = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      clientToken,
      name: "Payment Test",
      masseuseId: "lotus",
      date: "2030-06-15",
      time: "14:30",
      service: "Swedish Massage - $300",
      notes: "Integration verification",
      paymentMethod: "Bitcoin",
    }),
  });
  if (!creation.response.ok) throw new Error("Booking creation failed");
  const pendingBooking = creation.body.booking;
  const agentBooking = await bookingCreated;
  await pause(150);
  if (
    pendingBooking.status !== "pending_payment" ||
    pendingBooking.bookingCode !== null ||
    pendingBooking.masseuseId !== "lotus" ||
    agentBooking.id !== pendingBooking.id ||
    supportSawLotusBooking
  ) {
    throw new Error("Pending booking ownership or private delivery failed");
  }

  const [lotusBookings, supportBookings] = await Promise.all([
    getAgentQueue("/api/agent/bookings", lotusToken),
    getAgentQueue("/api/agent/bookings", supportToken),
  ]);
  if (
    !lotusBookings.bookings.some(({ id }) => id === pendingBooking.id) ||
    supportBookings.bookings.some(({ id }) => id === pendingBooking.id)
  ) {
    throw new Error("Booking queues were not isolated by masseuse");
  }

  const crossConfirmation = await request(
    `/api/agent/bookings/${pendingBooking.id}/confirm`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${supportToken}` },
    },
  );
  if (crossConfirmation.response.status !== 404) {
    throw new Error("Cross-agent payment confirmation was not blocked");
  }

  await socketAck(visitorSocket, "booking:join", {
    bookingId: pendingBooking.id,
    clientToken,
  });
  const bookingConfirmed = waitForEvent(
    visitorSocket,
    "booking:updated",
    (booking) => booking.id === pendingBooking.id && booking.status === "confirmed",
  );
  const confirmation = await request(
    `/api/agent/bookings/${pendingBooking.id}/confirm`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${lotusToken}` },
    },
  );
  if (!confirmation.response.ok) throw new Error("Payment confirmation failed");
  const liveBooking = await bookingConfirmed;
  if (
    !liveBooking.bookingCode?.startsWith("LTB-") ||
    liveBooking.bookingCode !== confirmation.body.booking.bookingCode
  ) {
    throw new Error("Booking code was not generated on payment confirmation");
  }

  const visitorStatus = await request(
    `/api/bookings/${pendingBooking.id}?clientToken=${clientToken}`,
  );
  if (
    !visitorStatus.response.ok ||
    visitorStatus.body.booking.status !== "confirmed" ||
    visitorStatus.body.booking.bookingCode !== liveBooking.bookingCode
  ) {
    throw new Error("Confirmed booking status was not available to the visitor");
  }

  for (const [index, paymentMethod] of ["Zelle", "Apple Pay", "Chime", "PayPal"].entries()) {
    const methodBooking = await request("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        clientToken: `verification-${paymentMethod.toLowerCase().replaceAll(" ", "-")}`,
        name: "Payment Method Test",
        masseuseId: "support-two",
        date: "2030-06-16",
        time: `15:0${index}`,
        service: "Aromatherapy Massage - $200",
        notes: "",
        paymentMethod,
      }),
    });
    if (
      !methodBooking.response.ok ||
      methodBooking.body.booking.paymentMethod !== paymentMethod ||
      methodBooking.body.booking.masseuseId !== "support-two" ||
      !methodBooking.body.booking.paymentDestination
    ) {
      throw new Error(`${paymentMethod} booking configuration failed`);
    }
  }

  visitorSocket.disconnect();
  lotusSocket.disconnect();
  supportSocket.disconnect();
  console.log(
    "Support verification passed: masseuse discovery, private chat and booking queues, cross-agent denial, payment confirmation, and delayed booking-code generation.",
  );
}

try {
  await main();
} finally {
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}
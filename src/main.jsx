import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AgentDashboard from "./agent/AgentDashboard";
import LegalPage from "./legal/LegalPage";
import { isAgentAuthCallback } from "./lib/supabase";
import "./styles.css";

if (
  isAgentAuthCallback &&
  !window.location.pathname.startsWith("/agent")
) {
  window.history.replaceState(
    {},
    "",
    `/agent${window.location.search}${window.location.hash}`,
  );
}

const pathname = window.location.pathname;

let page = <App />;
if (pathname.startsWith("/agent")) {
  page = <AgentDashboard />;
} else if (pathname === "/terms") {
  page = <LegalPage type="terms" />;
} else if (pathname === "/privacy") {
  page = <LegalPage type="privacy" />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>{page}</StrictMode>,
);

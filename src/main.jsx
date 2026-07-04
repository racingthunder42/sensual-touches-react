import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AgentDashboard from "./agent/AgentDashboard";
import LegalPage from "./legal/LegalPage";
import "./styles.css";

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

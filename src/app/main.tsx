import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import { AppProviders } from "./providers";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);

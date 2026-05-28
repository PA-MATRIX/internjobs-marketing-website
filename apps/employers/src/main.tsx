import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

// Vite injects VITE_* env vars into import.meta.env at build time. The Clerk
// publishable key is public by design — it identifies the Clerk app and is
// safe to ship in the static bundle. Infisical maps
// STARTUPS_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY → VITE_CLERK_PUBLISHABLE_KEY at
// deploy time (Vite uses the VITE_* prefix; Next.js uses NEXT_PUBLIC_*).
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

if (!PUBLISHABLE_KEY) {
  // Fail loudly in the browser console; do NOT silently render a broken app.
  // eslint-disable-next-line no-console
  console.error(
    "[internjobs-startups] missing VITE_CLERK_PUBLISHABLE_KEY. " +
      "set it in .env.local (local dev) or wrangler pages env (prod).",
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY ?? ""}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ClerkProvider>
  </React.StrictMode>,
);

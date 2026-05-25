import { Routes, Route } from "react-router-dom";
import { SignIn } from "./pages/SignIn";
import { Dashboard } from "./pages/Dashboard";
import { ProtectedRoute } from "./components/ProtectedRoute";

// React Router v6 routes for the founder portal.
//
// Path map:
//   /                — Clerk-powered sign-in landing
//   /dashboard       — founder home (gated)
//   /roles/new       — create a new role (gated; placeholder until 28.5-03)
//   /roles/:id       — role detail (gated; placeholder until 28.5-03)
//   /candidates/:id  — candidate detail (gated; placeholder until 28.5-03)
//   /thread/:id      — message thread view (gated; placeholder until 28.5-03)
//
// Sign-up is unified into the sign-in widget (Clerk handles both flows on the
// same page). Work-email enforcement happens server-side via the user.created
// webhook (Phase 28.5-05), not in the route layer.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SignIn />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/roles/new"
        element={
          <ProtectedRoute>
            <PlaceholderPage label="roles, new" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/roles/:id"
        element={
          <ProtectedRoute>
            <PlaceholderPage label="role detail" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/candidates/:id"
        element={
          <ProtectedRoute>
            <PlaceholderPage label="candidate detail" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/thread/:id"
        element={
          <ProtectedRoute>
            <PlaceholderPage label="thread view" />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function PlaceholderPage({ label }: { label: string }) {
  return (
    <main className="min-h-screen bg-lavender text-ink p-8">
      <h1 className="text-h2 font-extrabold lowercase">{label}</h1>
      <p className="mt-2 text-sm opacity-70">coming in 28.5-03.</p>
    </main>
  );
}

function NotFound() {
  return (
    <main className="min-h-screen bg-lavender text-ink p-8">
      <h1 className="text-h1 font-extrabold lowercase">not found</h1>
      <p className="mt-2 text-sm opacity-70">
        the page you're looking for doesn't exist.
      </p>
    </main>
  );
}

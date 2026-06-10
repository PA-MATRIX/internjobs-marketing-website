import { Routes, Route } from "react-router-dom";
import { SignIn } from "./pages/SignIn";
import { Dashboard } from "./pages/Dashboard";
import { RolesNew } from "./pages/RolesNew";
import { RoleDetail } from "./pages/RoleDetail";
import { CandidateDetail } from "./pages/CandidateDetail";
import { ThreadView } from "./pages/ThreadView";
import { ProtectedRoute } from "./components/ProtectedRoute";

// React Router v6 routes for the founder portal.
//
// Path map:
//   /                — Clerk-powered sign-in landing
//   /dashboard       — founder home (live data, gated)
//   /roles/new       — create a new role (gated)
//   /roles/:id       — role detail (gated)
//   /candidates/:id  — candidate detail (gated; v1.5 will expand)
//   /thread/:id      — message thread view + reply (gated)
//
// Sign-up is unified into the sign-in widget (Clerk handles both flows on
// the same page). Work-email enforcement happens server-side via the
// user.created webhook (Phase 28.5-05), not in the route layer.
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
            <RolesNew />
          </ProtectedRoute>
        }
      />
      <Route
        path="/roles/:id"
        element={
          <ProtectedRoute>
            <RoleDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/candidates/:id"
        element={
          <ProtectedRoute>
            <CandidateDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/thread/:id"
        element={
          <ProtectedRoute>
            <ThreadView />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
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

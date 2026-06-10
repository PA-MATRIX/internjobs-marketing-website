import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RoleForm } from "../components/RoleForm";
import { Button } from "../components/ui/Button";
import { useApiBound } from "../lib/api";
import type { CreateRoleBody } from "../lib/api";

// RolesNew — page wrapper around RoleForm.
//
// Flow:
//   1. Render <RoleForm onSubmit={…} />.
//   2. On submit → call api.createRole(body) (POST /api/roles → Fly /v1/roles).
//   3. On success → navigate('/dashboard'). The dashboard re-fetches on mount
//      and the new role appears in the roles list.
//   4. On error → render inline error message inside the form. Do not navigate.

export function RolesNew() {
  const api = useApiBound();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(body: CreateRoleBody) {
    setSubmitting(true);
    setError(null);
    try {
      await api.createRole(body);
      navigate("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error
          ? `couldn't post role: ${err.message}`
          : "couldn't post role. please retry.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-lavender text-ink">
      <header className="border-b border-ink/10 bg-cream px-6 py-4 flex items-center justify-between">
        <Link to="/dashboard" className="block">
          <p className="text-label uppercase tracking-widest text-ink/60">
            internjobs<span className="accent-dot">.</span>ai
          </p>
          <h1 className="text-h2 font-extrabold lowercase">post a role</h1>
        </Link>
        <Link to="/dashboard">
          <Button variant="ghost">← back to dashboard</Button>
        </Link>
      </header>

      <section className="px-6 py-8 max-w-3xl mx-auto">
        <p className="text-sm text-ink/70 lowercase mb-6">
          this writes to the same roles table your agent uses for matching —
          the form and the mcp tool share one schema, so anything you post
          here is immediately searchable.
        </p>
        <RoleForm
          onSubmit={handleSubmit}
          submitting={submitting}
          error={error}
        />
      </section>
    </main>
  );
}

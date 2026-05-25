import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "./ui/Button";
import { Card, CardContent } from "./ui/Card";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";
import { Textarea } from "./ui/Textarea";
import type { CreateRoleBody } from "../lib/api";

// RoleForm — controlled form for creating a new role.
//
// SCHEMA PARITY (STARTUP-WEB-DASH-02): fields match the MCP
// `execute('post_role')` enum exactly:
//   - title (required, text)
//   - description (required, textarea, min 20 chars)
//   - location (optional, text)
//   - employment_type (optional, enum: full_time | part_time | contract |
//     internship)
//
// Do NOT add fields not in the MCP schema. The Fly proxy will reject
// unknown columns, and schema fragmentation between MCP and web is a
// hard regression target.

const EMPLOYMENT_TYPES = [
  { value: "", label: "any" },
  { value: "full_time", label: "full-time" },
  { value: "part_time", label: "part-time" },
  { value: "contract", label: "contract" },
  { value: "internship", label: "internship" },
] as const;

export interface RoleFormProps {
  /** Called with the validated role body on submit. */
  onSubmit: (body: CreateRoleBody) => Promise<void> | void;
  /** Disable all inputs (e.g. while request in flight). */
  submitting?: boolean;
  /** Inline error to render under the form. */
  error?: string | null;
}

export function RoleForm({ onSubmit, submitting, error }: RoleFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const titleValid = title.trim().length > 0;
  const descriptionValid = description.trim().length >= 20;
  const canSubmit = titleValid && descriptionValid && !submitting;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    if (!titleValid) {
      setLocalError("title is required");
      return;
    }
    if (!descriptionValid) {
      setLocalError("description must be at least 20 characters");
      return;
    }
    const body: CreateRoleBody = {
      title: title.trim(),
      description: description.trim(),
    };
    if (location.trim()) body.location = location.trim();
    if (employmentType) {
      body.employment_type =
        employmentType as CreateRoleBody["employment_type"];
    }
    await onSubmit(body);
  }

  const displayError = error ?? localError;

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <Label htmlFor="role-title">title</Label>
            <Input
              id="role-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. founding engineer"
              disabled={submitting}
              required
              maxLength={140}
            />
          </div>

          <div>
            <Label htmlFor="role-description">description</Label>
            <Textarea
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="what will this person do, what does the team look like, what's the comp range, what do they need to bring..."
              disabled={submitting}
              rows={6}
              required
              minLength={20}
            />
            <p className="text-xs text-ink/50 lowercase mt-1">
              {description.length} / 20+ characters
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <Label htmlFor="role-location">location (optional)</Label>
              <Input
                id="role-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. bangalore / remote"
                disabled={submitting}
                maxLength={140}
              />
            </div>

            <div>
              <Label htmlFor="role-employment-type">
                employment type (optional)
              </Label>
              <select
                id="role-employment-type"
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
                disabled={submitting}
                className="w-full bg-cream text-ink border border-ink/15 rounded-mark px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:border-cobalt disabled:opacity-60"
              >
                {EMPLOYMENT_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {displayError && (
            <p
              role="alert"
              className="text-sm text-tangerine lowercase border border-tangerine/30 bg-tangerine/5 rounded-mark px-3 py-2"
            >
              {displayError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {submitting ? "posting…" : "post role →"}
            </Button>
            <span className="text-xs text-ink/50 lowercase">
              your agent will start matching candidates immediately.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

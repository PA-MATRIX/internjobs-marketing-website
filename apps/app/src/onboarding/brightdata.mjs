// apps/app/src/onboarding/brightdata.mjs
//
// Bright Data LinkedIn Profiles API client. Input is the public LinkedIn URL
// we already require before QR creation; output is normalized into the same
// shape stored by linkUserLinkedInProfile() so the workflow/prompt does not
// care which provider supplied the data.

const BRIGHTDATA_SCRAPE_URL = "https://api.brightdata.com/datasets/v3/scrape";
const DEFAULT_LINKEDIN_PROFILE_DATASET_ID = "gd_l1viktl72bvl7bjuj0";

export async function enrichByBrightDataLinkedInUrl({ linkedinUrl, apiToken, datasetId }) {
  if (!linkedinUrl || !apiToken) return null;

  const url = new URL(BRIGHTDATA_SCRAPE_URL);
  url.searchParams.set("dataset_id", datasetId || DEFAULT_LINKEDIN_PROFILE_DATASET_ID);
  url.searchParams.set("format", "json");

  const raw = await fetchBrightData(url, apiToken, [{ url: linkedinUrl }]);
  const row = Array.isArray(raw) ? raw.find((item) => item && !item.error) || raw[0] : raw;
  if (!row || typeof row !== "object" || row.error) return null;

  return normalizeBrightDataProfile(row, linkedinUrl);
}

async function fetchBrightData(url, apiToken, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.ok) return res.json().catch(() => null);

  const text = await res.text().catch(() => "");
  console.warn(
    JSON.stringify({
      level: "warn",
      message: "brightdata_linkedin_profile_failed",
      status: res.status,
      body: text.slice(0, 200),
    }),
  );
  return null;
}

function normalizeBrightDataProfile(raw, inputUrl) {
  const currentCompany =
    raw.current_company?.name ||
    raw.current_company_name ||
    raw.current_company ||
    "";
  const headline = raw.position || raw.headline || "";

  return {
    linkedinUrl: raw.url || raw.input_url || inputUrl || "",
    linkedinId: raw.linkedin_id || raw.id || raw.linkedin_num_id || "",
    headline,
    summary: raw.about || raw.summary || raw.bio || "",
    currentCompany: typeof currentCompany === "string" ? currentCompany : "",
    currentTitle: deriveCurrentTitle(raw, currentCompany),
    schools: normalizeSchools(raw.education || raw.educations_details || []),
    experiences: normalizeExperiences(raw.experience || raw.experiences || []),
    skills: normalizeSkills(raw.skills || []),
    raw,
  };
}

function deriveCurrentTitle(raw, currentCompany) {
  if (raw.current_title) return raw.current_title;
  const firstExperience = Array.isArray(raw.experience) ? raw.experience[0] : null;
  if (firstExperience?.title) return firstExperience.title;
  const position = String(raw.position || "");
  const company = typeof currentCompany === "string" ? currentCompany : "";
  if (position && company && position.toLowerCase().endsWith(` at ${company}`.toLowerCase())) {
    return position.slice(0, -(` at ${company}`.length)).trim();
  }
  return position;
}

function normalizeSchools(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((school) => {
    if (typeof school === "string") {
      return { school, degree: "", fieldOfStudy: "", endYear: null };
    }
    return {
      school: school.title || school.school || school.name || "",
      degree: school.degree || school.degree_name || "",
      fieldOfStudy: school.field || school.field_of_study || "",
      endYear: school.end_year || school.ends_at?.year || null,
    };
  }).filter((school) => school.school || school.degree || school.fieldOfStudy);
}

function normalizeExperiences(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((exp) => {
    if (typeof exp === "string") {
      return { company: exp, title: "", description: "", startsAt: "", endsAt: "" };
    }
    const company = exp.company || exp.company_name || exp.subtitle || "";
    return {
      company: typeof company === "string" ? company : company?.name || "",
      title: exp.title || exp.position || "",
      description: exp.description || exp.description_html || exp.about || "",
      startsAt: exp.start_date || exp.starts_at || "",
      endsAt: exp.end_date || exp.ends_at || "",
    };
  }).filter((exp) => exp.company || exp.title || exp.description);
}

function normalizeSkills(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((skill) => {
    if (typeof skill === "string") return skill;
    return skill?.name || skill?.title || "";
  }).filter(Boolean);
}

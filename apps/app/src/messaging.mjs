export function createWelcomeText(student) {
  return `Hey ${firstName(student.name) || "there"} - you're in. Welcome to InternJobs.ai. We'll text when something actually fits.`;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

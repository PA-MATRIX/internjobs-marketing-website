import {
  ArrowRight,
  BatteryFull,
  ChevronDown,
  Infinity as InfinityIcon,
  Linkedin,
  Menu,
  MessageCircle,
  Phone,
  Search,
  Send,
  ShieldCheck,
  Signal,
  UserRound,
  Wifi,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useInView, useScroll, useTransform } from "framer-motion";
import { siDiscord, siImessage, siWhatsapp } from "simple-icons";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type ChatMessage = {
  author: "agent" | "student";
  text: string;
  meta?: string;
};

type Channel = {
  name: string;
  label: string;
  color: string;
  soft: string;
  icon: ReactNode;
  emojis: string[];
  messages: ChatMessage[];
};

type LegalBlock = {
  title?: string;
  paragraphs?: string[];
  bullets?: string[];
};

type LegalPageContent = {
  title: string;
  updated: string;
  intro: string[];
  sections: {
    title: string;
    blocks: LegalBlock[];
  }[];
};

const messageAnimation = {
  firstBubbleDelay: 1100,
  nextBubbleDelay: 1250,
  cyclePause: 3800,
};

const navLinks = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Channels", href: "#channels" },
  { label: "Why it helps", href: "#signals" },
  { label: "Startups", href: "/startups" },
  { label: "FAQ", href: "#faq" },
];

const startupNavLinks = [
  { label: "How it works", href: "#startup-how" },
  { label: "Signals", href: "#startup-signals" },
  { label: "FAQ", href: "#startup-faq" },
];

const studentFooterLinks = [
  ...navLinks,
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Contact", href: "mailto:hello@internjobs.ai" },
];

const heroMessages: ChatMessage[] = [
  { author: "agent", text: "Hey Jordan, found something you'd probably be into." },
  { author: "agent", text: "Growth intern. Early-stage AI startup. Remote + paid." },
  { author: "student", text: "Okay wait this actually looks really good" },
  { author: "agent", text: "Yeah. Your AI newsletter and campus ambassador stuff made this stand out." },
  { author: "student", text: "Can you help me reply?" },
  { author: "agent", text: "Already drafted something. You can edit it or approve before it sends." },
  { author: "student", text: "Perfect. If they reply, can you set up the interview?" },
  { author: "agent", text: "Yep. I can handle the back-and-forth with the hiring manager." },
];

const channels: Channel[] = [
  {
    name: "iMessage",
    label: "iMessage",
    color: "#007AFF",
    soft: "#E8F2FF",
    icon: <PlatformLogo platform="imessage" className="size-4" />,
    emojis: ["text", "paid", "remote", "fit", "draft"],
    messages: [
      { author: "agent", text: "Found a startup looking for campus growth help." },
      { author: "student", text: "Is it actually a fit?" },
      { author: "agent", text: "Yes. Remote, paid, and your newsletter helps here.", meta: "Delivered" },
    ],
  },
  {
    name: "WhatsApp",
    label: "WhatsApp",
    color: "#25D366",
    soft: "#E9FBEF",
    icon: <PlatformLogo platform="whatsapp" className="size-4" />,
    emojis: ["paid", "class", "quick", "yes", "new"],
    messages: [
      { author: "agent", text: "Two paid roles opened while you were in class." },
      { author: "student", text: "Send the stronger one." },
      { author: "agent", text: "This one has real product work and a small team.", meta: "New" },
    ],
  },
  {
    name: "Slack",
    label: "Slack",
    color: "#4A154B",
    soft: "#FFF0F5",
    icon: <PlatformLogo platform="slack" className="size-4" />,
    emojis: ["#finds", "draft", "ship", "reply", "prep"],
    messages: [
      { author: "agent", text: "A builder community posted a growth internship before it hit LinkedIn." },
      { author: "student", text: "Can you make my reply sound natural?" },
      { author: "agent", text: "Yes. Short, normal, and easy to send." },
    ],
  },
  {
    name: "Discord",
    label: "Discord",
    color: "#5865F2",
    soft: "#EEF0FF",
    icon: <PlatformLogo platform="discord" className="size-4" />,
    emojis: ["drop", "dm", "build", "fit", "send"],
    messages: [
      { author: "agent", text: "Design engineer internship in a founder Discord." },
      { author: "student", text: "I have projects, but no formal title yet." },
      { author: "agent", text: "That's fine. Your prototypes are what matter here." },
    ],
  },
  {
    name: "Phone",
    label: "Phone",
    color: "#34C759",
    soft: "#EDFFF4",
    icon: <PlatformLogo platform="phone" className="size-4" />,
    emojis: ["call", "prep", "calm", "ask", "go"],
    messages: [
      { author: "agent", text: "Founder call tomorrow. Want a quick prep sheet?" },
      { author: "student", text: "Yes please. I get nervous on calls." },
      { author: "agent", text: "Done. 3 things to say and 2 questions to ask." },
    ],
  },
];

const steps = [
  ["Start with what you have", "Use LinkedIn or your projects so InternJobs.ai knows the basics. No giant profile to fill out."],
  ["Text it naturally", "Say what kind of work you want and what you have already built."],
  ["Get the text", "InternJobs.ai keeps looking in the background, texts when something fits, and helps coordinate the next step."],
];

const signals = [
  ["Found before LinkedIn", "A small team posted it in a community first.", "new"],
  ["Actually fits", "Remote, paid, and close to stuff you've already built.", "now"],
  ["Reply drafted", "Short, normal, and easy to send.", "ready"],
  ["Interview setup", "Back-and-forth with the hiring manager handled over text.", "next"],
];

const faqs = [
  [
    "Is this another job board?",
    "No. InternJobs.ai texts you when something actually looks worth your time, then helps you reply without the awkward blank-page moment.",
  ],
  [
    "Does it apply without me?",
    "No. You stay in control. It can draft replies and help set up the interview, but you approve before anything gets sent.",
  ],
  [
    "Do I need a perfect resume?",
    "No. Projects, clubs, posts, campus work, random experiments. All of that can help. Start with what you have.",
  ],
  [
    "Where will it text me?",
    "The goal is to meet you where you already are: iMessage, WhatsApp, Slack, Discord, and simple phone reminders.",
  ],
];

const employerCards = [
  ["Share the real work", "What they will build, who they will learn from, and what kind of student will enjoy it."],
  ["Reach students where they are", "InternJobs.ai explains the role over text, with enough context to make it feel worth a reply."],
  ["Get clearer replies", "Students can ask for help drafting something short, normal, and easy to send."],
];

const startupFloatingCards = ["Strong fit detected", "Founder requested intro", "Student approved intro", "Reply drafted", "Context card viewed"];

const resumeProblems = ["cold applications", "generic resumes", "low-context conversations", "students spraying applications everywhere"];
const resumeFocuses = ["students who actually fit", "startup interest", "projects and initiative", "conversational matching", "warmer intros"];

const startupContextCards = [
  ["Built things already", "Projects, side quests, waitlists, communities, creator work, startup curiosity."],
  ["Actually interested", "Students matched based on goals, interests, and startup fit."],
  ["Startup-friendly energy", "Students who want ownership, ambiguity, and fast-moving teams."],
  ["Reply naturally", "Students can respond over text before the first call."],
];

const startupSignals = ["Founder posts", "Discord communities", "Student builders", "Warm intro paths", "Startup interest signals"];

const humanNoList = ["No giant applicant spreadsheets", "No resume black holes", "No generic cold outreach", "No easy apply spam", "No awkward first messages"];
const humanYesList = ["Students with context", "Faster replies", "Natural conversations", "Warm intros", "People who actually care about startups"];

const startupSteps = [
  ["Describe the role", "What they'll build, learn, and work on."],
  ["InternJobs.ai keeps looking", "Projects, startup communities, student builders, and internship interest."],
  ["Students get the text", "The role gets explained with context, not just a listing."],
  ["Start the conversation", "Students can reply naturally before the first call."],
];

const startupFaqs = [
  ["Is this an ATS?", "No. InternJobs.ai is a conversational internship matching layer built for startups and students."],
  ["Do students approve intros?", "Yes. Nothing moves forward without student approval."],
  ["What kinds of startups is this built for?", "Founder-led teams, AI startups, growth-stage startups, remote teams, and companies hiring through networks and communities."],
  ["Can students reply over text?", "Yes. The experience is messaging-first."],
  ["How is this different from LinkedIn?", "InternJobs.ai focuses on startup fit, projects, interest, and conversational matching, not just applications."],
];

const privacyContent: LegalPageContent = {
  title: "Privacy Policy",
  updated: "Last updated: May 2026",
  intro: [
    'InternJobs.ai ("InternJobs.ai", "we", "our", or "us") is committed to protecting your privacy and being transparent about how information is collected and used.',
    'This Privacy Policy explains how we collect, use, store, and protect information when you use InternJobs.ai, our website, messaging experiences, waitlists, integrations, and related services (the "Services").',
    "By using InternJobs.ai, you agree to the practices described in this Privacy Policy.",
  ],
  sections: [
    {
      title: "1. What InternJobs.ai Does",
      blocks: [
        {
          paragraphs: [
            "InternJobs.ai is a messaging-first internship discovery and matching platform designed to help students discover startup internships and help startups discover relevant student talent.",
          ],
        },
        {
          title: "InternJobs.ai may:",
          bullets: [
            "send internship opportunities through messaging channels",
            "help users draft replies or introductions",
            "provide internship-related suggestions or prep",
            "help startups discover relevant students",
            "facilitate warm introductions between users and startups",
          ],
        },
        {
          paragraphs: ["InternJobs.ai does not automatically send important outbound introductions or replies without user approval."],
        },
      ],
    },
    {
      title: "2. Information We Collect",
      blocks: [
        { paragraphs: ["We may collect the following types of information."] },
        {
          title: "Information You Provide",
          paragraphs: ["When you use InternJobs.ai, we may collect:"],
          bullets: [
            "name",
            "email address",
            "phone number",
            "LinkedIn profile information",
            "school information",
            "graduation year",
            "internship interests",
            "resume or project information",
            "messages you send through InternJobs.ai",
            "startup hiring information",
            "communication preferences",
          ],
        },
        {
          title: "LinkedIn Information",
          paragraphs: ["If you connect LinkedIn, we may access information available through your authorized LinkedIn account, including:"],
          bullets: ["name", "headline", "profile URL", "education history", "experience", "public projects or activity", "profile photo", "skills and interests"],
        },
        { paragraphs: ["We only access information you authorize through LinkedIn."] },
        {
          title: "Messaging & Communication Data",
          paragraphs: ["If you interact with InternJobs.ai through SMS, iMessage, WhatsApp, Discord, Slack, phone, or other supported channels, we may collect:"],
          bullets: ["message content", "timestamps", "delivery metadata", "conversation history", "support interactions"],
        },
        {
          title: "Automatically Collected Information",
          paragraphs: ["We may automatically collect:"],
          bullets: ["device information", "browser type", "IP address", "referral pages", "usage activity", "interaction data", "analytics events", "cookies or similar technologies"],
        },
      ],
    },
    {
      title: "3. How We Use Information",
      blocks: [
        {
          paragraphs: ["We use information to:"],
          bullets: [
            "provide and improve InternJobs.ai",
            "match students with internships",
            "personalize recommendations",
            "explain why opportunities may fit",
            "help draft replies or introductions",
            "support startup recruiting workflows",
            "communicate updates or opportunities",
            "maintain platform safety and integrity",
            "analyze usage and improve product quality",
            "prevent abuse, fraud, or spam",
          ],
        },
        { paragraphs: ["We may also use aggregated or anonymized information to improve the platform."] },
      ],
    },
    {
      title: "4. Messaging & Communication Consent",
      blocks: [
        {
          paragraphs: ["By providing your phone number or connecting messaging channels, you consent to receiving messages related to:"],
          bullets: ["internship opportunities", "startup matches", "reminders", "onboarding", "account updates", "waitlist notifications", "support communications"],
        },
        { paragraphs: ["Message frequency may vary."] },
        {
          paragraphs: ["You may opt out of communications at any time by:"],
          bullets: ["replying STOP", "adjusting account settings", "contacting support"],
        },
        { paragraphs: ["Standard carrier and messaging rates may apply."] },
      ],
    },
    {
      title: "5. User Control",
      blocks: [
        { paragraphs: ["InternJobs.ai is designed to keep users in control."] },
        {
          paragraphs: ["Important outbound actions such as:"],
          bullets: ["introductions", "startup replies", "outreach messages", "internship responses"],
        },
        { paragraphs: ["should require user approval before sending."] },
        {
          paragraphs: ["Users may:"],
          bullets: ["edit drafts", "approve or reject messages", "disconnect integrations", "update profile information", "request account deletion"],
        },
      ],
    },
    {
      title: "6. How Information Is Shared",
      blocks: [
        { paragraphs: ["We do not sell personal information."] },
        {
          paragraphs: ["We may share information with:"],
          bullets: [
            "startups or hiring teams when users approve introductions",
            "infrastructure providers",
            "messaging providers",
            "analytics providers",
            "authentication providers",
            "legal authorities when required by law",
            "successors in the event of a merger, acquisition, or asset transfer",
          ],
        },
        {
          paragraphs: ["Service providers may include:"],
          bullets: ["hosting providers", "messaging infrastructure providers", "analytics tools", "authentication providers", "communication APIs", "customer support tools"],
        },
        { paragraphs: ["These providers are only permitted to process information to support InternJobs.ai services."] },
      ],
    },
    {
      title: "7. Messaging Providers & Integrations",
      blocks: [
        {
          paragraphs: ["InternJobs.ai may rely on third-party messaging and communication providers to deliver messaging experiences across channels such as:"],
          bullets: ["SMS", "iMessage", "WhatsApp", "Slack", "Discord", "voice or phone services"],
        },
        { paragraphs: ["These providers may process message metadata or communication content as necessary to operate their services."] },
      ],
    },
    {
      title: "8. Data Retention",
      blocks: [
        {
          paragraphs: ["We retain information only as long as reasonably necessary to:"],
          bullets: ["provide services", "maintain accounts", "improve matching", "comply with legal obligations", "prevent abuse or fraud", "resolve disputes"],
        },
        { paragraphs: ["Users may request deletion of their accounts or personal information by contacting support."] },
        { paragraphs: ["Some limited information may temporarily remain in backups, logs, or abuse-prevention systems."] },
      ],
    },
    {
      title: "9. Security",
      blocks: [
        {
          paragraphs: ["We use reasonable administrative, technical, and organizational safeguards designed to protect information from:"],
          bullets: ["unauthorized access", "misuse", "disclosure", "alteration", "destruction"],
        },
        { paragraphs: ["However, no online platform or communication method can guarantee absolute security."] },
      ],
    },
    {
      title: "10. Age Requirements",
      blocks: [
        { paragraphs: ["InternJobs.ai is intended for users who are at least 18 years old.", "We do not knowingly collect personal information from individuals under 18.", "If we become aware that information has been collected from someone under 18, we will take steps to delete it."] },
      ],
    },
    {
      title: "11. Your Rights",
      blocks: [
        {
          paragraphs: ["Depending on your location, you may have rights to:"],
          bullets: ["access personal information", "correct inaccurate information", "request deletion", "withdraw consent", "restrict certain processing", "export data", "object to certain uses"],
        },
        { paragraphs: ["To exercise these rights, contact us using the information below."] },
      ],
    },
    {
      title: "12. Cookies & Analytics",
      blocks: [
        {
          paragraphs: ["InternJobs.ai may use:"],
          bullets: ["cookies", "local storage", "analytics tools", "similar technologies"],
        },
        {
          paragraphs: ["to:"],
          bullets: ["improve functionality", "understand product usage", "maintain sessions", "personalize experiences", "analyze performance"],
        },
        { paragraphs: ["Users may control cookies through browser settings where supported."] },
      ],
    },
    {
      title: "13. International Data Transfers",
      blocks: [
        { paragraphs: ["Information may be processed or stored in countries outside your own jurisdiction.", "By using InternJobs.ai, you consent to the transfer and processing of information where necessary to provide the Services."] },
      ],
    },
    {
      title: "14. Changes To This Policy",
      blocks: [
        { paragraphs: ["We may update this Privacy Policy from time to time."] },
        {
          paragraphs: ["If significant changes are made, we may notify users through:"],
          bullets: ["the website", "messaging channels", "email", "product notifications"],
        },
        { paragraphs: ["Continued use of InternJobs.ai after updates means you accept the revised policy."] },
      ],
    },
    {
      title: "15. Contact",
      blocks: [{ paragraphs: ["Questions about this Privacy Policy may be sent to:", "privacy@internjobs.ai", "InternJobs.ai"] }],
    },
  ],
};

const termsContent: LegalPageContent = {
  title: "Terms of Service",
  updated: "Last updated: May 2026",
  intro: [
    "Welcome to InternJobs.ai.",
    'These Terms of Service ("Terms") govern your access to and use of InternJobs.ai, including our website, messaging experiences, waitlists, integrations, and related services (collectively, the "Services").',
    "By using InternJobs.ai, you agree to these Terms.",
    "If you do not agree to these Terms, please do not use the Services.",
  ],
  sections: [
    {
      title: "1. About InternJobs.ai",
      blocks: [
        {
          paragraphs: ["InternJobs.ai is a messaging-first internship discovery and matching platform designed to help:"],
          bullets: [
            "students discover startup internships",
            "startups discover relevant student talent",
            "both sides connect through conversational matching and warm introductions",
          ],
        },
        {
          paragraphs: ["InternJobs.ai may:"],
          bullets: [
            "send internship opportunities",
            "help users draft replies or introductions",
            "provide interview prep or internship-related suggestions",
            "facilitate introductions between startups and students",
            "support messaging experiences across channels",
          ],
        },
        {
          paragraphs: ["InternJobs.ai is not:"],
          bullets: ["an employer", "a recruiting agency", "a staffing firm", "a university placement office"],
        },
        {
          paragraphs: ["We do not guarantee:"],
          bullets: ["internships", "interviews", "offers", "responses from startups", "hiring outcomes"],
        },
      ],
    },
    {
      title: "2. Eligibility",
      blocks: [
        { paragraphs: ["You must be at least 18 years old to use InternJobs.ai."] },
        {
          paragraphs: ["By using the Services, you represent and warrant that:"],
          bullets: ["you are at least 18 years old", "you can legally enter into these Terms", "the information you provide is accurate"],
        },
        { paragraphs: ["If you use InternJobs.ai on behalf of a company or startup, you represent that you have authority to act on behalf of that organization."] },
      ],
    },
    {
      title: "3. User Accounts & LinkedIn",
      blocks: [
        {
          paragraphs: ["InternJobs.ai may allow users to:"],
          bullets: ["create accounts", "join waitlists", "connect LinkedIn", "connect messaging channels", "communicate with internship agents"],
        },
        {
          paragraphs: ["You are responsible for:"],
          bullets: ["maintaining the security of your account", "protecting access credentials", "keeping information accurate"],
        },
        {
          paragraphs: ["You agree not to:"],
          bullets: ["impersonate another person", "provide false information", "create fake profiles", "misuse LinkedIn integrations", "attempt unauthorized access to the Services"],
        },
      ],
    },
    {
      title: "4. Messaging & Communication",
      blocks: [
        {
          paragraphs: ["InternJobs.ai may communicate with users through:"],
          bullets: ["SMS", "iMessage", "WhatsApp", "Slack", "Discord", "phone or voice", "email", "supported messaging platforms"],
        },
        {
          paragraphs: ["By providing contact information, you consent to receiving communications related to:"],
          bullets: ["internship opportunities", "startup matches", "onboarding", "reminders", "product updates", "support messages", "waitlist notifications"],
        },
        { paragraphs: ["Message frequency may vary.", "Standard carrier and messaging rates may apply."] },
        {
          paragraphs: ["You may opt out at any time by:"],
          bullets: ["replying STOP where supported", "adjusting settings", "contacting support"],
        },
      ],
    },
    {
      title: "5. User Approval & Introductions",
      blocks: [
        { paragraphs: ["InternJobs.ai is designed to keep users in control."] },
        {
          paragraphs: ["Important outbound actions such as:"],
          bullets: ["startup introductions", "internship replies", "outreach messages", "warm introductions"],
        },
        { paragraphs: ["should require user approval before sending."] },
        {
          paragraphs: ["However, users remain fully responsible for:"],
          bullets: ["reviewing drafts", "approving communications", "confirming accuracy", "deciding whether to proceed with conversations"],
        },
      ],
    },
    {
      title: "6. Startup & Employer Terms",
      blocks: [
        {
          paragraphs: ["Startups and hiring teams using InternJobs.ai agree:"],
          bullets: [
            "not to misuse student information",
            "not to spam users",
            "not to scrape or export information without authorization",
            "not to discriminate unlawfully",
            "not to impersonate companies or hiring managers",
            "not to post fraudulent opportunities",
          ],
        },
        {
          paragraphs: ["InternJobs.ai may remove:"],
          bullets: ["fake startups", "misleading listings", "abusive users", "spammy behavior", "unsafe or inappropriate opportunities"],
        },
        { paragraphs: ["We reserve the right to suspend or remove access at any time."] },
      ],
    },
    {
      title: "7. User Content",
      blocks: [
        {
          paragraphs: ["You may provide:"],
          bullets: ["resumes", "LinkedIn information", "project details", "messages", "internship preferences", "startup role descriptions", "communication content"],
        },
        { paragraphs: ["You retain ownership of your content."] },
        {
          paragraphs: ["By using InternJobs.ai, you grant us a limited license to:"],
          bullets: ["process content", "display content where necessary", "facilitate introductions", "improve matching", "operate the Services"],
        },
        {
          paragraphs: ["You represent that:"],
          bullets: ["you have rights to the content you provide", "your content does not violate laws or third-party rights"],
        },
      ],
    },
    {
      title: "8. Acceptable Use",
      blocks: [
        {
          paragraphs: ["You agree not to:"],
          bullets: ["misuse the Services", "interfere with platform operations", "reverse engineer the platform", "scrape data", "use bots or automation improperly", "harass users", "send spam", "violate applicable laws", "upload malicious code", "attempt unauthorized access"],
        },
        { paragraphs: ["InternJobs.ai may investigate and remove harmful activity."] },
      ],
    },
    {
      title: "9. AI-Generated Suggestions",
      blocks: [
        {
          paragraphs: ["InternJobs.ai may generate:"],
          bullets: ["internship recommendations", "message drafts", "summaries", "prep notes", "fit explanations", "conversational suggestions"],
        },
        {
          paragraphs: ["These outputs are generated automatically and may:"],
          bullets: ["contain errors", "be incomplete", "become outdated", "require review"],
        },
        { paragraphs: ["Users are responsible for reviewing AI-generated content before relying on it."] },
      ],
    },
    {
      title: "10. No Employment Guarantee",
      blocks: [
        {
          paragraphs: ["InternJobs.ai does not guarantee:"],
          bullets: ["interviews", "internship offers", "startup responses", "successful matches", "hiring outcomes"],
        },
        { paragraphs: ["Startup hiring decisions remain entirely independent."] },
      ],
    },
    {
      title: "11. Privacy",
      blocks: [
        { paragraphs: ["Your use of InternJobs.ai is also governed by our Privacy Policy.", "Please review the Privacy Policy to understand how information is collected, used, and protected."] },
      ],
    },
    {
      title: "12. Third-Party Services",
      blocks: [
        {
          paragraphs: ["InternJobs.ai may rely on third-party providers for:"],
          bullets: ["messaging infrastructure", "authentication", "hosting", "analytics", "communication delivery", "LinkedIn integrations"],
        },
        { paragraphs: ["Your use of third-party platforms may also be governed by their own terms and policies.", "We are not responsible for third-party services or outages."] },
      ],
    },
    {
      title: "13. Service Availability",
      blocks: [
        {
          paragraphs: ["InternJobs.ai may:"],
          bullets: ["change features", "modify functionality", "pause services", "discontinue features", "update messaging channels"],
        },
        { paragraphs: ["We do not guarantee uninterrupted availability."] },
      ],
    },
    {
      title: "14. Disclaimer",
      blocks: [
        { paragraphs: ['InternJobs.ai is provided "as is" and "as available."'] },
        {
          paragraphs: ["To the fullest extent permitted by law, InternJobs.ai disclaims all warranties, including:"],
          bullets: ["merchantability", "fitness for a particular purpose", "non-infringement", "uninterrupted availability", "accuracy of recommendations or AI outputs"],
        },
        { paragraphs: ["Use of the Services is at your own risk."] },
      ],
    },
    {
      title: "15. Limitation of Liability",
      blocks: [
        {
          paragraphs: ["To the fullest extent permitted by law, InternJobs.ai and its affiliates shall not be liable for:"],
          bullets: ["indirect damages", "lost opportunities", "lost profits", "lost data", "hiring outcomes", "startup decisions", "internship decisions", "communication failures", "AI-generated errors"],
        },
        { paragraphs: ["Our total liability shall not exceed the amount paid to us, if any, during the previous 12 months."] },
      ],
    },
    {
      title: "16. Termination",
      blocks: [
        {
          paragraphs: ["We may suspend or terminate access to InternJobs.ai at any time for:"],
          bullets: ["violations of these Terms", "abusive behavior", "fraud", "misuse of the Services", "harmful activity"],
        },
        { paragraphs: ["Users may stop using the Services at any time."] },
      ],
    },
    {
      title: "17. Changes To These Terms",
      blocks: [
        { paragraphs: ["We may update these Terms from time to time."] },
        {
          paragraphs: ["If material changes are made, we may notify users through:"],
          bullets: ["the website", "messaging channels", "email", "product notifications"],
        },
        { paragraphs: ["Continued use of the Services means you accept the updated Terms."] },
      ],
    },
    {
      title: "18. Governing Law",
      blocks: [{ paragraphs: ["These Terms shall be governed by and interpreted under the laws of the State of Texas, without regard to conflict of law principles."] }],
    },
    {
      title: "19. Contact",
      blocks: [{ paragraphs: ["Questions about these Terms may be sent to:", "legal@internjobs.ai", "InternJobs.ai"] }],
    },
  ],
};

type PlatformName = "imessage" | "whatsapp" | "slack" | "discord" | "phone";

function PlatformLogo({ platform, className = "" }: { platform: PlatformName; className?: string }) {
  if (platform === "slack") {
    return <SlackBrandLogo className={className} />;
  }

  if (platform === "phone") {
    return <Phone className={className} strokeWidth={2.7} />;
  }

  const icon = platform === "imessage" ? siImessage : platform === "whatsapp" ? siWhatsapp : siDiscord;

  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label={icon.title} fill="currentColor">
      <path d={icon.path} />
    </svg>
  );
}

function SlackBrandLogo({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="Slack">
      <rect width="3.2" height="8.5" x="13.2" y="1.6" rx="1.6" fill="#36C5F0" />
      <path d="M19 8.8v1.5h1.5A1.55 1.55 0 1 0 19 8.8Z" fill="#36C5F0" />
      <rect width="8.5" height="3.2" x="13.9" y="13.2" rx="1.6" fill="#2EB67D" />
      <path d="M15.4 19H13.9v1.5A1.55 1.55 0 1 0 15.4 19Z" fill="#2EB67D" />
      <rect width="3.2" height="8.5" x="7.7" y="13.9" rx="1.6" fill="#ECB22E" />
      <path d="M5 15.4v-1.5H3.5A1.55 1.55 0 1 0 5 15.4Z" fill="#ECB22E" />
      <rect width="8.5" height="3.2" x="1.6" y="7.7" rx="1.6" fill="#E01E5A" />
      <path d="M8.6 5H10.1V3.5A1.55 1.55 0 1 0 8.6 5Z" fill="#E01E5A" />
    </svg>
  );
}

function App() {
  const currentPath = typeof window !== "undefined" ? window.location.pathname.replace(/\/$/, "") : "";
  const isStartupPage = currentPath === "/startups";
  const isPrivacyPage = currentPath === "/privacy";
  const isTermsPage = currentPath === "/terms";

  if (isStartupPage) {
    return <StartupPage />;
  }

  if (isPrivacyPage) {
    return <PrivacyPage />;
  }

  if (isTermsPage) {
    return <TermsPage />;
  }

  return (
    <main className="page-shell min-h-screen overflow-hidden bg-canvas text-ink">
      <Navbar />
      <HeroSection />
      <HowItWorksSection />
      <ChannelSection />
      <SignalsSection />
      <EmployerSection />
      <FAQSection />
      <WaitlistSection />
      <Footer />
      <FloatingMobileCTA />
    </main>
  );
}

function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeHref, setActiveHref] = useState("");

  useEffect(() => {
    const sectionIds = navLinks.filter((link) => link.href.startsWith("#")).map((link) => link.href.slice(1));

    const update = () => {
      setScrolled(window.scrollY > 8);

      let current = "";
      sectionIds.forEach((id) => {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= 116) {
          current = id;
        }
      });
      setActiveHref(current ? `#${current}` : "");
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b border-black/[0.06] backdrop-blur-2xl transition ${
        scrolled ? "bg-canvas/92 shadow-[0_12px_36px_rgba(0,0,0,0.06)]" : "bg-canvas/76"
      }`}
    >
      <nav className="relative flex h-16 w-full items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-2.5" aria-label="InternJobs.ai home" onClick={() => setOpen(false)}>
          <BrandMark size="sm" />
          <span className="text-base font-black text-ink">InternJobs.ai</span>
        </a>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-black/[0.06] bg-white/46 p-1 lg:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`rounded-full px-3.5 py-2 text-sm font-bold transition ${
                activeHref === link.href ? "bg-black/[0.06] text-ink" : "text-ink-secondary hover:bg-white/70 hover:text-ink"
              }`}
            >
              {link.label}
            </a>
          ))}
        </div>

        <a href="#waitlist" className="primary-party-button hidden rounded-full px-5 py-3 text-sm font-bold text-white lg:inline-flex">
          Join Early Access
          <ArrowRight className="ml-2 size-4" />
        </a>

        <button
          type="button"
          className="grid size-10 place-items-center rounded-lg border border-black/[0.08] bg-white/70 lg:hidden"
          aria-label="Toggle navigation"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-black/[0.06] bg-canvas lg:hidden"
          >
            <div className="space-y-1 px-5 py-4">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-lg px-3 py-3 text-sm font-bold ${
                    activeHref === link.href ? "bg-black/[0.06] text-ink" : "text-ink-secondary hover:bg-black/[0.04]"
                  }`}
                >
                  {link.label}
                </a>
              ))}
              <a
                href="#waitlist"
                onClick={() => setOpen(false)}
                className="primary-party-button mt-3 flex h-12 items-center justify-center rounded-full px-5 text-sm font-bold text-white"
              >
                Join Early Access
              </a>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const className = size === "lg" ? "size-14" : size === "sm" ? "size-8" : "size-10";

  return (
    <span className={`${className} brand-mark brand-mark-${size} grid shrink-0 place-items-center rounded-lg`}>
      <span className="brand-infinity" aria-hidden="true">
        ∞
      </span>
    </span>
  );
}

function HeroSection() {
  const { scrollYProgress } = useScroll();
  const phoneY = useTransform(scrollYProgress, [0, 0.2], [0, 18]);

  return (
    <section className="relative min-h-[100svh] overflow-hidden bg-canvas px-5 pb-8 pt-20 sm:px-6 sm:pt-24 lg:px-8">
      <div className="hero-spectrum" aria-hidden="true" />
      <div className="relative z-10 mx-auto grid min-h-[calc(100svh-5rem)] w-full max-w-[1600px] items-center gap-6 lg:grid-cols-[0.86fr_1.14fr] lg:gap-10">
        <Reveal className="max-w-[36rem]">
          <div className="mb-6 inline-flex items-center rounded-full border border-black/[0.08] bg-white/50 px-3 py-2 text-sm font-semibold text-ink-secondary">
            Text-first internship search
          </div>

          <h1 className="font-display text-[2.95rem] leading-[0.98] text-ink sm:text-[5.5rem] lg:text-[6rem]">
            Internships <span className="text-party-gradient">over text.</span>
          </h1>

          <p className="mt-4 max-w-[28rem] text-lg leading-8 text-ink-secondary sm:mt-6">
            InternJobs.ai keeps looking for startup internships while you're busy with class, work, or literally anything else.
          </p>

          <div className="mt-6 grid gap-3 sm:mt-8 sm:flex sm:flex-row">
            <a href="#waitlist" className="primary-party-button inline-flex h-12 items-center justify-center rounded-full px-4 text-sm font-bold text-white sm:h-14 sm:px-7 sm:text-base">
              <span>Join Early Access</span>
              <ArrowRight className="ml-2 size-4" />
            </a>
            <a href="#channels" className="inline-flex h-12 items-center justify-center rounded-full border border-black/[0.08] bg-white/55 px-4 text-sm font-bold text-ink transition hover:bg-white sm:h-14 sm:px-7 sm:text-base">
              See the texts
            </a>
          </div>

          <div className="mt-5 grid gap-2 text-sm text-ink-secondary sm:mt-7 sm:gap-3">
            <div className="flex items-center gap-2">
              <Linkedin className="size-4" />
              <span>Start with LinkedIn. Then just text.</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              <span>You approve anything before it sends.</span>
            </div>
          </div>
        </Reveal>

        <motion.div style={{ y: phoneY }} className="relative mx-auto w-full max-w-[22rem] sm:max-w-[25rem] lg:max-w-[27rem]">
          <PhoneExperience messages={heroMessages} channel={channels[0]} mode="hero" />
        </motion.div>
      </div>
    </section>
  );
}

function PhoneExperience({
  messages,
  channel,
  mode = "standard",
}: {
  messages: ChatMessage[];
  channel: Channel;
  mode?: "hero" | "standard";
}) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    const runCycle = () => {
      setVisibleCount(0);
      setPulse((value) => value + 1);

      messages.forEach((_, index) => {
        timers.push(
          window.setTimeout(() => {
            if (!cancelled) setVisibleCount(index + 1);
          }, messageAnimation.firstBubbleDelay + index * messageAnimation.nextBubbleDelay),
        );
      });

      timers.push(
        window.setTimeout(() => {
          if (!cancelled) runCycle();
        }, messageAnimation.firstBubbleDelay + messages.length * messageAnimation.nextBubbleDelay + messageAnimation.cyclePause),
      );
    };

    runCycle();

    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
    };
  }, [messages, channel.name]);

  const visibleMessages = messages.slice(0, visibleCount);

  return (
    <div className={`phone-float ${mode === "hero" ? "hero-phone" : ""}`}>
      <div className="iphone-shell mx-auto">
        <div className="iphone-screen">
          <div className="ios-statusbar">
            <span className="text-[12px] font-bold text-ink">9:41</span>
            <div className="ios-island" />
            <div className="flex items-center gap-1.5 text-ink">
              <Signal className="size-3.5" />
              <Wifi className="size-3.5" />
              <BatteryFull className="size-4" />
            </div>
          </div>

          {mode === "hero" || channel.name === "iMessage" ? (
            <IMessageSurface channel={channel} visibleMessages={visibleMessages} visibleCount={visibleCount} totalMessages={messages.length} pulse={pulse} />
          ) : (
            <ChannelSurface channel={channel} visibleMessages={visibleMessages} visibleCount={visibleCount} totalMessages={messages.length} pulse={pulse} />
          )}
        </div>
      </div>
    </div>
  );
}

function IMessageSurface({
  channel,
  visibleMessages,
  visibleCount,
  totalMessages,
  pulse,
}: {
  channel: Channel;
  visibleMessages: ChatMessage[];
  visibleCount: number;
  totalMessages: number;
  pulse: number;
}) {
  return (
    <>
      <div className="messages-header">
        <div className="grid size-10 place-items-center rounded-full text-white" style={{ background: channel.color }}>
          <InfinityIcon className="size-5" strokeWidth={2.4} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">InternJobs.ai</p>
          <p className="text-[11px] font-medium text-ink-secondary">{channel.label}</p>
        </div>
        <motion.div
          key={pulse}
          initial={{ scale: 0.72, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold text-white"
          style={{ background: channel.color }}
        >
          <PlatformLogo platform="imessage" className="size-3" />
          live
        </motion.div>
      </div>

      <div className="messages-body">
        <div className="flex min-h-[28rem] flex-col justify-end gap-1 px-3 py-4">
          <AnimatePresence>
            {visibleMessages.map((message, index) => (
              <MessageBubble key={`${channel.name}-${message.text}-${index}`} message={message} index={index} />
            ))}
          </AnimatePresence>
          {visibleCount < totalMessages ? <TypingIndicator color={channel.color} /> : <AgentSearchingIndicator />}
        </div>
      </div>

      <div className="bg-[#FDFBF6] px-3 pb-5 pt-3">
        <div className="flex items-center gap-2 rounded-full border border-black/[0.08] bg-[#F2F2F7] px-3 py-2.5">
          <span className="grid size-5 place-items-center rounded-full border border-[#9B9BA2] text-sm leading-none text-[#8E8E93]">+</span>
          <span className="flex-1 text-sm text-[#8E8E93]">{channel.label}</span>
          <span className="grid size-7 place-items-center rounded-full text-white" style={{ background: channel.color }}>
            <Send className="size-3.5" />
          </span>
        </div>
      </div>
    </>
  );
}

function ChannelSurface({
  channel,
  visibleMessages,
  visibleCount,
  totalMessages,
  pulse,
}: {
  channel: Channel;
  visibleMessages: ChatMessage[];
  visibleCount: number;
  totalMessages: number;
  pulse: number;
}) {
  if (channel.name === "WhatsApp") {
    return <WhatsAppSurface channel={channel} visibleMessages={visibleMessages} visibleCount={visibleCount} totalMessages={totalMessages} pulse={pulse} />;
  }

  if (channel.name === "Slack") {
    return <SlackSurface channel={channel} visibleMessages={visibleMessages} visibleCount={visibleCount} totalMessages={totalMessages} />;
  }

  if (channel.name === "Discord") {
    return <DiscordSurface channel={channel} visibleMessages={visibleMessages} visibleCount={visibleCount} totalMessages={totalMessages} />;
  }

  return <PhoneCallSurface channel={channel} visibleMessages={visibleMessages} visibleCount={visibleCount} totalMessages={totalMessages} />;
}

function WhatsAppSurface({
  channel,
  visibleMessages,
  visibleCount,
  totalMessages,
  pulse,
}: {
  channel: Channel;
  visibleMessages: ChatMessage[];
  visibleCount: number;
  totalMessages: number;
  pulse: number;
}) {
  return (
    <div className="whatsapp-surface">
      <div className="whatsapp-header">
        <div className="grid size-9 place-items-center rounded-full bg-white/18 text-white">
          <PlatformLogo platform="whatsapp" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">InternJobs.ai</p>
          <p className="text-[11px] text-white/78">online</p>
        </div>
        <motion.span key={pulse} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} className="rounded-full bg-white/18 px-2 py-1 text-[10px] font-bold text-white">
          WA
        </motion.span>
      </div>
      <div className="whatsapp-body">
        <div className="flex min-h-[29rem] flex-col justify-end gap-1.5 px-3 py-4">
          <AnimatePresence>
            {visibleMessages.map((message, index) => (
              <WhatsAppBubble key={`${message.text}-${index}`} message={message} index={index} />
            ))}
          </AnimatePresence>
          {visibleCount < totalMessages ? <TypingIndicator color={channel.color} /> : null}
        </div>
      </div>
      <div className="whatsapp-compose">
        <span className="rounded-full bg-white px-4 py-2.5 text-sm text-[#8696A0]">Message</span>
        <span className="grid size-10 place-items-center rounded-full bg-[#00A884] text-white">
          <Send className="size-4" />
        </span>
      </div>
    </div>
  );
}

function WhatsAppBubble({ message, index }: { message: ChatMessage; index: number }) {
  const isAgent = message.author === "agent";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.24, delay: Math.min(index * 0.04, 0.15) }}
      className={`flex ${isAgent ? "justify-start" : "justify-end"}`}
    >
      <div className={`whatsapp-bubble ${isAgent ? "bg-white" : "bg-[#D9FDD3]"} max-w-[78%] rounded-lg px-3 py-2 text-[13px] leading-5 text-[#111B21] shadow-sm`}>
        {message.text}
        <span className="ml-2 text-[10px] text-[#667781]">9:41</span>
      </div>
    </motion.div>
  );
}

function SlackSurface({
  channel,
  visibleMessages,
  visibleCount,
  totalMessages,
}: {
  channel: Channel;
  visibleMessages: ChatMessage[];
  visibleCount: number;
  totalMessages: number;
}) {
  return (
    <div className="slack-surface">
      <div className="slack-topbar">
        <div className="grid size-8 place-items-center rounded-md bg-white/15">
          <PlatformLogo platform="slack" className="size-5" />
        </div>
        <div>
          <p className="text-sm font-black text-white">InternJobs.ai</p>
          <p className="text-[11px] text-white/70"># tiny-wins</p>
        </div>
      </div>
      <div className="slack-layout">
        <div className="slack-sidebar">
          <span className="is-active"># finds</span>
          <span># replies</span>
          <span># prep</span>
        </div>
        <div className="slack-thread">
          <div className="border-b border-black/[0.08] px-3 py-2">
            <p className="text-sm font-black text-[#1D1C1D]"># tiny-wins</p>
            <p className="text-[11px] text-[#616061]">Roles, drafts, and "should I reply?" moments live here.</p>
          </div>
          <div className="flex min-h-[24.25rem] flex-col justify-end px-3 py-3">
            <AnimatePresence>
              {visibleMessages.map((message, index) => (
                <SlackMessage key={`${message.text}-${index}`} message={message} index={index} />
              ))}
            </AnimatePresence>
            {visibleCount < totalMessages ? <div className="px-2 py-2 text-xs text-[#616061]">InternJobs.ai is typing...</div> : null}
          </div>
        </div>
      </div>
      <div className="slack-compose">Message #tiny-wins</div>
    </div>
  );
}

function SlackMessage({ message, index }: { message: ChatMessage; index: number }) {
  const isAgent = message.author === "agent";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.14) }}
      className="flex gap-2 rounded-md px-2 py-2 hover:bg-black/[0.03]"
    >
      <div className={`grid size-8 shrink-0 place-items-center rounded-md text-white ${isAgent ? "bg-[#1264A3]" : "bg-[#2EB67D]"}`}>
        {isAgent ? <InfinityIcon className="size-4" /> : <UserRound className="size-4" />}
      </div>
      <div className="min-w-0">
        <p className="text-[12px] font-black text-[#1D1C1D]">
          {isAgent ? "InternJobs.ai" : "You"} <span className="font-medium text-[#616061]">9:41 AM</span>
        </p>
        <p className="text-[13px] leading-5 text-[#1D1C1D]">{message.text}</p>
      </div>
    </motion.div>
  );
}

function DiscordSurface({
  channel,
  visibleMessages,
  visibleCount,
  totalMessages,
}: {
  channel: Channel;
  visibleMessages: ChatMessage[];
  visibleCount: number;
  totalMessages: number;
}) {
  return (
    <div className="discord-surface">
      <div className="discord-header">
        <PlatformLogo platform="discord" className="size-5 text-[#5865F2]" />
        <span className="text-[#8E95FF]">#</span>
        <strong>internjobs-helper</strong>
        <span className="ml-auto rounded-full bg-[#23A559]/18 px-2 py-1 text-[10px] font-bold text-[#23A559]">online</span>
      </div>
      <div className="discord-body">
        <div className="flex min-h-[29rem] flex-col justify-end px-3 py-4">
          <AnimatePresence>
            {visibleMessages.map((message, index) => (
              <DiscordMessage key={`${message.text}-${index}`} message={message} index={index} />
            ))}
          </AnimatePresence>
          {visibleCount < totalMessages ? <div className="px-2 py-2 text-xs text-[#B5BAC1]">InternJobs.ai is typing...</div> : null}
        </div>
      </div>
      <div className="discord-compose">Message #internjobs-helper</div>
    </div>
  );
}

function DiscordMessage({ message, index }: { message: ChatMessage; index: number }) {
  const isAgent = message.author === "agent";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.14) }}
      className="flex gap-3 rounded-md px-2 py-2"
    >
      <div className={`grid size-9 shrink-0 place-items-center rounded-full text-white ${isAgent ? "bg-[#5865F2]" : "bg-[#23A559]"}`}>
        {isAgent ? <InfinityIcon className="size-5" /> : <UserRound className="size-4" />}
      </div>
      <div>
        <p className={`text-[12px] font-black ${isAgent ? "text-[#8E95FF]" : "text-[#23A559]"}`}>
          {isAgent ? "InternJobs.ai" : "student"} <span className="font-medium text-[#949BA4]">Today at 9:41 AM</span>
        </p>
        <p className="text-[13px] leading-5 text-[#DBDEE1]">{message.text}</p>
      </div>
    </motion.div>
  );
}

function PhoneCallSurface({
  channel,
  visibleMessages,
  visibleCount,
  totalMessages,
}: {
  channel: Channel;
  visibleMessages: ChatMessage[];
  visibleCount: number;
  totalMessages: number;
}) {
  const latest = visibleMessages[visibleMessages.length - 1];

  return (
    <div className="phonecall-surface">
      <div className="phonecall-hero">
        <div className="mx-auto grid size-20 place-items-center rounded-full bg-white/16 text-white">
          <InfinityIcon className="size-10" />
        </div>
        <p className="mt-4 text-sm text-white/70">InternJobs.ai</p>
        <h3 className="mt-1 text-2xl font-black text-white">Tiny prep sheet</h3>
        <p className="mt-2 text-sm leading-5 text-white/65">Quick call tomorrow at 3:00 PM</p>
        <div className="mt-7 flex justify-center gap-5">
          <div className="grid size-14 place-items-center rounded-full bg-white/14 text-white">
            <MessageCircle className="size-6" />
          </div>
          <div className="grid size-14 place-items-center rounded-full bg-[#34C759] text-white">
            <Phone className="size-6" />
          </div>
        </div>
      </div>
      <div className="phonecall-notes">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-[#8E8E93]">Live notes</p>
        <div className="mt-3 space-y-2">
          <AnimatePresence>
            {visibleMessages.map((message, index) => (
              <motion.div
                key={`${message.text}-${index}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, delay: Math.min(index * 0.05, 0.18) }}
                className="rounded-xl bg-[#F2F2F7] px-3 py-2 text-[13px] leading-5 text-[#1C1C1E]"
              >
                {message.text}
              </motion.div>
            ))}
          </AnimatePresence>
          {visibleCount < totalMessages ? <div className="rounded-xl bg-[#F2F2F7] px-3 py-2 text-xs text-[#8E8E93]">Preparing next note...</div> : null}
        </div>
        {latest ? <p className="mt-3 text-xs font-semibold text-[#111]">Latest: {latest.author === "agent" ? "prep note" : "your reply"}</p> : null}
      </div>
      <div className="phonecall-tabbar">
        <span>Recents</span>
        <strong>InternJobs.ai</strong>
        <span>Voicemail</span>
      </div>
    </div>
  );
}

function MessageBubble({ message, index }: { message: ChatMessage; index: number }) {
  const isAgent = message.author === "agent";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 520, damping: 32, delay: Math.min(index * 0.03, 0.15) }}
      className={`grid ${isAgent ? "justify-items-start" : "justify-items-end"}`}
    >
      <div
        className={`ios-bubble max-w-[78%] rounded-[1.15rem] px-3.5 py-2 text-[13px] leading-5 ${
          isAgent ? "rounded-bl-md bg-[#E9E9EB] text-ink" : "rounded-br-md bg-[#007AFF] text-white"
        }`}
      >
        {message.text}
      </div>
      {message.meta ? <div className="mt-1 px-2 text-[10px] font-semibold uppercase text-[#8E8E93]">{message.meta}</div> : null}
    </motion.div>
  );
}

function TypingIndicator({ color }: { color: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
      <div className="typing-bubble flex items-center gap-1 rounded-[1.15rem] bg-[#E9E9EB] px-3.5 py-3">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            animate={{ y: [0, -7, 0] }}
            transition={{ duration: 0.82, repeat: Number.POSITIVE_INFINITY, delay: index * 0.14, ease: "easeInOut" }}
            className="size-1.5 rounded-full"
            style={{ background: index === 1 ? color : "#AEAEB2" }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function AgentSearchingIndicator() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
      <div className="rounded-[1.15rem] rounded-bl-md bg-[#E9E9EB] px-3.5 py-2 text-[12px] font-medium text-[#555]">
        Still looking for better fits
      </div>
    </motion.div>
  );
}

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="dark-band px-5 py-24 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionIntro eyebrow="How it works" title="Give it the basics. Then just text." light />
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map(([title, copy], index) => (
            <Reveal key={title} delay={index * 0.08}>
              <div className="h-full rounded-lg border border-white/10 bg-white/[0.055] p-6">
                <div className="grid size-11 place-items-center rounded-lg bg-white/[0.07] text-white">
                  {index === 0 ? <Linkedin className="size-5" /> : index === 1 ? <MessageCircle className="size-5" /> : <Search className="size-5" />}
                </div>
                <p className="mt-8 text-xs font-bold uppercase text-white/40">Step {index + 1}</p>
                <h3 className="mt-3 text-xl font-bold">{title}</h3>
                <p className="mt-3 leading-7 text-white/55">{copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ChannelSection() {
  const [active, setActive] = useState(0);
  const channel = channels[active];

  useEffect(() => {
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % channels.length), 6200);
    return () => window.clearTimeout(timer);
  }, [active]);

  return (
    <section id="channels" className="relative overflow-hidden bg-canvas px-5 py-24 sm:px-6 lg:px-8">
      <div className="channel-spectrum" aria-hidden="true" />
      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <Reveal>
            <h2 className="max-w-[42rem] text-[2.55rem] font-black leading-[1.05] text-[#070707] sm:text-[4.75rem]">
              Built for where <span className="text-party-gradient">students already talk.</span>
            </h2>
            <p className="mt-5 max-w-xl text-xl leading-8 text-[#5F6368]">
              InternJobs.ai works in iMessage, WhatsApp, Slack, Discord, and phone. No separate tab to keep checking.
            </p>
          </Reveal>

          <div className="mt-9 flex flex-wrap gap-3">
            {channels.map((item, index) => (
              <button
                key={item.name}
                type="button"
                onClick={() => setActive(index)}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onFocus={() => {
                  setActive(index);
                }}
                className={`channel-chip ${active === index ? "is-active" : ""}`}
                style={{
                  borderColor: item.color,
                  color: active === index ? "white" : item.color,
                  background: active === index ? item.color : "rgba(255, 255, 255, 0.78)",
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            <HumanAgentCard icon={<UserRound className="size-5" />} title="You" copy="Tell it what you're into and what you've built. Approve anything before it goes out." />
            <HumanAgentCard icon={<InfinityIcon className="size-5" />} title="InternJobs.ai" copy="Finds roles, explains why they fit, handles the back-and-forth, and helps set up the interview." />
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[25rem]">
          <AnimatePresence mode="wait">
            <motion.div
              key={channel.name}
              initial={{ opacity: 0, x: 26, rotate: 1.5 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              exit={{ opacity: 0, x: -26, rotate: -1.5 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <PhoneExperience messages={channel.messages} channel={channel} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function HumanAgentCard({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return (
    <Reveal className="h-full">
      <div className="human-agent-card flex h-full min-h-[11.75rem] flex-col rounded-lg border border-black/[0.08] bg-white/70 p-5">
        <div className="flex items-center gap-3">
          <div className="portrait-frame grid size-12 place-items-center rounded-lg text-white">{icon}</div>
          <div className="min-w-0">
            <h3 className="text-base font-black text-[#070707]">{title}</h3>
            <p className="text-sm text-[#5F6368]">{title === "You" ? "Still in control" : "Keeps looking"}</p>
          </div>
        </div>
        <p className="mt-4 flex-1 text-sm leading-6 text-[#5F6368]">{copy}</p>
      </div>
    </Reveal>
  );
}

function SignalsSection() {
  return (
    <section id="signals" className="bg-canvas px-5 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionIntro
          eyebrow="Less exhausting"
          title="It keeps looking in the background."
          copy="Find startup internships before everyone else does. When something worth checking out pops up, you get the text."
        />

        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <Reveal>
            <div className="signal-map">
              <div className="source-stack">
                {["LinkedIn", "Group chats", "Startup pages"].map((source, index) => (
                  <div key={source} className="source-node" style={{ animationDelay: `${index * 0.35}s` }}>
                    <span>{source === "LinkedIn" ? "in" : source === "Group chats" ? "gc" : "sp"}</span>
                    {source}
                  </div>
                ))}
              </div>
              <div className="signal-lines" aria-hidden="true">
                {[0, 1, 2].map((index) => (
                  <span key={index} />
                ))}
              </div>
              <div className="agent-node">
                <BrandMark />
                <div>
                  <strong>InternJobs.ai</strong>
                  <p>texts you first</p>
                </div>
              </div>
            </div>
          </Reveal>

          <div className="grid gap-3 sm:grid-cols-2">
            {signals.map(([title, copy, tag], index) => (
              <Reveal key={title} delay={index * 0.06} className="h-full">
                <div className="flex h-full min-h-[11.25rem] flex-col rounded-lg border border-black/[0.08] bg-white/55 p-5 shadow-soft">
                  <span className="inline-flex rounded-full bg-black/[0.045] px-3 py-1 text-xs font-black text-ink">{tag}</span>
                  <h3 className="mt-5 text-lg font-bold text-ink">{title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-ink-secondary">{copy}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function EmployerSection() {
  return (
    <section id="startups" className="employer-band relative overflow-hidden px-5 py-24 sm:px-6 lg:px-8">
      <div className="employer-glow" aria-hidden="true" />
      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="min-w-0">
          <SectionIntro
            eyebrow="For startups"
            title="Find students who already move like builders."
            copy="Share the role in plain English. InternJobs.ai helps the right students understand why it fits and reply with context."
          />

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {employerCards.map(([title, copy], index) => (
              <Reveal key={title} delay={index * 0.06} className="min-w-0">
                <div className="min-w-0 rounded-lg border border-black/[0.08] bg-white/62 p-5 shadow-soft backdrop-blur">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-black text-sm font-black text-white">0{index + 1}</span>
                    <div className="min-w-0">
                      <h3 className="text-base font-black text-ink">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <Reveal className="min-w-0">
          <div className="employer-preview rounded-lg border border-black/[0.08] bg-white/72 p-5 shadow-soft backdrop-blur-xl sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-ink-secondary">Startup role</p>
                <h3 className="mt-3 text-3xl font-black leading-tight text-ink">Growth intern for an AI tools team</h3>
              </div>
              <span className="inline-flex w-fit rounded-full bg-black px-3 py-1 text-xs font-black text-white">paid</span>
            </div>

            <div className="mt-6 grid gap-2 sm:grid-cols-3">
              {["Remote", "10-15 hrs", "Founder-led"].map((tag) => (
                <span key={tag} className="rounded-lg bg-black/[0.045] px-3 py-3 text-sm font-black text-ink">
                  {tag}
                </span>
              ))}
            </div>

            <div className="mt-6 rounded-lg bg-[#111] p-4 text-white">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">InternJobs.ai note</p>
              <p className="mt-3 text-lg font-black leading-7">This is best for students who have built projects, grown communities, or shipped content before.</p>
            </div>

            <div className="mt-4 rounded-lg border border-black/[0.08] bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-black text-ink">Students who may fit</p>
                <span className="text-xs font-bold text-ink-secondary">3 ready to text</span>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  ["AI newsletter + campus ambassador", "Strong context"],
                  ["Built a waitlist for a student app", "Worth a look"],
                  ["Runs a Discord for builders", "Relevant"],
                ].map(([student, tag]) => (
                  <div key={student} className="flex items-center gap-3 rounded-lg bg-[#F6F4EE] p-3">
                    <BrandMark size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-ink">{student}</p>
                      <p className="text-xs font-semibold text-ink-secondary">Can reply over text first</p>
                    </div>
                    <span className="hidden rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-ink-secondary sm:inline-flex">{tag}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FAQSection() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="bg-canvas px-5 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.7fr_1.3fr]">
        <SectionIntro eyebrow="FAQ" title="A few things to know." copy="Short answers before you join early access." />
        <div className="divide-y divide-black/[0.08] border-y border-black/[0.08]">
          {faqs.map(([question, answer], index) => (
            <div key={question}>
              <button
                type="button"
                onClick={() => setOpen(open === index ? -1 : index)}
                className="flex w-full items-center justify-between gap-6 py-6 text-left"
              >
                <span className="font-display text-2xl leading-8 text-ink">{question}</span>
                <ChevronDown className={`size-5 shrink-0 text-ink-secondary transition ${open === index ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence initial={false}>
                {open === index ? (
                  <motion.p
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden pb-6 leading-7 text-ink-secondary"
                  >
                    {answer}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WaitlistSection() {
  return (
    <section id="waitlist" className="waitlist-band relative overflow-hidden px-5 py-24 sm:px-6 lg:px-8">
      <div className="cta-spectrum" aria-hidden="true" />
      <div className="cta-card relative z-10 mx-auto grid max-w-7xl items-center gap-8 rounded-none p-0 shadow-none sm:p-0 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="relative z-10 text-left">
          <BrandMark size="lg" />
          <p className="mt-7 text-sm font-black uppercase tracking-[0.18em] text-white/60">InternJobs.ai</p>
          <h2 className="mt-4 font-display text-5xl leading-none text-white sm:text-7xl">Join Early Access</h2>
          <p className="mt-5 max-w-md leading-7 text-white/75">
            Get the first text when we open up. Built for students who would rather text than fill out another giant form.
          </p>
          <a href="mailto:hello@internjobs.ai?subject=Join%20InternJobs.ai%20Early%20Access" className="secondary-party-button mt-8 inline-flex h-[3.35rem] items-center justify-center rounded-full px-7 font-black text-[#111]">
            Join Early Access
            <ArrowRight className="ml-2 size-4" />
          </a>
        </div>
        <div className="relative z-10">
          <img
            src="/images/student-agent-handshake.png"
            alt="A student shaking hands with a glowing InternJobs.ai helper"
            className="cta-illustration w-full"
          />
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-black/[0.08] bg-canvas px-5 py-12 sm:px-6 lg:px-8">
      <div className="footer-word" aria-hidden="true">InternJobs.ai</div>
      <div className="relative mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="font-bold text-ink">InternJobs.ai</span>
          </div>
          <p className="mt-4 max-w-md text-sm leading-6 text-ink-secondary">Way less exhausting than doing it alone.</p>
        </div>
        <div className="flex flex-wrap gap-5 text-sm font-medium text-ink-secondary">
          {studentFooterLinks.map((link) => (
            <a key={`${link.label}-${link.href}`} href={link.href} className="hover:text-ink">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

function StartupPage() {
  return (
    <main className="page-shell startup-page min-h-screen overflow-hidden bg-canvas text-ink">
      <StartupNavbar />
      <StartupHeroSection />
      <ResumePileSection />
      <StartupContextSection />
      <StartupSignalsSection />
      <StartupHiringSection />
      <HumanInternshipsSection />
      <StartupHowItWorksSection />
      <StartupRoleMockupSection />
      <StartupAccessSection />
      <StartupFAQSection />
      <StartupFooter />
    </main>
  );
}

function StartupNavbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-black/[0.06] bg-canvas/88 backdrop-blur-2xl">
      <nav className="relative flex h-16 w-full items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-2.5" aria-label="InternJobs.ai home">
          <BrandMark size="sm" />
          <span className="text-base font-black text-ink">InternJobs.ai</span>
        </a>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-black/[0.08] bg-white/58 p-1 md:flex">
          <a href="/" className="rounded-full px-4 py-2 text-sm font-black text-ink-secondary transition hover:bg-white hover:text-ink">
            Students
          </a>
          <a href="/startups" className="rounded-full bg-black px-4 py-2 text-sm font-black text-white">
            Startups
          </a>
        </div>

        <div className="hidden items-center gap-6 lg:flex">
          {startupNavLinks.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-bold text-ink-secondary transition hover:text-ink">
              {link.label}
            </a>
          ))}
          <a href="#startup-access" className="primary-party-button inline-flex rounded-full px-5 py-3 text-sm font-bold text-white">
            Join Startup Access
            <ArrowRight className="ml-2 size-4" />
          </a>
        </div>

        <button
          type="button"
          className="grid size-10 place-items-center rounded-lg border border-black/[0.08] bg-white/70 lg:hidden"
          aria-label="Toggle startup navigation"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      <AnimatePresence>
        {open ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="border-t border-black/[0.06] bg-canvas lg:hidden">
            <div className="space-y-2 px-5 py-4">
              <div className="grid grid-cols-2 rounded-full border border-black/[0.08] bg-white/58 p-1 md:hidden">
                <a href="/" className="rounded-full px-4 py-2 text-center text-sm font-black text-ink-secondary">
                  Students
                </a>
                <a href="/startups" className="rounded-full bg-black px-4 py-2 text-center text-sm font-black text-white">
                  Startups
                </a>
              </div>
              {startupNavLinks.map((link) => (
                <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-sm font-bold text-ink-secondary hover:bg-black/[0.04]">
                  {link.label}
                </a>
              ))}
              <a href="#startup-access" onClick={() => setOpen(false)} className="primary-party-button mt-3 flex h-12 items-center justify-center rounded-full px-5 text-sm font-bold text-white">
                Join Startup Access
              </a>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

function StartupHeroSection() {
  return (
    <section className="startup-hero relative min-h-[100svh] overflow-hidden px-5 pb-16 pt-24 sm:px-6 lg:px-8">
      <div className="startup-hero-glow" aria-hidden="true" />
      <div className="relative z-10 mx-auto grid min-h-[calc(100svh-6rem)] max-w-7xl items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <Reveal className="max-w-[42rem]">
          <div className="mb-6 inline-flex rounded-full border border-black/[0.08] bg-white/55 px-3 py-2 text-sm font-bold text-ink-secondary">For startups</div>
          <h1 className="font-display text-[3.3rem] leading-[0.98] text-ink sm:text-[5.4rem] lg:text-[6.4rem]">
            Find students who already move like builders.
          </h1>
          <p className="mt-6 max-w-[37rem] text-lg leading-8 text-ink-secondary">
            InternJobs.ai helps startups discover ambitious students through projects, communities, startup interest, and conversational matching, not just resumes.
          </p>
          <div className="mt-8 grid gap-3 sm:flex">
            <a href="#startup-access" className="primary-party-button inline-flex h-12 items-center justify-center rounded-full px-5 text-sm font-black text-white sm:h-14 sm:px-7 sm:text-base">
              Join Startup Access
              <ArrowRight className="ml-2 size-4" />
            </a>
            <a href="#startup-how" className="inline-flex h-12 items-center justify-center rounded-full border border-black/[0.08] bg-white/60 px-5 text-sm font-black text-ink transition hover:bg-white sm:h-14 sm:px-7 sm:text-base">
              See how it works
            </a>
          </div>
          <p className="mt-5 text-sm font-semibold text-ink-secondary">Students approve every intro before conversations begin.</p>
        </Reveal>

        <Reveal delay={0.12}>
          <StartupChatMockup />
        </Reveal>
      </div>
    </section>
  );
}

function StartupChatMockup() {
  return (
    <div className="startup-chat-wrap relative mx-auto max-w-[35rem]">
      {startupFloatingCards.map((card, index) => (
        <motion.div
          key={card}
          className={`startup-floating-card startup-floating-card-${index}`}
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.25 + index * 0.08, duration: 0.35, ease: "easeOut" }}
        >
          {card}
        </motion.div>
      ))}
      <div className="startup-chat-shell">
        <div className="flex items-center justify-between border-b border-black/[0.08] px-5 py-4">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
            <div>
              <p className="text-sm font-black text-ink">InternJobs.ai</p>
              <p className="text-xs font-semibold text-ink-secondary">startup concierge</p>
            </div>
          </div>
          <span className="rounded-full bg-black px-3 py-1 text-xs font-black text-white">live</span>
        </div>
        <div className="space-y-4 p-5">
          <StartupBubble author="Founder">Need someone scrappy for growth + community.</StartupBubble>
          <StartupBubble author="InternJobs.ai" agent>
            <span>Found 3 students that fit:</span>
            <span>- AI newsletter experience</span>
            <span>- startup club leadership</span>
            <span>- creator-style growth projects</span>
          </StartupBubble>
          <StartupBubble author="Founder">This one feels interesting.</StartupBubble>
          <StartupBubble author="InternJobs.ai" agent>
            <span>Warm intro drafted.</span>
            <span>Waiting for student approval.</span>
          </StartupBubble>
          <StartupBubble author="Founder">Can they reply over text first?</StartupBubble>
          <StartupBubble author="InternJobs.ai" agent>
            Yep. They can ask questions, reply naturally, and prep before the call.
          </StartupBubble>
        </div>
      </div>
    </div>
  );
}

function StartupBubble({ author, agent = false, children }: { author: string; agent?: boolean; children: ReactNode }) {
  return (
    <div className={`startup-bubble ${agent ? "is-agent" : ""}`}>
      <p className="mb-1 text-[11px] font-black uppercase tracking-[0.12em]">{author}</p>
      <div className="grid gap-1 text-sm leading-6">{children}</div>
    </div>
  );
}

function ResumePileSection() {
  return (
    <section className="dark-band px-5 py-24 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.75fr_1.25fr]">
        <StartupSectionIntro eyebrow="Anti-resume-pile" title="Not another resume pile." copy="Most internship platforms create cold starts. InternJobs.ai keeps the first conversation warmer, more natural, and higher-context." light />
        <div className="grid gap-4 md:grid-cols-2">
          <ComparisonCard title="Most platforms create" items={resumeProblems} muted />
          <ComparisonCard title="InternJobs.ai focuses on" items={resumeFocuses} />
        </div>
      </div>
    </section>
  );
}

function ComparisonCard({ title, items, muted = false }: { title: string; items: string[]; muted?: boolean }) {
  return (
    <Reveal className="h-full">
      <div className={`h-full rounded-lg border p-6 ${muted ? "border-white/10 bg-white/[0.045]" : "border-white/16 bg-white/[0.09]"}`}>
        <h3 className="text-xl font-black text-white">{title}</h3>
        <ul className="mt-6 space-y-3">
          {items.map((item) => (
            <li key={item} className="flex gap-3 text-sm leading-6 text-white/68">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-white/70" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function StartupContextSection() {
  return (
    <section className="bg-canvas px-5 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <StartupSectionIntro eyebrow="Context first" title="See the context before the conversation." copy="A resume can miss the reason a student is worth talking to. InternJobs.ai gives founders the details that make a first reply easier." />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {startupContextCards.map(([title, copy], index) => (
            <Reveal key={title} delay={index * 0.06} className="h-full">
              <div className="h-full rounded-lg border border-black/[0.08] bg-white/60 p-5 shadow-soft">
                <h3 className="text-lg font-black text-ink">{title}</h3>
                <p className="mt-4 text-sm leading-6 text-ink-secondary">{copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function StartupSignalsSection() {
  return (
    <section id="startup-signals" className="startup-signal-band relative overflow-hidden px-5 py-24 sm:px-6 lg:px-8">
      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <StartupSectionIntro
          eyebrow="Earlier signal"
          title="Find students before everyone else does."
          copy="Some of the best startup interns are not applying everywhere. They are hanging out in communities, building things already, and getting discovered through networks. InternJobs.ai helps startups reach them earlier."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {startupSignals.map((signal, index) => (
            <Reveal key={signal} delay={index * 0.05}>
              <div className="flex items-center gap-3 rounded-lg border border-black/[0.08] bg-white/68 p-4 shadow-soft">
                <span className="grid size-10 place-items-center rounded-lg bg-black text-xs font-black text-white">{index + 1}</span>
                <span className="font-black text-ink">{signal}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function StartupHiringSection() {
  return (
    <section className="bg-canvas px-5 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <StartupSectionIntro eyebrow="Founder-led hiring" title="Built for how startups actually hire." copy="Less filtering. More real conversations." />
        <div className="grid gap-4 lg:grid-cols-2">
          <Reveal className="h-full">
            <div className="h-full rounded-lg border border-black/[0.08] bg-white/62 p-6 shadow-soft">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-ink-secondary">Left side</p>
              <h3 className="mt-4 text-3xl font-black leading-tight text-ink">Post a role in plain English.</h3>
              <p className="mt-5 leading-7 text-ink-secondary">Say what the intern will build, learn, and help with. No rigid job template needed.</p>
            </div>
          </Reveal>
          <Reveal className="h-full" delay={0.08}>
            <div className="h-full rounded-lg border border-black/[0.08] bg-[#111] p-6 text-white shadow-soft">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">InternJobs.ai explains</p>
              <ul className="mt-5 space-y-3">
                {["why the role fits", "why the student fits", "what stands out", "how to reply"].map((item) => (
                  <li key={item} className="flex gap-3 text-sm font-bold text-white/74">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function HumanInternshipsSection() {
  return (
    <section className="dark-band px-5 py-24 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.75fr_1.25fr]">
        <StartupSectionIntro eyebrow="More human" title="Internships should feel more human." copy="The first interaction should not feel like a spreadsheet or a cold outbound campaign." light />
        <div className="grid gap-4 md:grid-cols-2">
          <ComparisonCard title="No more" items={humanNoList} muted />
          <ComparisonCard title="Instead" items={humanYesList} />
        </div>
      </div>
    </section>
  );
}

function StartupHowItWorksSection() {
  return (
    <section id="startup-how" className="bg-canvas px-5 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <StartupSectionIntro eyebrow="How it works" title="Tell InternJobs.ai what you need." />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {startupSteps.map(([title, copy], index) => (
            <Reveal key={title} delay={index * 0.06} className="h-full">
              <div className="h-full rounded-lg border border-black/[0.08] bg-white/60 p-5 shadow-soft">
                <span className="rounded-full bg-black/[0.055] px-3 py-1 text-xs font-black text-ink">Step {index + 1}</span>
                <h3 className="mt-6 text-xl font-black text-ink">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-ink-secondary">{copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function StartupRoleMockupSection() {
  return (
    <section className="employer-band relative overflow-hidden px-5 py-24 sm:px-6 lg:px-8">
      <div className="employer-glow" aria-hidden="true" />
      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[0.75fr_1.25fr]">
        <StartupSectionIntro eyebrow="Role context" title="A role card students can actually understand." copy="The role gets packaged with fit, context, and a simple path to reply over text." />
        <StartupRolePanel />
      </div>
    </section>
  );
}

function StartupRolePanel() {
  return (
    <Reveal>
      <div className="startup-role-panel rounded-lg border border-black/[0.08] bg-white/76 p-5 shadow-soft backdrop-blur-xl sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ink-secondary">Startup role</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="text-3xl font-black leading-tight text-ink">Growth intern for an AI tools startup</h3>
          <span className="inline-flex w-fit rounded-full bg-black px-3 py-1 text-xs font-black text-white">paid</span>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-4">
          {["Remote", "Paid", "10-15 hrs/week", "Founder-led"].map((tag) => (
            <span key={tag} className="rounded-lg bg-black/[0.045] px-3 py-3 text-sm font-black text-ink">
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-6 rounded-lg bg-[#111] p-4 text-white">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">InternJobs.ai note</p>
          <p className="mt-3 text-lg font-black leading-7">Best for students who have built projects, enjoy startup environments, and like growth/content/community work.</p>
        </div>
        <div className="mt-4 rounded-lg border border-black/[0.08] bg-white p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-black text-ink">Students who may fit</p>
            <span className="text-xs font-bold text-ink-secondary">3 ready to text</span>
          </div>
          <div className="mt-4 space-y-3">
            {[
              ["AI newsletter + campus ambassador", "Can reply over text first"],
              ["Built a waitlist for a student app", "Strong fit"],
              ["Runs a Discord for builders", "Worth a look"],
            ].map(([student, tag]) => (
              <div key={student} className="flex items-center gap-3 rounded-lg bg-[#F6F4EE] p-3">
                <BrandMark size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-ink">{student}</p>
                  <p className="text-xs font-semibold text-ink-secondary">{tag}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function StartupAccessSection() {
  const fields = ["Company", "Website", "Team size", "Hiring for", "Work type", "Email"];

  return (
    <section id="startup-access" className="waitlist-band relative overflow-hidden px-5 py-24 text-white sm:px-6 lg:px-8">
      <div className="cta-spectrum" aria-hidden="true" />
      <div className="relative z-10 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <div>
          <BrandMark size="lg" />
          <p className="mt-7 text-sm font-black uppercase tracking-[0.18em] text-white/60">Startup access</p>
          <h2 className="mt-4 font-display text-5xl leading-none text-white sm:text-7xl">Get startup access.</h2>
          <p className="mt-5 max-w-md leading-7 text-white/74">Join early access for startups looking for ambitious students before the applications pile up everywhere else.</p>
          <p className="mt-6 max-w-md text-sm leading-6 text-white/54">
            InternJobs.ai works best for startups hiring through curiosity, projects, and initiative, not just resumes.
          </p>
        </div>
        <form
          className="rounded-lg border border-white/10 bg-white/[0.075] p-5 backdrop-blur-xl sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            window.location.href = "mailto:hello@internjobs.ai?subject=Join%20InternJobs.ai%20Startup%20Access";
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field} className={field === "Email" ? "sm:col-span-2" : ""}>
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/48">{field}</span>
                <input className="startup-input" type={field === "Email" ? "email" : field === "Website" ? "url" : "text"} placeholder={field} />
              </label>
            ))}
          </div>
          <button type="submit" className="secondary-party-button mt-5 inline-flex h-[3.35rem] w-full items-center justify-center rounded-full px-7 font-black text-[#111]">
            Join Startup Access
            <ArrowRight className="ml-2 size-4" />
          </button>
        </form>
      </div>
    </section>
  );
}

function StartupFAQSection() {
  const [open, setOpen] = useState(0);

  return (
    <section id="startup-faq" className="bg-canvas px-5 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.7fr_1.3fr]">
        <StartupSectionIntro eyebrow="FAQ" title="A few founder questions." copy="Short answers before you join startup access." />
        <div className="divide-y divide-black/[0.08] border-y border-black/[0.08]">
          {startupFaqs.map(([question, answer], index) => (
            <div key={question}>
              <button type="button" onClick={() => setOpen(open === index ? -1 : index)} className="flex w-full items-center justify-between gap-6 py-6 text-left">
                <span className="font-display text-2xl leading-8 text-ink">{question}</span>
                <ChevronDown className={`size-5 shrink-0 text-ink-secondary transition ${open === index ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence initial={false}>
                {open === index ? (
                  <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pb-6 leading-7 text-ink-secondary">
                    {answer}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StartupFooter() {
  const footerLinks = [
    { label: "How it works", href: "#startup-how" },
    { label: "Signals", href: "#startup-signals" },
    { label: "Startups", href: "/startups" },
    { label: "FAQ", href: "#startup-faq" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Contact", href: "mailto:hello@internjobs.ai" },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-black/[0.08] bg-canvas px-5 py-12 sm:px-6 lg:px-8">
      <div className="footer-word" aria-hidden="true">InternJobs.ai</div>
      <div className="relative mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="font-bold text-ink">InternJobs.ai</span>
          </div>
          <p className="mt-4 max-w-md text-sm leading-6 text-ink-secondary">Find students before everyone else does.</p>
        </div>
        <div className="flex flex-wrap gap-5 text-sm font-medium text-ink-secondary">
          {footerLinks.map((link) => (
            <a key={link.label} href={link.href} className="hover:text-ink">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

function PrivacyPage() {
  return <LegalPage content={privacyContent} active="privacy" />;
}

function TermsPage() {
  return <LegalPage content={termsContent} active="terms" />;
}

function LegalPage({ content, active }: { content: LegalPageContent; active: "privacy" | "terms" }) {
  return (
    <main className="page-shell legal-page min-h-screen overflow-hidden bg-canvas text-ink">
      <LegalNavbar active={active} />
      <section className="relative overflow-hidden px-5 pb-16 pt-28 sm:px-6 lg:px-8">
        <div className="legal-spectrum" aria-hidden="true" />
        <div className="relative z-10 mx-auto max-w-4xl">
          <a href="/" className="mb-10 inline-flex items-center gap-2 text-sm font-black text-ink-secondary transition hover:text-ink">
            <ArrowRight className="size-4 rotate-180" />
            Back to home
          </a>
          <div className="rounded-lg border border-black/[0.08] bg-white/62 p-6 shadow-soft backdrop-blur-xl sm:p-8 lg:p-10">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ink-secondary">InternJobs.ai</p>
            <h1 className="mt-4 font-display text-5xl leading-none text-ink sm:text-7xl">{content.title}</h1>
            <p className="mt-5 text-sm font-bold text-ink-secondary">{content.updated}</p>
            <div className="mt-8 space-y-4 border-b border-black/[0.08] pb-8 text-base leading-8 text-ink-secondary">
              {content.intro.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>

            <div className="divide-y divide-black/[0.08]">
              {content.sections.map((section) => (
                <LegalSection key={section.title} section={section} />
              ))}
            </div>
          </div>
        </div>
      </section>
      <LegalFooter />
    </main>
  );
}

function LegalNavbar({ active }: { active: "privacy" | "terms" }) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-black/[0.06] bg-canvas/88 backdrop-blur-2xl">
      <nav className="flex h-16 w-full items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-2.5" aria-label="InternJobs.ai home">
          <BrandMark size="sm" />
          <span className="text-base font-black text-ink">InternJobs.ai</span>
        </a>
        <div className="hidden items-center gap-1 rounded-full border border-black/[0.08] bg-white/58 p-1 sm:flex">
          <a href="/privacy" className={`rounded-full px-4 py-2 text-sm font-black transition ${active === "privacy" ? "bg-black text-white" : "text-ink-secondary hover:bg-white hover:text-ink"}`}>
            Privacy
          </a>
          <a href="/terms" className={`rounded-full px-4 py-2 text-sm font-black transition ${active === "terms" ? "bg-black text-white" : "text-ink-secondary hover:bg-white hover:text-ink"}`}>
            Terms
          </a>
        </div>
        <div className="flex items-center gap-4">
          <a href="/startups" className="hidden text-sm font-bold text-ink-secondary transition hover:text-ink md:inline-flex">
            Startups
          </a>
          <a href="/#waitlist" className="primary-party-button inline-flex rounded-full px-4 py-2.5 text-sm font-bold text-white sm:px-5">
            Join Early Access
          </a>
        </div>
      </nav>
    </header>
  );
}

function LegalSection({ section }: { section: LegalPageContent["sections"][number] }) {
  return (
    <section className="py-8">
      <h2 className="text-2xl font-black leading-tight text-ink sm:text-3xl">{section.title}</h2>
      <div className="mt-5 space-y-6 text-base leading-8 text-ink-secondary">
        {section.blocks.map((block, index) => (
          <LegalBlockView key={`${section.title}-${index}`} block={block} />
        ))}
      </div>
    </section>
  );
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  return (
    <div>
      {block.title ? <h3 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-ink">{block.title}</h3> : null}
      {block.paragraphs?.map((paragraph) => (
        <p key={paragraph} className={paragraph.includes("@internjobs.ai") ? "font-bold text-ink" : ""}>
          {paragraph.includes("@internjobs.ai") ? <a href={`mailto:${paragraph}`} className="underline decoration-black/20 underline-offset-4 hover:text-black">{paragraph}</a> : paragraph}
        </p>
      ))}
      {block.bullets ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {block.bullets.map((item) => (
            <li key={item} className="flex gap-3 rounded-lg bg-black/[0.035] px-3 py-2 text-sm leading-6 text-ink-secondary">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-black/45" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LegalFooter() {
  const footerLinks = [
    { label: "Home", href: "/" },
    { label: "Startups", href: "/startups" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Contact", href: "mailto:hello@internjobs.ai" },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-black/[0.08] bg-canvas px-5 py-12 sm:px-6 lg:px-8">
      <div className="footer-word" aria-hidden="true">InternJobs.ai</div>
      <div className="relative mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="font-bold text-ink">InternJobs.ai</span>
          </div>
          <p className="mt-4 max-w-md text-sm leading-6 text-ink-secondary">Internships over text.</p>
        </div>
        <div className="flex flex-wrap gap-5 text-sm font-medium text-ink-secondary">
          {footerLinks.map((link) => (
            <a key={link.label} href={link.href} className="hover:text-ink">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

function StartupSectionIntro({
  eyebrow,
  title,
  copy,
  light = false,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
  light?: boolean;
}) {
  return (
    <Reveal className="mb-12 max-w-3xl">
      <p className={`text-xs font-black uppercase ${light ? "text-white/45" : "text-ink-secondary"}`}>{eyebrow}</p>
      <h2 className={`mt-4 font-display text-4xl leading-tight sm:text-6xl ${light ? "text-white" : "text-ink"}`}>{title}</h2>
      {copy ? <p className={`mt-5 text-lg leading-8 ${light ? "text-white/58" : "text-ink-secondary"}`}>{copy}</p> : null}
    </Reveal>
  );
}

function SectionIntro({
  eyebrow,
  title,
  copy,
  light = false,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
  light?: boolean;
}) {
  return (
    <Reveal className="mb-12 max-w-3xl">
      <p className={`text-xs font-black uppercase ${light ? "text-white/45" : "text-ink-secondary"}`}>{eyebrow}</p>
      <h2 className={`mt-4 font-display text-4xl leading-tight sm:text-6xl ${light ? "text-white" : "text-ink"}`}>{title}</h2>
      {copy ? <p className={`mt-5 text-lg leading-8 ${light ? "text-white/55" : "text-ink-secondary"}`}>{copy}</p> : null}
    </Reveal>
  );
}

function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.55, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function FloatingMobileCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > 520);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.a
          href="#waitlist"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="primary-party-button fixed bottom-4 left-4 right-4 z-40 flex h-12 items-center justify-center rounded-full font-bold text-white md:hidden"
        >
          Join Early Access
        </motion.a>
      ) : null}
    </AnimatePresence>
  );
}

export default App;

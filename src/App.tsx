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

const messageAnimation = {
  firstBubbleDelay: 1100,
  nextBubbleDelay: 1250,
  cyclePause: 3800,
};

const navLinks = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Channels", href: "#channels" },
  { label: "Why it helps", href: "#signals" },
  { label: "Startups", href: "#startups" },
  { label: "FAQ", href: "#faq" },
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
  ["Start with what you have", "Use LinkedIn or your projects so InternJobs knows the basics. No giant profile to fill out."],
  ["Text it naturally", "Say what kind of work you want and what you have already built."],
  ["Get the text", "InternJobs keeps looking in the background, texts when something fits, and helps coordinate the next step."],
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
    "No. InternJobs texts you when something actually looks worth your time, then helps you reply without the awkward blank-page moment.",
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
  ["Reach students where they are", "InternJobs explains the role over text, with enough context to make it feel worth a reply."],
  ["Get clearer replies", "Students can ask for help drafting something short, normal, and easy to send."],
];

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
    const sectionIds = navLinks.map((link) => link.href.slice(1));

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
        <a href="#" className="flex items-center gap-2.5" aria-label="InternJobs.ai home" onClick={() => setOpen(false)}>
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
            InternJobs keeps looking for startup internships while you're busy with class, work, or literally anything else.
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
              InternJobs works in iMessage, WhatsApp, Slack, Discord, and phone. No separate tab to keep checking.
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
            <HumanAgentCard icon={<InfinityIcon className="size-5" />} title="InternJobs" copy="Finds roles, explains why they fit, handles the back-and-forth, and helps set up the interview." />
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
                  <strong>InternJobs</strong>
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
            copy="Share the role in plain English. InternJobs helps the right students understand why it fits and reply with context."
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
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">InternJobs note</p>
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
            alt="A student shaking hands with a glowing InternJobs helper"
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
      <div className="footer-word" aria-hidden="true">InternJobs</div>
      <div className="relative mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="font-bold text-ink">InternJobs.ai</span>
          </div>
          <p className="mt-4 max-w-md text-sm leading-6 text-ink-secondary">Way less exhausting than doing it alone.</p>
        </div>
        <div className="flex flex-wrap gap-5 text-sm font-medium text-ink-secondary">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-ink">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
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

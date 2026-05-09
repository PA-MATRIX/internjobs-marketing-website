export type WaitlistAudience = "student" | "startup";

export type MessagingChannel = "imessage" | "sms" | "whatsapp" | "slack" | "discord" | "phone";

export type WaitlistStatus = "started" | "linkedin_connected" | "channel_pending" | "channel_confirmed";

export type StudentProfileContext = {
  interests: string[];
  projects: string;
  preferredWork: string;
  notes: string;
};

export type PairingCodeState = {
  code: string;
  status: "active" | "confirmed" | "expired";
  expiresAt: string;
};

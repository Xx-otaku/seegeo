export const platformIds = ["doubao", "deepseek", "yuanbao"] as const;
export type Platform = (typeof platformIds)[number];
export const platformNames: Record<Platform, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  yuanbao: "腾讯元宝",
};
export type TaskStatus =
  | "skipped"
  | "paused"
  | "pending"
  | "running"
  | "waiting_login"
  | "waiting_verification"
  | "uncertain"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled";
export type SourceStatus = "extracted" | "none" | "failed";
export interface Source {
  kind: "citation" | "search";
  url: string;
  title: string;
  site: string;
  order: number;
  snippet: string;
  marker?: string;
  passage?: string;
}
export interface Capture {
  answer: string;
  html: string;
  sources: Source[];
  sourceStatus: SourceStatus;
  model: string | null;
  mode: {
    search: "enabled" | "auto";
    thinking: false;
    searchTriggered: boolean | null;
    sourceEvidence?: { reported: number; visible: number; citations: "none" | "present" | "unresolved" };
  };
  conversationUrl: string;
  startedAt: string;
  finishedAt: string;
}
export interface Question {
  id: number;
  text: string;
  group_name: string;
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface Task {
  id: number;
  batch_id: number;
  question_id: number;
  question_text: string;
  question_version: number;
  group_name: string;
  platform: Platform;
  status: TaskStatus;
  attempts: number;
  phase: string;
  answer: string | null;
  answer_html: string | null;
  sources: Source[];
  source_status: SourceStatus | null;
  model: string | null;
  mode: Capture["mode"] | null;
  conversation_url: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  diagnostic: string | null;
  can_delete?: boolean;
  retry_deadline_at?: string | null;
  automatic_retries?: number;
  interruption_reason: string | null;
  interrupted_at: string | null;
}
export interface Schedule {
  enabled: boolean;
  frequency: "weekly" | "daily";
  weekday: number;
  hour: number;
  minute: number;
  timezone: "Asia/Shanghai";
  lastSlot: string | null;
}
export class CollectorError extends Error {
  constructor(
    message: string,
    public kind:
      | "login"
      | "verification"
      | "mode"
      | "timeout"
      | "selector"
      | "network"
      | "uncertain"
      | "cancelled",
    public submitted = false,
    public partial?: Partial<Capture>,
  ) {
    super(message);
  }
}

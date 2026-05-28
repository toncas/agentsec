export type Provider = "anthropic" | "openai";

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface NormalizedPrompt {
  provider: Provider;
  system: string;
  tools: ToolDescriptor[];
  raw: unknown;
}

export interface Baseline {
  projectId: string;
  provider: Provider;
  promptHash: string;
  system: string;
  tools: ToolDescriptor[];
  approvedAt: string;
}

export interface DetectionContext {
  prompt: NormalizedPrompt;
  baseline: Baseline | null;
  exemptPatterns: string[];
}

export type Severity = "info" | "warn" | "high";

export interface DetectorResult {
  triggered: boolean;
  severity: Severity;
  evidence: string[];
  error?: string;
}

export interface ThreatReport {
  triggered: boolean;
  highestSeverity: Severity;
  hits: Array<{ name: string; result: DetectorResult }>;
}

export interface Detector {
  readonly name: string;
  detect(ctx: DetectionContext): DetectorResult;
}

export type QuarantineState =
  | { kind: "clean" }
  | { kind: "intercepted"; report: ThreatReport }
  | { kind: "quarantined"; report: ThreatReport; deadline: number }
  | { kind: "approved"; rebaseline: boolean }
  | { kind: "blocked"; reason: "user_deny" | "timeout" | "no_tty" };

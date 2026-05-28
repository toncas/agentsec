import { ValidationError } from "./errors.js";

const AGENTSEC_KEY_MIN_LENGTH = 32;

const VALID_SENSITIVITIES = ["strict", "balanced", "permissive"] as const;
type Sensitivity = (typeof VALID_SENSITIVITIES)[number];

export interface Config {
  agentsecKey: string;
  upstreamUrl: string;
  port: number;
  host: string;
  sensitivity: Sensitivity;
}

/**
 * Loads and validates AgentSec configuration from environment variables.
 *
 * Throws `ValidationError` and exits with a clear message if any required
 * value is missing or invalid — the proxy must not start with an insecure key.
 *
 * NFR-7: AGENTSEC_KEY must be >= 32 chars; process refuses to start otherwise.
 */
export function loadConfig(): Config {
  const key = process.env["AGENTSEC_KEY"] ?? "";

  if (key.length < AGENTSEC_KEY_MIN_LENGTH) {
    throw new ValidationError(
      `AGENTSEC_KEY must be at least ${AGENTSEC_KEY_MIN_LENGTH} characters long ` +
        `(got ${key.length}). ` +
        `Set AGENTSEC_KEY to a cryptographically random 32+ character string.`,
    );
  }

  const sensitivityRaw = process.env["AGENTSEC_SENSITIVITY"] ?? "permissive";

  if (!isValidSensitivity(sensitivityRaw)) {
    throw new ValidationError(
      `AGENTSEC_SENSITIVITY must be one of: ${VALID_SENSITIVITIES.join(", ")}. ` +
        `Got: "${sensitivityRaw}"`,
    );
  }

  const portRaw = process.env["AGENTSEC_PORT"] ?? "7777";
  const port = parseInt(portRaw, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ValidationError(
      `AGENTSEC_PORT must be a valid port number (1-65535). Got: "${portRaw}"`,
    );
  }

  return {
    agentsecKey: key,
    upstreamUrl: process.env["AGENTSEC_UPSTREAM_URL"] ?? "https://api.anthropic.com",
    port,
    host: process.env["AGENTSEC_HOST"] ?? "127.0.0.1",
    sensitivity: sensitivityRaw,
  };
}

function isValidSensitivity(value: string): value is Sensitivity {
  return (VALID_SENSITIVITIES as readonly string[]).includes(value);
}

export class NoBaselineError extends Error {
  constructor(message = "No baseline has been approved for this project.") {
    super(message);
    this.name = "NoBaselineError";
  }
}

export class QuarantineTimeoutError extends Error {
  constructor(message = "Quarantine prompt timed out; request blocked.") {
    super(message);
    this.name = "QuarantineTimeoutError";
  }
}

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class InvalidProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProviderError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

#!/usr/bin/env tsx
/**
 * Traceability gate: every FR-XX / NFR-XX in requirements.md must be cited by
 * at least one task's `Satisfies:` line in tasks.md. Stub for T1.1; full
 * enforcement lands in T1.25.
 */
process.stdout.write("check-traceability: stub ok\n");

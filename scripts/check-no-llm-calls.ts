#!/usr/bin/env tsx
/**
 * NFR-13 enforcement: fails the build if forbidden LLM-API strings appear in
 * detection-pipeline modules. Stub for T1.1; full enforcement lands in T1.24.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "anthropic.com",
  "openai.com",
  "api.anthropic",
  "api.openai",
  "@anthropic-ai/sdk",
  "from \"openai\"",
];

const SCAN_DIRS = ["src/detectors", "src/quarantine", "src/baseline"];

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

let failed = false;
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) {
        process.stderr.write(`NFR-13 violation: '${needle}' found in ${file}\n`);
        failed = true;
      }
    }
  }
}

if (failed) process.exit(1);
process.stdout.write("check-no-llm-calls: ok\n");

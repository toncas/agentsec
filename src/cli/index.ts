#!/usr/bin/env node
import { Command } from "commander";

import { VERSION } from "../version.js";

const program = new Command();

program
  .name("agentsec")
  .description("Transparent agent security proxy. No code changes. No LLM in detection. Local-first.")
  .version(VERSION);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`agentsec: ${message}\n`);
  process.exit(1);
});

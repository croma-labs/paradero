/// <reference types="node" />
/**
 * Starts the fake Croma, then runs an Expo command whose API routes read from it instead of the real one.
 *
 *   npm run dev:fake                                     # expo start, default scenario
 *   npm run dev:fake -- run:ios                          # build and open on the iOS simulator
 *   npm run dev:fake -- run:android                      # build and open on the Android emulator
 *   npm run dev:fake -- --scenario my-case.json run:ios  # start from your own scenario
 *
 * Values set here win over .env.local (Expo never overwrites a variable the shell already has),
 * so a real CROMA_API_KEY in .env.local is never sent anywhere.
 */
import { spawn } from "node:child_process";

import { DEFAULT_PORT, scenarioArg, startFakeCroma } from "./server.ts";

const { scenario, rest } = scenarioArg(process.argv.slice(2));
const port = Number(process.env.FAKE_CROMA_PORT) || DEFAULT_PORT;
const { server, url } = await startFakeCroma({ port, scenario, log: process.env.FAKE_CROMA_LOG === "1" });
console.log(`[fake-croma] Answering as Croma on ${url}. Swap the scenario any time with PUT ${url}/__scenario.`);

const expo = spawn("npx", ["expo", ...(rest.length ? rest : ["start"])], {
  stdio: "inherit",
  env: { ...process.env, CROMA_API_URL: url, CROMA_API_KEY: "fake-croma" },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => expo.kill(signal));
expo.on("exit", (code, signal) => {
  server.close();
  process.exit(code ?? (signal ? 1 : 0));
});

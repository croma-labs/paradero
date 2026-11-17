// Lets `node --test` import the app's TypeScript as the bundler does: "@/x" → src/x and "./y" → "./y.ts".
import { register } from "node:module";

register("./resolve.mjs", import.meta.url);

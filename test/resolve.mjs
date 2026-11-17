import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
  if ((target.startsWith(".") || target.startsWith("file:")) && !/\.[cm]?[jt]sx?$/.test(target)) {
    const url = new URL(target, context.parentURL);
    for (const ext of [".ts", ".tsx"]) {
      if (existsSync(fileURLToPath(url) + ext)) return next(url.href + ext, context);
    }
  }
  return next(target, context);
}

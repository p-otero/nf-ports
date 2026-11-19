import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const findRepoRoot = (start: string): string | null => {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

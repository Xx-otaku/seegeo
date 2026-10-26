import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, chmodSync } from "node:fs";
export const dataDir =
  process.env.SEEGEO_DATA_DIR ||
  join(homedir(), "Library", "Application Support", "seegeo");
export const port = Number(process.env.SEEGEO_PORT || 4317);
export function prepareDataDir() {
  for (const dir of [
    dataDir,
    join(dataDir, "profiles"),
    join(dataDir, "diagnostics"),
  ]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
}

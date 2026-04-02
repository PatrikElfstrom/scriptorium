import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export function loadDotEnvFile(cwd = process.cwd()) {
  const envPath = path.resolve(cwd, ".env")

  if (!existsSync(envPath)) {
    return
  }

  const contents = readFileSync(envPath, "utf8")

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const separatorIndex = trimmed.indexOf("=")

    if (separatorIndex < 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()

    if (!key || key in process.env) {
      continue
    }

    let value = trimmed.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}

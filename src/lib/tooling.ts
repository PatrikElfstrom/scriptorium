import { parse } from "yaml"

type ToolingDatabase = {
  projects?: unknown
}

type ToolEntry = {
  name?: unknown
  url?: unknown
  repository_name?: unknown
  stars?: unknown
  tags?: unknown
}

export type ToolRow = {
  id: string
  name: string
  url?: string
  repositoryName?: string
  github?: string
  stars?: number
  tags: string[]
}

export function loadToolingRows(source: string) {
  const document = parse(source) as ToolingDatabase

  if (!Array.isArray(document.projects)) {
    throw new Error("tooling.yaml must include a projects array.")
  }

  const entries = readObjectArray(document.projects, "projects")

  return entries.map((rawEntry, entryIndex) => {
    const entry = rawEntry as ToolEntry
    const name = readRequiredString(entry.name, `projects[${entryIndex}].name`)
    const url = readOptionalString(entry.url)
    const repositoryName = readOptionalString(entry.repository_name)

    return {
      id: createToolId(name, url),
      name,
      url,
      repositoryName,
      github: repositoryName
        ? `https://github.com/${repositoryName}`
        : undefined,
      stars: readOptionalInteger(entry.stars, `projects[${entryIndex}].stars`),
      tags: uniqueValues(
        readStringArray(entry.tags, `projects[${entryIndex}].tags`).map(
          canonicalizeTag
        )
      ).sort((left, right) => left.localeCompare(right)),
    } satisfies ToolRow
  })
}

function readRequiredString(value: unknown, path: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`)
  }

  return value.trim()
}

function readOptionalString(value: unknown) {
  if (value == null) {
    return undefined
  }

  if (typeof value !== "string") {
    throw new Error("Expected a string value in tooling.yaml.")
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readObjectArray(value: unknown, path: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`)
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${path}[${index}] must be an object.`)
    }

    return item
  })
}

function readOptionalInteger(value: unknown, path: string) {
  if (value == null) {
    return undefined
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${path} must be an integer.`)
  }

  return value
}

function readStringArray(value: unknown, path: string) {
  if (value == null) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of strings.`)
  }

  return value.map((item, index) =>
    readRequiredString(item, `${path}[${index}]`)
  )
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function createToolId(name: string, url?: string) {
  const base = slugify(name)
  const fingerprint = Math.abs(hashString(`${name}:${url ?? ""}`)).toString(36)

  return `${base || "tool"}-${fingerprint}`
}

function hashString(value: string) {
  let hash = 0

  for (const character of value) {
    hash = (hash << 5) - hash + character.charCodeAt(0)
    hash |= 0
  }

  return hash
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values))
}

function canonicalizeTag(value: string) {
  switch (value) {
    case "access":
      return "accessibility"
    case "baas":
      return "backend-as-a-service"
    case "build":
      return "build-tool"
    case "cms":
      return "content-management-system"
    case "component":
      return "component-library"
    case "crm":
      return "customer-relationship-management"
    case "css-lib":
      return "css-library"
    case "db":
      return "database"
    case "devtool":
      return "developer-tool"
    case "dnd":
      return "drag-and-drop"
    case "doc":
      return "documentation"
    case "ide":
      return "integrated-development-environment"
    case "lint":
      return "linter"
    case "material":
      return "material-design"
    case "mcp":
      return "model-context-protocol"
    case "ml":
      return "machine-learning"
    case "nvm":
      return "node-version-manager"
    case "rpc":
      return "remote-procedure-call"
    case "rsc":
      return "react-server-components"
    case "ssg":
      return "static-site-generator"
    case "test-framework":
      return "testing-framework"
    default:
      return value
  }
}

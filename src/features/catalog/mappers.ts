import type { CatalogItem } from "../../../shared/catalog"
import type { CatalogRow } from "./types"

export function mapCatalogItemsToRows(items: CatalogItem[]): CatalogRow[] {
  return items.map((item) => ({
    id: item.packageKey,
    name: item.name,
    description: normalizeOptionalString(item.description),
    homepageUrl: normalizeOptionalString(item.homepageUrl),
    url: normalizeOptionalString(item.homepageUrl ?? item.url),
    repositoryName: normalizeOptionalString(item.repositoryName),
    github: item.repositoryName
      ? `https://github.com/${item.repositoryName}`
      : undefined,
    npmPackageName: normalizeOptionalString(item.npmPackageName),
    npmPackageUrl: item.npmPackageName
      ? `https://www.npmjs.com/package/${item.npmPackageName
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`
      : undefined,
    publishedAt: normalizeOptionalString(item.publishedAt),
    stars: typeof item.stars === "number" ? item.stars : undefined,
    tags: uniqueValues(
      item.tags
        .map(normalizeOptionalString)
        .filter((tag): tag is string => Boolean(tag))
        .sort((left, right) => left.localeCompare(right))
    ),
  }))
}

function normalizeOptionalString(value?: string | null) {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values))
}

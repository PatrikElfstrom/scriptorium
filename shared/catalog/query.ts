import {
  DEFAULT_CATALOG_SEARCH_LIMIT,
  MAX_CATALOG_SEARCH_LIMIT,
  type CatalogTagListParams,
  type ParsedCatalogSearchParams,
} from "./contracts"
import { decodeCatalogCursor } from "./cursor"

export function normalizeCatalogText(value?: string | null) {
  if (typeof value !== "string") {
    return ""
  }

  return value.trim().toLowerCase()
}

export function normalizeCatalogSource(value?: string | null) {
  const normalized = normalizeCatalogText(value)
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeCatalogTags(rawTags?: string | null) {
  if (!rawTags) {
    return []
  }

  return Array.from(
    new Set(
      rawTags
        .split(",")
        .map((value) => normalizeCatalogText(value))
        .filter(Boolean)
    )
  )
}

export function clampCatalogLimit(value?: string | null) {
  const parsedValue = Number.parseInt(value ?? "", 10)
  const resolved = Number.isInteger(parsedValue)
    ? parsedValue
    : DEFAULT_CATALOG_SEARCH_LIMIT

  return Math.min(Math.max(resolved, 1), MAX_CATALOG_SEARCH_LIMIT)
}

export function parseCatalogSearchParams(
  searchParams: URLSearchParams
): ParsedCatalogSearchParams {
  const cursor = searchParams.get("cursor")

  return {
    query: normalizeCatalogText(searchParams.get("q")),
    tags: normalizeCatalogTags(searchParams.get("tags")),
    source: normalizeCatalogSource(searchParams.get("source")),
    limit: clampCatalogLimit(searchParams.get("limit")),
    cursor,
    offset: decodeCatalogCursor(cursor),
  }
}

export function parseCatalogTagListParams(
  searchParams: URLSearchParams
): CatalogTagListParams {
  return {
    source: normalizeCatalogSource(searchParams.get("source")),
  }
}

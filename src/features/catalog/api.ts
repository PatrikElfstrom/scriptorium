export function createCatalogApiUrl(
  pathname: string,
  searchParams?: URLSearchParams
) {
  const baseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)
  const query = searchParams?.toString()
  const suffix = query ? `?${query}` : ""

  if (!baseUrl) {
    return `${pathname}${suffix}`
  }

  return `${baseUrl}${pathname}${suffix}`
}

function normalizeBaseUrl(value?: string) {
  if (!value) {
    return ""
  }

  return value.trim().replace(/\/+$/, "")
}

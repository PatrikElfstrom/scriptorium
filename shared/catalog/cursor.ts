function encodeBase64Url(value: string) {
  if (typeof btoa !== "function") {
    throw new Error("No base64 encoder available in the current runtime.")
  }

  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function decodeBase64Url(value: string) {
  if (typeof atob !== "function") {
    throw new Error("No base64 decoder available in the current runtime.")
  }

  const remainder = value.length % 4
  const padded = `${value}${"=".repeat(remainder === 0 ? 0 : 4 - remainder)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/")

  return atob(padded)
}

export function decodeCatalogCursor(cursor?: string | null) {
  if (!cursor) {
    return 0
  }

  try {
    const decoded = decodeBase64Url(cursor)
    const parsedValue = Number.parseInt(decoded, 10)
    return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : 0
  } catch {
    return 0
  }
}

export function encodeCatalogCursor(offset: number) {
  return encodeBase64Url(String(offset))
}

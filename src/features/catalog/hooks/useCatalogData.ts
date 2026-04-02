import { startTransition, useEffect, useState } from "react"

import type {
  CatalogSearchResponse,
  CatalogTagListResponse,
} from "../../../../shared/catalog"

import { createCatalogApiUrl } from "../api"
import { mapCatalogItemsToRows } from "../mappers"
import { normalizeValue } from "../helpers"
import type { CatalogRow } from "../types"

export function useCatalogData() {
  const [rows, setRows] = useState<CatalogRow[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string>()

  useEffect(() => {
    let isCancelled = false

    async function loadCatalog() {
      setIsLoading(true)
      setErrorMessage(undefined)

      try {
        const searchParams = new URLSearchParams({ limit: "1000" })
        const [searchResponse, tagsResponse] = await Promise.all([
          fetch(createCatalogApiUrl("/api/search", searchParams)),
          fetch(createCatalogApiUrl("/api/tags")),
        ])

        if (!searchResponse.ok) {
          throw new Error(`Search request failed with ${searchResponse.status}.`)
        }

        if (!tagsResponse.ok) {
          throw new Error(`Tags request failed with ${tagsResponse.status}.`)
        }

        const searchPayload =
          (await searchResponse.json()) as CatalogSearchResponse
        const tagsPayload = (await tagsResponse.json()) as CatalogTagListResponse
        const nextRows = mapCatalogItemsToRows(searchPayload.items ?? [])
        const nextTags = (tagsPayload.items ?? [])
          .map((item) => normalizeValue(item.id || item.label))
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right))

        if (isCancelled) {
          return
        }

        startTransition(() => {
          setRows(nextRows)
          setAvailableTags(nextTags)
          setIsLoading(false)
        })
      } catch (error) {
        if (isCancelled) {
          return
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load the tooling catalog."
        )
        setIsLoading(false)
      }
    }

    void loadCatalog()

    return () => {
      isCancelled = true
    }
  }, [])

  return {
    rows,
    availableTags,
    isLoading,
    errorMessage,
  }
}

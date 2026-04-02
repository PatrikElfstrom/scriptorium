export type CatalogRow = {
  id: string
  name: string
  description?: string
  url?: string
  repositoryName?: string
  github?: string
  npmPackageName?: string
  npmPackageUrl?: string
  stars?: number
  tags: string[]
}

export type SortColumn = "name" | "stars" | "tags"

export type SortState = {
  column: SortColumn
  direction: "asc" | "desc"
}

export type ParsedFilter = {
  tags: string[]
  textTerms: string[]
}

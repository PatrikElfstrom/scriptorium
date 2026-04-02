import { importAlgoliaPackages } from "../server/catalog/admin-service"
import { loadDotEnvFile } from "../server/catalog/load-env"
import { createNodeCatalogDatabaseClient } from "../server/catalog/node-database"
import { ensureCatalogSchema } from "../server/catalog/schema"

loadDotEnvFile()

const client = createNodeCatalogDatabaseClient()
const queryTerms = process.argv
  .slice(2)
  .map((value) => value.trim())
  .filter(Boolean)

if (queryTerms.length === 0) {
  console.error(
    [
      "No Algolia queries provided.",
      'Usage: pnpm import:algolia-packages -- "react framework" "typescript validation"',
    ].join("\n")
  )
  process.exit(1)
}

await ensureCatalogSchema(client)

try {
  const result = await importAlgoliaPackages(client, {
    queries: queryTerms,
    algoliaAppId: process.env.ALGOLIA_APP_ID ?? "OFCNCOG2CU",
    algoliaApiKey:
      process.env.ALGOLIA_API_KEY ?? "f54e21fa3a2a0160595bb058179bfb1e",
    algoliaIndexName: process.env.ALGOLIA_INDEX_NAME ?? "npm-search",
    hitsPerQuery: parsePositiveInteger(process.env.ALGOLIA_HITS_PER_QUERY, 100),
    maxImports: parsePositiveInteger(process.env.ALGOLIA_MAX_IMPORTS, 40),
    minDownloadsLast30Days: parsePositiveInteger(
      process.env.ALGOLIA_MIN_DOWNLOADS_LAST_30_DAYS,
      50_000
    ),
    modernWithinDays: parsePositiveInteger(
      process.env.ALGOLIA_MODERN_WITHIN_DAYS,
      365 * 3
    ),
  })

  if (result.importedCount === 0) {
    console.log("No new packages matched the current Algolia import criteria.")
  } else {
    console.log(
      `Imported ${result.importedCount} packages from Algolia across ${queryTerms.length} queries.`
    )
  }
} finally {
  client.close?.()
}

function parsePositiveInteger(value: string | undefined, fallbackValue: number) {
  if (!value) {
    return fallbackValue
  }

  const parsedValue = Number.parseInt(value, 10)
  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallbackValue
}

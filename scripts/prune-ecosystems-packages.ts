import { pruneEcosystemsPackages } from "../server/catalog/admin-service"
import { loadDotEnvFile } from "../server/catalog/load-env"
import { createNodeCatalogDatabaseClient } from "../server/catalog/node-database"
import { ensureCatalogSchema } from "../server/catalog/schema"

loadDotEnvFile()

const client = createNodeCatalogDatabaseClient()

await ensureCatalogSchema(client)

try {
  const result = await pruneEcosystemsPackages(client)

  console.log(
    `Deleted ${result.deletedCount} npm packages that failed the ecosyste.ms retention criteria.`
  )
} finally {
  client.close?.()
}

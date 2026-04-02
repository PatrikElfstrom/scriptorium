import { syncNpmMetadata } from "../server/catalog/admin-service"
import { loadDotEnvFile } from "../server/catalog/load-env"
import { createNodeCatalogDatabaseClient } from "../server/catalog/node-database"
import { ensureCatalogSchema } from "../server/catalog/schema"

loadDotEnvFile()

const client = createNodeCatalogDatabaseClient()

await ensureCatalogSchema(client)

try {
  const result = await syncNpmMetadata(client, {
    npmRegistryBaseUrl:
      process.env.NPM_REGISTRY_BASE_URL ?? "https://registry.npmjs.org",
  })

  console.log(
    `Updated ${result.updatedCount} package entries across ${result.packageCount} npm packages.`
  )
} finally {
  client.close?.()
}

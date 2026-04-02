import { createNodeCatalogDatabaseClient } from "../server/catalog/node-database"
import { loadDotEnvFile } from "../server/catalog/load-env"
import { ensureCatalogSchema } from "../server/catalog/schema"

loadDotEnvFile()

const client = createNodeCatalogDatabaseClient()

try {
  await ensureCatalogSchema(client)
  console.log("Catalog database schema is ready.")
} finally {
  client.close?.()
}

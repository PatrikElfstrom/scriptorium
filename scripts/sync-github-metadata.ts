import { syncGitHubMetadata } from "../server/catalog/admin-service"
import { loadDotEnvFile } from "../server/catalog/load-env"
import { createNodeCatalogDatabaseClient } from "../server/catalog/node-database"
import { ensureCatalogSchema } from "../server/catalog/schema"

loadDotEnvFile()

const client = createNodeCatalogDatabaseClient()

await ensureCatalogSchema(client)

try {
  const result = await syncGitHubMetadata(client, {
    githubApiBaseUrl: process.env.GITHUB_API_BASE_URL ?? "https://api.github.com",
    githubToken: process.env.GITHUB_TOKEN,
  })

  console.log(
    `Updated ${result.updatedCount} package entries across ${result.repositoryCount} repositories.`
  )
} finally {
  client.close?.()
}

import { importAlgoliaPackages } from "../../server/catalog/admin-service"
import {
  createTestCatalogDatabase,
  seedCatalogPackage,
} from "../helpers/catalog-test-db"

describe("importAlgoliaPackages", () => {
  it("skips packages that already exist in the catalog", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        sourceType: "npm",
        sourceName: "react",
        displayName: "react",
        npmPackageName: "react",
        repositoryName: "facebook/react",
      })

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              hits: [
                {
                  name: "react",
                  description: "UI library",
                  homepage: "https://react.dev",
                  repository: "https://github.com/facebook/react",
                  keywords: ["react", "ui"],
                  popular: true,
                  downloadsLast30Days: 2_000_000,
                  modified: "2026-01-01T00:00:00.000Z",
                },
              ],
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        )
      )

      const result = await importAlgoliaPackages(database.client, {
        queries: ["react"],
        algoliaAppId: "test",
        algoliaApiKey: "test",
        algoliaIndexName: "npm-search",
        hitsPerQuery: 10,
        maxImports: 5,
        minDownloadsLast30Days: 10,
        modernWithinDays: 365,
      })

      const packageCount = await database.client.execute(
        "SELECT COUNT(*) AS total FROM packages"
      )

      expect(result.importedCount).toBe(0)
      expect(Number(packageCount.rows[0]?.total ?? 0)).toBe(1)
    } finally {
      vi.unstubAllGlobals()
      await database.cleanup()
    }
  })
})

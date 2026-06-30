import { parseCatalogSearchParams } from "../../shared/catalog"
import {
  listCatalogTags,
  searchCatalog,
} from "../../server/catalog/read-service"
import { ensureCatalogSchema } from "../../server/catalog/schema"
import {
  createFailDerivedCatalogDirtyStatements,
  createMarkDerivedCatalogDirtyStatements,
} from "../../server/catalog/package-store"
import {
  createTestCatalogDatabase,
  seedCatalogPackage,
} from "../helpers/catalog-test-db"

describe("catalog services", () => {
  it("searches catalog rows with filters, term tokenization, and cursors", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        homepageUrl: "https://react.dev",
        repositoryUrl: "https://github.com/facebook/react",
        packageLastPublishedAt: "2026-01-01T00:00:00.000Z",
        repositoryStars: 200_000,
        packageDownloads: 1000,
        packageTags: ["react", "ui"],
        repositoryTags: ["frontend"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "vue",
        packageDescription: "Progressive framework",
        repositoryUrl: "https://github.com/vuejs/core",
        repositoryStars: 150_000,
        packageDownloads: 800,
        packageTags: ["vue", "ui"],
      })

      const result = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            q: "ui facebook",
            tags: "ui",
            limit: "1",
          })
        )
      )

      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.packageName).toBe("react")
      expect(result.items[0]?.homepageUrl).toBe("https://react.dev")
      expect(result.items[0]?.packageLastPublishedAt).toBe(
        "2026-01-01T00:00:00.000Z"
      )
      expect(result.nextCursor).toBeNull()
      expect(result.totalApprox).toBe(1)
    } finally {
      await database.cleanup()
    }
  })

  it("matches package text and tags through the FTS search index", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "@tanstack/react-query",
        packageDescription: "Async state manager for React",
        repositoryUrl: "https://github.com/TanStack/query",
        packageTags: ["react", "async state"],
        repositoryTags: ["data fetching"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "query-react-tanstack",
        packageDescription: "tanstack react query companion",
        repositoryUrl: "https://github.com/example/query-react-tanstack",
        packageTags: ["tanstack", "react", "query"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "vue",
        packageDescription: "Progressive framework",
        repositoryUrl: "https://github.com/vuejs/core",
        packageTags: ["vue"],
      })

      const scopedResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            q: "@tanstack/react-query",
          })
        )
      )
      const tagResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            q: "data fetching",
          })
        )
      )
      const punctuationResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            q: "@",
          })
        )
      )

      expect(scopedResult.items.map((item) => item.packageName)).toEqual([
        "@tanstack/react-query",
      ])
      expect(tagResult.items.map((item) => item.packageName)).toEqual([
        "@tanstack/react-query",
      ])
      expect(punctuationResult.items.map((item) => item.packageName)).toEqual([
        "@tanstack/react-query",
      ])
    } finally {
      await database.cleanup()
    }
  })

  it("falls back to legacy search when the FTS table is unavailable", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        repositoryUrl: "https://github.com/facebook/react",
        packageTags: ["react"],
        repositoryTags: ["data-fetching"],
      })

      await database.client.execute("DROP TABLE package_search_fts")

      const result = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            q: "react",
          })
        )
      )
      const tagOnlyResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            q: "data fetching",
          })
        )
      )

      expect(result.items.map((item) => item.packageName)).toEqual(["react"])
      expect(tagOnlyResult.items.map((item) => item.packageName)).toEqual([
        "react",
      ])
    } finally {
      await database.cleanup()
    }
  })

  it("sorts catalog rows by stars, downloads, and published date", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageLastPublishedAt: "2026-01-01T00:00:00.000Z",
        repositoryStars: 200_000,
        packageDownloads: 4_000_000,
        packageTags: ["react", "ui"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "astro",
        packageLastPublishedAt: "2025-11-20T00:00:00.000Z",
        repositoryStars: 45_000,
        packageDownloads: 2_000_000,
        packageTags: ["framework", "ssg"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "vue",
        packageLastPublishedAt: "2025-12-15T00:00:00.000Z",
        repositoryStars: 150_000,
        packageDownloads: 3_000_000,
        packageTags: ["ui", "vue"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "angular",
        packageLastPublishedAt: "2025-10-10T00:00:00.000Z",
        repositoryStars: 90_000,
        packageDownloads: 3_000_000,
        packageTags: ["ui", "framework"],
      })

      const starsResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            sort: "stars",
            direction: "desc",
          })
        )
      )
      const downloadsResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            sort: "downloads",
            direction: "desc",
          })
        )
      )
      const publishedResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            sort: "published",
            direction: "desc",
          })
        )
      )

      expect(starsResult.items.map((item) => item.packageName)).toEqual([
        "react",
        "vue",
        "angular",
        "astro",
      ])
      expect(downloadsResult.items.map((item) => item.packageName)).toEqual([
        "react",
        "angular",
        "vue",
        "astro",
      ])
      expect(publishedResult.items.map((item) => item.packageName)).toEqual([
        "react",
        "vue",
        "astro",
        "angular",
      ])
    } finally {
      await database.cleanup()
    }
  })

  it("filters by tags across package and repository tag tables", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageTags: ["ui"],
        repositoryTags: ["frontend"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "vue",
        packageTags: ["ui"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "vite",
        repositoryTags: ["frontend"],
      })

      const result = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            tags: "ui,frontend",
          })
        )
      )

      expect(result.items.map((item) => item.packageName)).toEqual(["react"])
      expect(result.totalApprox).toBe(1)
    } finally {
      await database.cleanup()
    }
  })

  it("lists merged package and repository tags", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageTags: ["react", "ui"],
        repositoryTags: ["opensource"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "vite",
        packageTags: ["build"],
      })

      const allTags = await listCatalogTags(database.client, {})

      expect(allTags.items.map((tag) => tag.id)).toEqual(
        expect.arrayContaining([
          "react",
          "component-library",
          "opensource",
          "build-tool",
        ])
      )
    } finally {
      await database.cleanup()
    }
  })

  it("lists tags with precomputed package counts", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageTags: ["react", "ui"],
        repositoryTags: ["frontend"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "vite",
        packageTags: ["build", "ui"],
      })

      const allTags = await listCatalogTags(database.client, {})

      expect(allTags.items).toEqual([
        {
          id: "component-library",
          label: "component library",
          packageCount: 2,
        },
        { id: "build-tool", label: "build tool", packageCount: 1 },
        { id: "front-end", label: "front end", packageCount: 1 },
        { id: "react", label: "react", packageCount: 1 },
      ])
    } finally {
      await database.cleanup()
    }
  })

  it("hides removed security holding packages from search and tag results", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        repositoryUrl: "https://github.com/facebook/react",
        packageTags: ["react", "ui"],
      })
      await seedCatalogPackage(database.client, {
        packageName: "@patrtorg/sit-voluptate-quibusdam",
        packageDescription: "Security holding package",
        repositoryUrl: "https://github.com/npm/security-holder",
        packageTags: ["malware"],
        repositoryTags: ["security"],
      })

      const searchResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(new URLSearchParams({}))
      )
      const removedSearchResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(
          new URLSearchParams({
            q: "sit-voluptate-quibusdam",
          })
        )
      )
      const allTags = await listCatalogTags(database.client, {})

      expect(searchResult.items.map((item) => item.packageName)).toEqual([
        "react",
      ])
      expect(searchResult.totalApprox).toBe(1)
      expect(removedSearchResult.items).toEqual([])
      expect(removedSearchResult.totalApprox).toBe(0)
      expect(allTags.items.map((tag) => tag.id)).toEqual(
        expect.arrayContaining(["react", "component-library"])
      )
      expect(allTags.items.map((tag) => tag.id)).not.toEqual(
        expect.arrayContaining(["malware", "security"])
      )
    } finally {
      await database.cleanup()
    }
  })

  it("removes obsolete package indexes during schema ensure without resetting data", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        packageTags: ["react"],
      })

      await database.client.execute(`
        CREATE INDEX IF NOT EXISTS packages_package_name_idx
        ON packages(package_name)
      `)
      await database.client.execute(`
        CREATE INDEX IF NOT EXISTS packages_repository_stars_idx
        ON packages(repository_stars DESC)
      `)
      await database.client.execute(`
        CREATE INDEX IF NOT EXISTS packages_last_published_at_idx
        ON packages(package_last_published_at DESC)
      `)

      await ensureCatalogSchema(database.client)

      const remainingIndexes = await database.client.execute(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'packages'
        ORDER BY name ASC
      `)
      const packageCount = await database.client.execute(`
        SELECT COUNT(*) AS total
        FROM packages
      `)

      expect(remainingIndexes.rows.map((row) => String(row.name))).toEqual(
        expect.arrayContaining([
          "packages_downloads_idx",
          "packages_last_published_at_name_idx",
          "packages_name_nocase_idx",
          "packages_repository_stars_name_idx",
        ])
      )
      expect(remainingIndexes.rows.map((row) => String(row.name))).not.toEqual(
        expect.arrayContaining([
          "packages_package_name_idx",
          "packages_repository_stars_idx",
          "packages_last_published_at_idx",
        ])
      )
      expect(Number(packageCount.rows[0]?.total)).toBe(1)
    } finally {
      await database.cleanup()
    }
  })

  it("does not rebuild derived catalog data during schema ensure when schema is current", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        packageTags: ["react"],
      })

      const versionBefore = await readTagsVersion(database.client)

      await ensureCatalogSchema(database.client)

      await expect(readTagsVersion(database.client)).resolves.toBe(
        versionBefore
      )
    } finally {
      await database.cleanup()
    }
  })

  it("does not repair or clear active dirty markers during schema ensure", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        packageTags: ["react"],
      })

      await database.client.execute({
        sql: `
          UPDATE packages
          SET package_description = ?
          WHERE package_name = ?
        `,
        args: ["Fast UI runtime", "react"],
      })
      await database.client.batch(
        createMarkDerivedCatalogDirtyStatements(
          "active-sync-test",
          new Date().toISOString()
        ),
        "write"
      )

      await ensureCatalogSchema(database.client)

      const searchResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(new URLSearchParams({ q: "runtime" }))
      )
      const dirtyMarkers = await readDirtySyncIds(database.client)

      expect(searchResult.items).toEqual([])
      expect(dirtyMarkers).toEqual(["active-sync-test"])
    } finally {
      await database.cleanup()
    }
  })

  it("rebuilds failed dirty derived catalog data during schema ensure", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        packageTags: ["react"],
      })

      await database.client.execute({
        sql: `
          UPDATE packages
          SET package_description = ?
          WHERE package_name = ?
        `,
        args: ["Fast UI runtime", "react"],
      })
      await database.client.batch(
        [
          ...createMarkDerivedCatalogDirtyStatements(
            "failed-sync-test",
            "2026-01-01T00:00:00.000Z"
          ),
          ...createFailDerivedCatalogDirtyStatements(
            "failed-sync-test",
            "2026-01-01T00:01:00.000Z"
          ),
        ],
        "write"
      )

      await ensureCatalogSchema(database.client)

      const searchResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(new URLSearchParams({ q: "runtime" }))
      )
      const dirtyMarkers = await readDirtySyncIds(database.client)

      expect(searchResult.items.map((item) => item.packageName)).toEqual([
        "react",
      ])
      expect(dirtyMarkers).toEqual([])
    } finally {
      await database.cleanup()
    }
  })

  it("keeps active dirty markers while repairing failed dirty markers", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        packageTags: ["react"],
      })

      await database.client.execute({
        sql: `
          UPDATE packages
          SET package_description = ?
          WHERE package_name = ?
        `,
        args: ["Fast UI runtime", "react"],
      })
      await database.client.batch(
        [
          ...createMarkDerivedCatalogDirtyStatements(
            "active-sync-test",
            new Date().toISOString()
          ),
          ...createMarkDerivedCatalogDirtyStatements(
            "failed-sync-test",
            "2026-01-01T00:00:00.000Z"
          ),
          ...createFailDerivedCatalogDirtyStatements(
            "failed-sync-test",
            "2026-01-01T00:01:00.000Z"
          ),
        ],
        "write"
      )

      await ensureCatalogSchema(database.client)

      const searchResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(new URLSearchParams({ q: "runtime" }))
      )
      const dirtyMarkers = await readDirtySyncIds(database.client)

      expect(searchResult.items.map((item) => item.packageName)).toEqual([
        "react",
      ])
      expect(dirtyMarkers).toEqual(["active-sync-test"])
    } finally {
      await database.cleanup()
    }
  })

  it("drops malformed dirty marker tables and repairs derived catalog data", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        packageTags: ["react"],
      })

      await database.client.execute({
        sql: `
          UPDATE packages
          SET package_description = ?
          WHERE package_name = ?
        `,
        args: ["Fast UI runtime", "react"],
      })
      await database.client.execute(`
        CREATE TABLE catalog_derived_dirty (
          dirty INTEGER NOT NULL
        )
      `)
      await database.client.execute(`
        INSERT INTO catalog_derived_dirty (dirty)
        VALUES (1)
      `)

      await ensureCatalogSchema(database.client)

      const searchResult = await searchCatalog(
        database.client,
        parseCatalogSearchParams(new URLSearchParams({ q: "runtime" }))
      )
      const dirtyMarkers = await readDirtySyncIds(database.client)

      expect(searchResult.items.map((item) => item.packageName)).toEqual([
        "react",
      ])
      expect(dirtyMarkers).toEqual([])
    } finally {
      await database.cleanup()
    }
  })

  it("keeps a failed dirty marker when malformed marker repair rebuild fails", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        packageName: "react",
        packageDescription: "UI library",
        packageTags: ["react"],
      })

      await database.client.execute({
        sql: `
          UPDATE packages
          SET package_description = ?
          WHERE package_name = ?
        `,
        args: ["Fast UI runtime", "react"],
      })
      await database.client.execute(`
        CREATE TABLE catalog_derived_dirty (
          dirty INTEGER NOT NULL
        )
      `)
      await database.client.execute(`
        INSERT INTO catalog_derived_dirty (dirty)
        VALUES (1)
      `)
      await database.client.execute("DROP TABLE package_search_fts")
      await database.client.execute(`
        CREATE TABLE package_search_fts (
          invalid_column TEXT
        )
      `)

      await expect(ensureCatalogSchema(database.client)).rejects.toThrow(
        /package_search_fts/
      )

      const dirtyMarkers = await readDirtySyncIds(database.client)

      expect(dirtyMarkers).toEqual(["schema-repair-malformed-marker"])
    } finally {
      await database.cleanup()
    }
  })
})

async function readTagsVersion(
  client: Parameters<typeof ensureCatalogSchema>[0]
) {
  const result = await client.execute({
    sql: `
      SELECT meta_value
      FROM catalog_meta
      WHERE meta_key = 'tags_version'
    `,
  })

  return Number(result.rows[0]?.meta_value ?? 0)
}

async function readDirtySyncIds(
  client: Parameters<typeof ensureCatalogSchema>[0]
) {
  let result: Awaited<ReturnType<typeof client.execute>>

  try {
    result = await client.execute(`
      SELECT sync_id
      FROM catalog_derived_dirty
      ORDER BY sync_id ASC
    `)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("no such table: catalog_derived_dirty")
    ) {
      return []
    }

    throw error
  }

  return result.rows.map((row) => String(row.sync_id))
}

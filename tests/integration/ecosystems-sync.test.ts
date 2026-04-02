import { syncEcosystemsPopular } from "../../server/catalog/admin-service"
import { resetCatalogSchema } from "../../server/catalog/schema"
import { createTestCatalogDatabase, seedCatalogPackage } from "../helpers/catalog-test-db"

describe("ecosyste.ms popular sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("paginates downloads-ranked packages and sends the required headers", async () => {
    const database = await createTestCatalogDatabase()
    const pageOnePackages = Array.from({ length: 100 }, (_, index) =>
      createEcosystemsFixture({
        name: `pkg-${index + 1}`,
        downloads: 100_000 - index,
        dependentPackagesCount: 500 - index,
      })
    )
    const pageTwoPackage = createEcosystemsFixture({
      name: "semver",
      description: "The semantic version parser used by npm.",
      homepage: "https://github.com/npm/node-semver#readme",
      registryUrl: "https://www.npmjs.com/package/semver",
      repositoryUrl: "https://github.com/npm/node-semver",
      keywords: ["semver"],
      downloads: 99_000,
      dependentPackagesCount: 4_321,
      repoMetadata: {
        full_name: "npm/node-semver",
        stargazers_count: 5_410,
        topics: ["npm-cli"],
      },
    })
    const requestCalls: Array<{ url: URL; headers: Headers }> = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)

      if (url.includes("/registries/npmjs.org/packages")) {
        const requestUrl = new URL(url)
        requestCalls.push({
          url: requestUrl,
          headers: new Headers(init?.headers),
        })

        if (requestUrl.searchParams.get("page") === "1") {
          return jsonResponse(pageOnePackages)
        }

        if (requestUrl.searchParams.get("page") === "2") {
          return jsonResponse([pageTwoPackage])
        }
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    vi.stubGlobal("fetch", fetchMock)

    try {
      const result = await syncEcosystemsPopular(database.client, {
        ecosystemsBaseUrl: "https://packages.ecosyste.ms/api/v1",
        fromAddress: "me@patrikelfstrom.se",
        syncLimit: 101,
        updatedAfter: "2025-01-01T00:00:00.000Z",
        userAgent: "scriptorium-test/0.1.1",
      })

      expect(result).toEqual({ syncedCount: 101 })

      expect(
        requestCalls.map(({ url }) => ({
          page: url.searchParams.get("page"),
          perPage: url.searchParams.get("per_page"),
          sort: url.searchParams.get("sort"),
          order: url.searchParams.get("order"),
          updatedAfter: url.searchParams.get("updated_after"),
        }))
      ).toEqual([
        {
          page: "1",
          perPage: "100",
          sort: "downloads",
          order: "desc",
          updatedAfter: "2025-01-01T00:00:00.000Z",
        },
        {
          page: "2",
          perPage: "100",
          sort: "downloads",
          order: "desc",
          updatedAfter: "2025-01-01T00:00:00.000Z",
        },
      ])
      expect(requestCalls[0]?.headers.get("Accept")).toBe("application/json")
      expect(requestCalls[0]?.headers.get("User-Agent")).toBe("scriptorium-test/0.1.1")
      expect(requestCalls[0]?.headers.get("From")).toBe("me@patrikelfstrom.se")

      const packageRows = await database.client.execute({
        sql: `
          SELECT
            package_key,
            repository_name,
            description,
            primary_url,
            stars,
            downloads,
            downloads_period,
            dependent_packages_count
          FROM packages
          WHERE package_key = ?
        `,
        args: ["npm:semver"],
      })
      const tagRows = await database.client.execute({
        sql: `
          SELECT source, raw_value
          FROM package_tags
          WHERE package_key = ?
          ORDER BY source ASC, raw_value ASC
        `,
        args: ["npm:semver"],
      })

      expect(packageRows.rows).toHaveLength(1)
      expect(packageRows.rows[0]).toMatchObject({
        package_key: "npm:semver",
        repository_name: "npm/node-semver",
        description: "The semantic version parser used by npm.",
        primary_url: "https://github.com/npm/node-semver#readme",
        stars: 5410,
        downloads: 99000,
        downloads_period: "last-month",
        dependent_packages_count: 4321,
      })
      expect(tagRows.rows).toEqual([
        expect.objectContaining({ source: "github", raw_value: "npm-cli" }),
        expect.objectContaining({ source: "npm", raw_value: "semver" }),
      ])
    } finally {
      await database.cleanup()
    }
  })

  it("falls back to repository_url and registry_url when repo metadata is missing", async () => {
    const database = await createTestCatalogDatabase()
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)

      if (url.includes("/registries/npmjs.org/packages")) {
        return jsonResponse([
          createEcosystemsFixture({
            name: "debug",
            description: "small debugging utility",
            homepage: null,
            registryUrl: "https://www.npmjs.com/package/debug",
            repositoryUrl: "https://github.com/debug-js/debug",
            keywords: ["debug", "logger"],
            downloads: 123456,
            dependentPackagesCount: 789,
            repoMetadata: null,
          }),
        ])
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    vi.stubGlobal("fetch", fetchMock)

    try {
      const result = await syncEcosystemsPopular(database.client, {
        ecosystemsBaseUrl: "https://packages.ecosyste.ms/api/v1",
        fromAddress: "me@patrikelfstrom.se",
        syncLimit: 1,
        updatedAfter: "2025-01-01T00:00:00.000Z",
        userAgent: "scriptorium-test/0.1.1",
      })

      expect(result).toEqual({ syncedCount: 1 })

      const packageRows = await database.client.execute({
        sql: `
          SELECT repository_name, primary_url, stars, downloads, dependent_packages_count
          FROM packages
          WHERE package_key = ?
        `,
        args: ["npm:debug"],
      })
      const githubTags = await database.client.execute({
        sql: `
          SELECT COUNT(*) AS total
          FROM package_tags
          WHERE package_key = ? AND source = 'github'
        `,
        args: ["npm:debug"],
      })

      expect(packageRows.rows).toHaveLength(1)
      expect(packageRows.rows[0]).toMatchObject({
        repository_name: "debug-js/debug",
        primary_url: "https://www.npmjs.com/package/debug",
        stars: null,
        downloads: 123456,
        dependent_packages_count: 789,
      })
      expect(Number(githubTags.rows[0]?.total ?? 0)).toBe(0)
    } finally {
      await database.cleanup()
    }
  })

  it("includes the failing ecosyste.ms request URL in fetch errors", async () => {
    const database = await createTestCatalogDatabase()
    const fetchMock = vi.fn(async () =>
      new Response('{"error":"internal server error"}', {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    try {
      await expect(
        syncEcosystemsPopular(database.client, {
          ecosystemsBaseUrl: "https://packages.ecosyste.ms/api/v1",
          fromAddress: "me@patrikelfstrom.se",
          syncLimit: 1,
          updatedAfter: "2025-01-01T00:00:00.000Z",
          userAgent: "scriptorium-test/0.1.1",
        })
      ).rejects.toThrow(
        'Failed to fetch ecosyste.ms packages from https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages?page=1&per_page=100&updated_after=2025-01-01T00%3A00%3A00.000Z&sort=downloads&order=desc: 500 Internal Server Error'
      )
    } finally {
      await database.cleanup()
    }
  })

  it("destructively resets the catalog schema", async () => {
    const database = await createTestCatalogDatabase()

    try {
      await seedCatalogPackage(database.client, {
        sourceType: "npm",
        sourceName: "react",
        downloads: 1000,
        dependentPackagesCount: 500,
      })
      await database.client.execute(`
        CREATE TABLE raw_jsdelivr_packages (
          package_key TEXT PRIMARY KEY,
          source_type TEXT NOT NULL,
          source_name TEXT NOT NULL,
          hits INTEGER NOT NULL,
          bandwidth INTEGER NOT NULL,
          prev_hits INTEGER,
          prev_bandwidth INTEGER,
          raw_json TEXT NOT NULL,
          fetched_at TEXT NOT NULL
        )
      `)
      await database.client.execute({
        sql: `
          INSERT INTO raw_jsdelivr_packages (
            package_key,
            source_type,
            source_name,
            hits,
            bandwidth,
            prev_hits,
            prev_bandwidth,
            raw_json,
            fetched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          "npm:react",
          "npm",
          "react",
          1000,
          500,
          null,
          null,
          "{}",
          "2026-01-01T00:00:00.000Z",
        ],
      })

      await resetCatalogSchema(database.client)

      const tables = await database.client.execute(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name ASC
      `)
      const packageCount = await database.client.execute(
        "SELECT COUNT(*) AS total FROM packages"
      )

      expect(tables.rows.map((row) => String(row.name))).toEqual(
        expect.arrayContaining([
          "package_tags",
          "packages",
          "raw_ecosystems_packages",
          "tag_aliases",
          "tags",
        ])
      )
      expect(tables.rows.map((row) => String(row.name))).not.toContain(
        "raw_jsdelivr_packages"
      )
      expect(Number(packageCount.rows[0]?.total ?? 0)).toBe(0)
    } finally {
      await database.cleanup()
    }
  })
})

function createEcosystemsFixture(input: {
  name: string
  description?: string | null
  homepage?: string | null
  registryUrl?: string | null
  repositoryUrl?: string | null
  keywords?: string[]
  downloads: number
  dependentPackagesCount: number
  repoMetadata?: Record<string, unknown> | null
}) {
  return {
    id: Math.floor(Math.random() * 100000),
    name: input.name,
    ecosystem: "npm",
    description: input.description ?? `${input.name} description`,
    homepage:
      input.homepage === undefined
        ? `https://example.com/${input.name}`
        : input.homepage,
    licenses: "MIT",
    normalized_licenses: ["MIT"],
    repository_url: input.repositoryUrl ?? `https://github.com/example/${input.name}`,
    keywords_array: input.keywords ?? [input.name],
    namespace: null,
    versions_count: 10,
    first_release_published_at: "2020-01-01T00:00:00.000Z",
    latest_release_published_at: "2026-01-01T00:00:00.000Z",
    latest_release_number: "1.0.0",
    last_synced_at: "2026-04-02T00:00:00.000Z",
    created_at: "2022-01-01T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
    registry_url:
      input.registryUrl ?? `https://www.npmjs.com/package/${encodeURIComponent(input.name)}`,
    install_command: `npm install ${input.name}`,
    documentation_url: null,
    metadata: {},
    repo_metadata:
      input.repoMetadata === undefined
        ? {
            full_name: `example/${input.name}`,
            stargazers_count: 100,
            topics: [input.name],
          }
        : input.repoMetadata,
    repo_metadata_updated_at: "2026-04-02T00:00:00.000Z",
    dependent_packages_count: input.dependentPackagesCount,
    downloads: input.downloads,
    downloads_period: "last-month",
    dependent_repos_count: 100,
    rankings: {},
    purl: `pkg:npm/${input.name}`,
    advisories: [],
    versions_url: `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${encodeURIComponent(
      input.name
    )}/versions`,
    version_numbers_url: `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${encodeURIComponent(
      input.name
    )}/version_numbers`,
    dependent_packages_url: `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${encodeURIComponent(
      input.name
    )}/dependent_packages`,
    related_packages_url: `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${encodeURIComponent(
      input.name
    )}/related_packages`,
    codemeta_url: `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${encodeURIComponent(
      input.name
    )}/codemeta`,
    docker_usage_url: `https://docker.ecosyste.ms/usage/npm/${encodeURIComponent(input.name)}`,
    docker_dependents_count: 0,
    docker_downloads_count: 0,
    usage_url: `https://repos.ecosyste.ms/usage/npm/${encodeURIComponent(input.name)}`,
    dependent_repositories_url: `https://repos.ecosyste.ms/api/v1/usage/npm/${encodeURIComponent(
      input.name
    )}/dependencies`,
    status: null,
    funding_links: [],
    critical: false,
    issue_metadata: {},
    maintainers: [],
  }
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  })
}

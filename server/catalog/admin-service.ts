import type { CatalogDatabaseClient } from "./database"
import {
  createPackageKey,
  createPrimaryUrl,
  createReplacePackageTagsStatements,
  createUpsertPackageStatement,
  replacePackageTags,
  upsertPackage,
  type CatalogPackageRecord,
} from "./package-store"

export async function importAlgoliaPackages(
  client: CatalogDatabaseClient,
  options: ImportAlgoliaPackagesOptions
) {
  const existingCatalogRows = await fetchExistingCatalogRows(client)
  const existingPackageNames = new Set<string>()
  const existingNames = new Set<string>()
  const existingRepositoryNames = new Set<string>()

  for (const row of existingCatalogRows) {
    if (row.display_name) {
      existingNames.add(normalizeValue(String(row.display_name)))
    }

    if (row.npm_package_name) {
      existingPackageNames.add(normalizeValue(String(row.npm_package_name)))
    }

    if (row.repository_name) {
      existingRepositoryNames.add(normalizeValue(String(row.repository_name)))
    }
  }

  const packagesByName = new Map<string, AlgoliaHit>()

  for (const query of options.queries) {
    const hits = await fetchAlgoliaHits(query, options)

    for (const hit of hits) {
      if (!shouldImportHit(hit, options)) {
        continue
      }

      const existingMatch =
        existingPackageNames.has(normalizeValue(hit.name)) ||
        existingNames.has(normalizeValue(hit.name)) ||
        (hit.repositoryName &&
          existingRepositoryNames.has(normalizeValue(hit.repositoryName)))

      if (existingMatch || packagesByName.has(hit.name)) {
        continue
      }

      packagesByName.set(hit.name, hit)
    }
  }

  const selectedHits = Array.from(packagesByName.values())
    .sort(compareAlgoliaHits)
    .slice(0, options.maxImports)

  if (selectedHits.length === 0) {
    return { importedCount: 0 }
  }

  const syncedAt = new Date().toISOString()

  for (const hit of selectedHits) {
    const packageRecord = createImportedNpmPackageRecord(hit, syncedAt)

    await upsertPackage(client, packageRecord)
    await replacePackageTags(client, packageRecord.packageKey, "algolia", hit.keywords)
  }

  return {
    importedCount: selectedHits.length,
  }
}

export async function syncEcosystemsPopular(
  client: CatalogDatabaseClient,
  options: SyncEcosystemsPopularOptions
) {
  options.onProgress?.(
    `Fetching ecosyste.ms npm packages for up to ${options.syncLimit} packages.`
  )
  const packages = await fetchEcosystemsPopularPackages(options)
  const selectedPackages = packages.slice(0, options.syncLimit)
  const fetchedAt = new Date().toISOString()

  options.onProgress?.(
    `Fetched ${selectedPackages.length} ecosyste.ms packages. Writing package records...`
  )

  const writeBatchSize = 25
  const progressIntervalMs = 60_000
  let lastWriteProgressAt = Date.now()

  for (let index = 0; index < selectedPackages.length; index += writeBatchSize) {
    const batch = selectedPackages.slice(index, index + writeBatchSize)
    const statements = batch.flatMap((ecosystemPackage) => {
      const packageRecord = createEcosystemsPackageRecord(ecosystemPackage, fetchedAt)

      return [
        createUpsertRawEcosystemsPackageStatement(ecosystemPackage, fetchedAt),
        createUpsertPackageStatement(packageRecord),
        ...createReplacePackageTagsStatements(
          packageRecord.packageKey,
          "npm",
          ecosystemPackage.npmTags
        ),
        ...createReplacePackageTagsStatements(
          packageRecord.packageKey,
          "github",
          ecosystemPackage.githubTags
        ),
      ]
    })

    await client.batch(statements, "write")

    const storedCount = Math.min(index + writeBatchSize, selectedPackages.length)
    const now = Date.now()

    if (
      now - lastWriteProgressAt >= progressIntervalMs ||
      storedCount === selectedPackages.length
    ) {
      options.onProgress?.(
        `Stored ${storedCount}/${selectedPackages.length} ecosyste.ms packages.`
      )
      lastWriteProgressAt = now
    }
  }

  return {
    syncedCount: selectedPackages.length,
  }
}

export async function syncNpmMetadata(
  client: CatalogDatabaseClient,
  options: SyncNpmMetadataOptions
) {
  const catalogRows = await client.execute(`
    SELECT package_key, npm_package_name
    FROM packages
    WHERE is_active = 1 AND npm_package_name IS NOT NULL AND npm_package_name <> ''
  `)
  const packageNames = Array.from(
    new Set(
      catalogRows.rows
        .map((row) => normalizeOptionalString(row.npm_package_name))
        .filter((value): value is string => Boolean(value))
    )
  )

  const metadataByPackageName = await fetchPackageMetadata(packageNames, options)
  let updatedProjectCount = 0

  for (const row of catalogRows.rows) {
    const packageName = normalizeOptionalString(row.npm_package_name)

    if (!packageName) {
      continue
    }

    const metadata = metadataByPackageName.get(packageName)

    if (!metadata) {
      continue
    }

    await client.execute({
      sql: `
        UPDATE packages
        SET
          npm_package_name = ?,
          description = ?,
          primary_url = CASE
            WHEN primary_url IS NULL OR primary_url = '' THEN ?
            ELSE primary_url
          END,
          repository_name = COALESCE(repository_name, ?),
          npm_synced_at = ?
        WHERE package_key = ?
      `,
      args: [
        packageName,
        metadata.description,
        metadata.homepage ?? metadata.npmPackageUrl,
        metadata.repositoryName ?? null,
        metadata.syncedAt,
        row.package_key,
      ],
    })

    await replacePackageTags(client, String(row.package_key), "npm", metadata.keywords)
    updatedProjectCount += 1
  }

  return {
    updatedCount: updatedProjectCount,
    packageCount: packageNames.length,
  }
}

export async function syncGitHubMetadata(
  client: CatalogDatabaseClient,
  options: SyncGitHubMetadataOptions
) {
  const catalogRows = await client.execute(`
    SELECT package_key, repository_name
    FROM packages
    WHERE is_active = 1 AND repository_name IS NOT NULL AND repository_name <> ''
  `)
  const repositoryNames = Array.from(
    new Set(
      catalogRows.rows
        .map((row) => normalizeOptionalString(row.repository_name))
        .filter((value): value is string => Boolean(value))
    )
  )

  const metadataByRepository = await fetchRepositoryMetadata(repositoryNames, options)
  let updatedProjectCount = 0

  for (const row of catalogRows.rows) {
    const repositoryName = normalizeOptionalString(row.repository_name)

    if (!repositoryName) {
      continue
    }

    const metadata = metadataByRepository.get(repositoryName)

    if (!metadata) {
      continue
    }

    await client.execute({
      sql: `
        UPDATE packages
        SET
          stars = ?,
          github_synced_at = ?
        WHERE package_key = ?
      `,
      args: [metadata.stars, metadata.syncedAt, row.package_key],
    })

    await replacePackageTags(client, String(row.package_key), "github", metadata.topics)
    updatedProjectCount += 1
  }

  return {
    updatedCount: updatedProjectCount,
    repositoryCount: repositoryNames.length,
  }
}

export type ImportAlgoliaPackagesOptions = {
  queries: string[]
  algoliaAppId: string
  algoliaApiKey: string
  algoliaIndexName: string
  hitsPerQuery: number
  maxImports: number
  minDownloadsLast30Days: number
  modernWithinDays: number
}

export type SyncEcosystemsPopularOptions = {
  ecosystemsBaseUrl: string
  fromAddress: string
  onProgress?: (message: string) => void
  syncLimit: number
  updatedAfter: string
  userAgent: string
}

export type SyncNpmMetadataOptions = {
  npmRegistryBaseUrl: string
}

export type SyncGitHubMetadataOptions = {
  githubApiBaseUrl: string
  githubToken?: string
}

type AlgoliaHit = {
  name: string
  description: string
  homepage?: string
  repositoryName?: string
  keywords: string[]
  popular: boolean
  downloadsLast30Days: number
  modified?: Date
  isDeprecated: boolean
  badPackage: boolean
  isSecurityHeld: boolean
}

type EcosystemsPackage = {
  name: string
  description: string | undefined
  primaryUrl: string | undefined
  repositoryName: string | undefined
  stars: number | null
  downloads: number
  downloadsPeriod: string | null
  dependentPackagesCount: number
  npmTags: string[]
  githubTags: string[]
  rawJson: string
}

function createImportedNpmPackageRecord(
  hit: AlgoliaHit,
  syncedAt: string
): CatalogPackageRecord {
  return {
    packageKey: createPackageKey("npm", hit.name),
    sourceType: "npm",
    sourceName: hit.name,
    displayName: hit.name,
    searchName: hit.name.trim().toLowerCase(),
    description: hit.description,
    primaryUrl: hit.homepage ?? createPrimaryUrl("npm", hit.name),
    repositoryName: hit.repositoryName ?? null,
    npmPackageName: hit.name,
    stars: null,
    downloads: 0,
    downloadsPeriod: null,
    dependentPackagesCount: 0,
    rawEcosystemsFetchedAt: syncedAt,
    npmSyncedAt: syncedAt,
    githubSyncedAt: null,
    isActive: 1,
  }
}

function createEcosystemsPackageRecord(
  ecosystemPackage: EcosystemsPackage,
  fetchedAt: string
): CatalogPackageRecord {
  return {
    packageKey: createPackageKey("npm", ecosystemPackage.name),
    sourceType: "npm",
    sourceName: ecosystemPackage.name,
    displayName: ecosystemPackage.name,
    searchName: ecosystemPackage.name.trim().toLowerCase(),
    description: ecosystemPackage.description ?? null,
    primaryUrl:
      ecosystemPackage.primaryUrl ?? createPrimaryUrl("npm", ecosystemPackage.name),
    repositoryName: ecosystemPackage.repositoryName ?? null,
    npmPackageName: ecosystemPackage.name,
    stars: ecosystemPackage.stars,
    downloads: ecosystemPackage.downloads,
    downloadsPeriod: ecosystemPackage.downloadsPeriod,
    dependentPackagesCount: ecosystemPackage.dependentPackagesCount,
    rawEcosystemsFetchedAt: fetchedAt,
    npmSyncedAt: null,
    githubSyncedAt: null,
    isActive: 1,
  }
}

async function fetchExistingCatalogRows(client: CatalogDatabaseClient) {
  const result = await client.execute(`
    SELECT display_name, npm_package_name, repository_name
    FROM packages
    WHERE is_active = 1
  `)

  return result.rows
}

async function fetchAlgoliaHits(
  query: string,
  options: ImportAlgoliaPackagesOptions
) {
  const response = await fetch(
    `https://${options.algoliaAppId}-dsn.algolia.net/1/indexes/${encodeURIComponent(
      options.algoliaIndexName
    )}/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-algolia-api-key": options.algoliaApiKey,
        "x-algolia-application-id": options.algoliaAppId,
      },
      body: JSON.stringify({
        query,
        hitsPerPage: options.hitsPerQuery,
        attributesToRetrieve: [
          "name",
          "description",
          "homepage",
          "repository",
          "keywords",
          "popular",
          "downloadsLast30Days",
          "modified",
          "deprecated",
          "isDeprecated",
          "badPackage",
          "isSecurityHeld",
        ],
      }),
    }
  )

  if (!response.ok) {
    const details = await response.text()
    throw new Error(
      `Failed to query Algolia for "${query}": ${response.status} ${response.statusText}\n${details}`
    )
  }

  const payload = await response.json()

  if (!Array.isArray(payload.hits)) {
    throw new Error(`Algolia response for "${query}" did not include hits.`)
  }

  return payload.hits
    .map((hit: unknown) => mapAlgoliaHit(hit))
    .filter((hit: AlgoliaHit | undefined): hit is AlgoliaHit => Boolean(hit))
}

function mapAlgoliaHit(hit: unknown) {
  if (!hit || typeof hit !== "object") {
    return undefined
  }

  const candidate = hit as Record<string, unknown>
  const name = normalizeOptionalString(candidate.name)
  const description = normalizeOptionalString(candidate.description)

  if (!name || !description) {
    return undefined
  }

  return {
    name,
    description,
    homepage: normalizeUrl(candidate.homepage),
    repositoryName: extractGitHubRepositoryName(candidate.repository),
    keywords: normalizeStringArray(candidate.keywords),
    popular: candidate.popular === true,
    downloadsLast30Days: normalizeInteger(candidate.downloadsLast30Days),
    modified: normalizeModifiedTimestamp(candidate.modified),
    isDeprecated: Boolean(candidate.isDeprecated || candidate.deprecated),
    badPackage: candidate.badPackage === true,
    isSecurityHeld: candidate.isSecurityHeld === true,
  }
}

function shouldImportHit(
  hit: AlgoliaHit,
  options: ImportAlgoliaPackagesOptions
) {
  if (hit.isDeprecated || hit.badPackage || hit.isSecurityHeld) {
    return false
  }

  if (!hit.popular) {
    return false
  }

  if (hit.downloadsLast30Days < options.minDownloadsLast30Days) {
    return false
  }

  if (!hit.modified) {
    return false
  }

  const modernCutoff = new Date()
  modernCutoff.setUTCDate(modernCutoff.getUTCDate() - options.modernWithinDays)

  return hit.modified >= modernCutoff
}

function compareAlgoliaHits(left: AlgoliaHit, right: AlgoliaHit) {
  return (
    right.downloadsLast30Days - left.downloadsLast30Days ||
    left.name.localeCompare(right.name)
  )
}

async function fetchEcosystemsPopularPackages(options: SyncEcosystemsPopularOptions) {
  const pageSize = 100
  const packages: EcosystemsPackage[] = []

  for (let page = 1; packages.length < options.syncLimit; page += 1) {
    const requestUrl = new URL(
      `${stripTrailingSlash(options.ecosystemsBaseUrl)}/registries/npmjs.org/packages`
    )

    requestUrl.searchParams.set("page", String(page))
    requestUrl.searchParams.set("per_page", String(pageSize))
    requestUrl.searchParams.set("updated_after", options.updatedAfter)
    requestUrl.searchParams.set("sort", "downloads")
    requestUrl.searchParams.set("order", "desc")

    options.onProgress?.(`Fetching ecosyste.ms page ${page} (${pageSize} packages requested).`)

    const response = await fetch(requestUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": options.userAgent,
        From: options.fromAddress,
      },
    })

    if (!response.ok) {
      const details = await response.text()
      throw new Error(
        `Failed to fetch ecosyste.ms packages from ${requestUrl.toString()}: ${response.status} ${response.statusText}\n${details}`
      )
    }

    const payload = await response.json()

    if (!Array.isArray(payload)) {
      throw new Error("Expected ecosyste.ms packages endpoint to return an array.")
    }

    const normalizedEntries = payload
      .map((entry) => normalizeEcosystemsPackage(entry))
      .filter((entry): entry is EcosystemsPackage => Boolean(entry))

    packages.push(...normalizedEntries)

    options.onProgress?.(
      `Fetched ecosyste.ms page ${page}; accumulated ${packages.length}/${options.syncLimit} packages.`
    )

    if (payload.length < pageSize) {
      break
    }
  }

  return packages.slice(0, options.syncLimit)
}

function normalizeEcosystemsPackage(entry: unknown) {
  if (!entry || typeof entry !== "object") {
    return undefined
  }

  const candidate = entry as Record<string, unknown>
  const name = normalizeOptionalString(candidate.name)

  if (!name) {
    return undefined
  }

  const repoMetadata =
    candidate.repo_metadata && typeof candidate.repo_metadata === "object"
      ? (candidate.repo_metadata as Record<string, unknown>)
      : undefined
  const repositoryName =
    normalizeOptionalString(repoMetadata?.full_name) ??
    extractGitHubRepositoryName(candidate.repository_url)

  return {
    name,
    description: normalizeOptionalString(candidate.description),
    primaryUrl:
      normalizeUrl(candidate.homepage) ??
      normalizeUrl(candidate.registry_url) ??
      undefined,
    repositoryName,
    stars: normalizeNullableInteger(repoMetadata?.stargazers_count),
    downloads: normalizeInteger(candidate.downloads),
    downloadsPeriod: normalizeOptionalString(candidate.downloads_period) ?? null,
    dependentPackagesCount: normalizeInteger(candidate.dependent_packages_count),
    npmTags: normalizeStringArray(candidate.keywords_array),
    githubTags: normalizeStringArray(repoMetadata?.topics),
    rawJson: JSON.stringify(entry),
  }
}

function createUpsertRawEcosystemsPackageStatement(
  ecosystemPackage: EcosystemsPackage,
  fetchedAt: string
) {
  return {
    sql: `
      INSERT INTO raw_ecosystems_packages (
        package_key,
        source_type,
        source_name,
        downloads,
        downloads_period,
        dependent_packages_count,
        raw_json,
        fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(package_key) DO UPDATE SET
        downloads = excluded.downloads,
        downloads_period = excluded.downloads_period,
        dependent_packages_count = excluded.dependent_packages_count,
        raw_json = excluded.raw_json,
        fetched_at = excluded.fetched_at
    `,
    args: [
      createPackageKey("npm", ecosystemPackage.name),
      "npm",
      ecosystemPackage.name,
      ecosystemPackage.downloads,
      ecosystemPackage.downloadsPeriod,
      ecosystemPackage.dependentPackagesCount,
      ecosystemPackage.rawJson,
      fetchedAt,
    ],
  }
}

async function fetchPackageMetadata(
  packageNames: string[],
  options: SyncNpmMetadataOptions
) {
  const metadataByPackageName = new Map<string, NpmPackageMetadata>()
  const batchSize = 8

  for (let index = 0; index < packageNames.length; index += batchSize) {
    const batch = packageNames.slice(index, index + batchSize)
    const entries = await Promise.all(
      batch.map(async (packageName) => [
        packageName,
        await fetchSinglePackageMetadata(packageName, options.npmRegistryBaseUrl),
      ] as const)
    )

    for (const [packageName, metadata] of entries) {
      metadataByPackageName.set(packageName, metadata)
    }
  }

  return metadataByPackageName
}

type NpmPackageMetadata = {
  description: string
  homepage?: string
  keywords: string[]
  npmPackageUrl: string
  repositoryName?: string
  syncedAt: string
}

type PackageManifestLike = {
  keywords?: unknown
  repository?: unknown
  description?: unknown
  homepage?: unknown
}

type NpmPackument = PackageManifestLike & {
  "dist-tags"?: {
    latest?: unknown
  }
  versions?: Record<string, unknown>
}

async function fetchSinglePackageMetadata(
  packageName: string,
  npmRegistryBaseUrl: string
): Promise<NpmPackageMetadata> {
  const packageUrl = `${npmRegistryBaseUrl}/${encodeURIComponent(packageName)}`
  const response = await fetch(packageUrl, {
    headers: {
      Accept: "application/json",
    },
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(
      `Failed to fetch ${packageName}: ${response.status} ${response.statusText}\n${details}`
    )
  }

  const packument = await response.json()
  const latestVersion = resolveLatestVersion(packument)
  const description = normalizeOptionalString(
    latestVersion?.description ?? packument?.description
  )

  if (!description) {
    throw new Error(`npm response for ${packageName} is missing description.`)
  }

  return {
    description,
    homepage: normalizeOptionalString(latestVersion?.homepage ?? packument?.homepage),
    keywords: normalizeStringArray(latestVersion?.keywords ?? packument?.keywords),
    npmPackageUrl: createPrimaryUrl("npm", packageName) ?? "",
    repositoryName: extractGitHubRepositoryName(
      latestVersion?.repository ?? packument?.repository
    ),
    syncedAt: new Date().toISOString(),
  }
}

async function fetchRepositoryMetadata(
  repositoryNames: string[],
  options: SyncGitHubMetadataOptions
) {
  const metadataByRepository = new Map<string, GitHubMetadata>()
  const batchSize = 8

  for (let index = 0; index < repositoryNames.length; index += batchSize) {
    const batch = repositoryNames.slice(index, index + batchSize)
    const entries = await Promise.all(
      batch.map(async (repositoryName) => [
        repositoryName,
        await fetchSingleRepositoryMetadata(repositoryName, options),
      ] as const)
    )

    for (const [repositoryName, metadata] of entries) {
      if (metadata) {
        metadataByRepository.set(repositoryName, metadata)
      }
    }
  }

  return metadataByRepository
}

type GitHubMetadata = {
  stars: number
  topics: string[]
  syncedAt: string
}

async function fetchSingleRepositoryMetadata(
  repositoryName: string,
  options: SyncGitHubMetadataOptions
): Promise<GitHubMetadata | undefined> {
  const response = await fetch(`${options.githubApiBaseUrl}/repos/${repositoryName}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(options.githubToken
        ? {
            Authorization: `Bearer ${options.githubToken}`,
          }
        : {}),
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })

  if (response.status === 404) {
    return undefined
  }

  if (!response.ok) {
    const details = await response.text()
    throw new Error(
      `Failed to fetch ${repositoryName}: ${response.status} ${response.statusText}\n${details}`
    )
  }

  const repository = await response.json()

  if (!Number.isInteger(repository.stargazers_count)) {
    throw new Error(`GitHub response for ${repositoryName} is missing stars.`)
  }

  return {
    stars: repository.stargazers_count,
    topics: normalizeStringArray(repository.topics),
    syncedAt: new Date().toISOString(),
  }
}

function resolveLatestVersion(packument: NpmPackument) {
  const latestTag =
    typeof packument["dist-tags"]?.latest === "string"
      ? packument["dist-tags"].latest
      : undefined
  const candidate = latestTag ? packument.versions?.[latestTag] : undefined

  if (!candidate || typeof candidate !== "object") {
    return undefined
  }

  return candidate as PackageManifestLike
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function normalizeUrl(value: unknown) {
  const normalizedValue = normalizeOptionalString(value)
  return normalizedValue && /^https?:\/\//i.test(normalizedValue)
    ? normalizedValue
    : undefined
}

function normalizeModifiedTimestamp(value: unknown) {
  if (typeof value !== "string") {
    return undefined
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function normalizeInteger(value: unknown) {
  return Number.isFinite(value) ? Math.trunc(value as number) : 0
}

function normalizeNullableInteger(value: unknown) {
  return Number.isFinite(value) ? Math.trunc(value as number) : null
}

function normalizeValue(value: string) {
  return value.trim().toLowerCase()
}

function extractGitHubRepositoryName(repository: unknown) {
  if (typeof repository === "string") {
    return parseGitHubRepositoryName(repository)
  }

  if (!repository || typeof repository !== "object") {
    return undefined
  }

  if (typeof (repository as { url?: unknown }).url === "string") {
    return parseGitHubRepositoryName((repository as { url: string }).url)
  }

  return undefined
}

function parseGitHubRepositoryName(value: string) {
  const normalizedValue = value
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "")

  const shorthandMatch = normalizedValue.match(/^github:([^/]+\/[^/]+)$/i)

  if (shorthandMatch) {
    return shorthandMatch[1]
  }

  const urlMatch = normalizedValue.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)$/i
  )

  if (urlMatch) {
    return urlMatch[1]
  }

  const gitProtocolMatch = normalizedValue.match(
    /^git:\/\/github\.com\/([^/]+\/[^/]+)$/i
  )

  if (gitProtocolMatch) {
    return gitProtocolMatch[1]
  }

  const sshMatch = normalizedValue.match(/^git@github\.com:([^/]+\/[^/]+)$/i)

  if (sshMatch) {
    return sshMatch[1]
  }

  return undefined
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "")
}

import type { InStatement } from "@libsql/client"

import type { CatalogDatabaseClient } from "./database"
import {
  DERIVED_CATALOG_DIRTY_ACTIVE_STATUS,
  DERIVED_CATALOG_DIRTY_FAILED_STATUS,
  DERIVED_CATALOG_DIRTY_TABLE,
  createClearRepairableDerivedCatalogDirtyStatements,
  createDropDerivedCatalogDirtyTableStatements,
  createFailDerivedCatalogDirtyStatements,
  createRebuildPackageSearchStatements,
  createRebuildTagStatsStatements,
  dropDerivedCatalogDirtyTableIfEmpty,
} from "./package-store"

const STALE_ACTIVE_DERIVED_MARKER_MS = 2 * 60 * 60 * 1000
const MALFORMED_DERIVED_DIRTY_SYNC_ID = "schema-repair-malformed-marker"

const EXPECTED_TABLE_COLUMNS = {
  packages: [
    "package_name",
    "repository_url",
    "package_url",
    "package_description",
    "homepage_url",
    "repository_stars",
    "package_downloads",
    "package_downloads_period",
    "package_last_published_at",
    "last_synced_at",
  ],
  package_tags: ["package_name", "tag_id", "raw_value"],
  repository_tags: ["package_name", "tag_id", "raw_value"],
  tags: ["tag_id", "label"],
  tag_aliases: ["alias", "tag_id"],
  tag_stats: ["tag_id", "package_count"],
  catalog_meta: ["meta_key", "meta_value"],
} as const

const DERIVED_TABLE_DEPENDENCIES = [
  "packages",
  "package_tags",
  "repository_tags",
  "tags",
] as const

const REBUILDABLE_DERIVED_TABLES = ["package_search_fts", "tag_stats"] as const
const EXPECTED_DERIVED_CATALOG_DIRTY_COLUMNS = [
  "sync_id",
  "marked_at",
  "status",
  "updated_at",
] as const

const CATALOG_TABLE_NAMES = [
  ...Object.keys(EXPECTED_TABLE_COLUMNS),
  ...REBUILDABLE_DERIVED_TABLES,
]

const schemaStatements: InStatement[] = [
  `
    CREATE TABLE IF NOT EXISTS packages (
      package_name TEXT PRIMARY KEY,
      repository_url TEXT,
      package_url TEXT NOT NULL,
      package_description TEXT,
      homepage_url TEXT,
      repository_stars INTEGER,
      package_downloads INTEGER NOT NULL,
      package_downloads_period TEXT,
      package_last_published_at TEXT,
      last_synced_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS tags (
      tag_id TEXT PRIMARY KEY,
      label TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS package_tags (
      package_name TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      raw_value TEXT NOT NULL,
      PRIMARY KEY (package_name, tag_id, raw_value),
      FOREIGN KEY (package_name) REFERENCES packages(package_name) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS repository_tags (
      package_name TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      raw_value TEXT NOT NULL,
      PRIMARY KEY (package_name, tag_id, raw_value),
      FOREIGN KEY (package_name) REFERENCES packages(package_name) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS tag_aliases (
      alias TEXT PRIMARY KEY,
      tag_id TEXT NOT NULL,
      FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS tag_stats (
      tag_id TEXT PRIMARY KEY,
      package_count INTEGER NOT NULL,
      FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS catalog_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL
    )
  `,
  `
    INSERT INTO catalog_meta (meta_key, meta_value)
    VALUES ('tags_version', '0')
    ON CONFLICT(meta_key) DO NOTHING
  `,
  `
    CREATE VIRTUAL TABLE IF NOT EXISTS package_search_fts
    USING fts5(
      package_name UNINDEXED,
      search_text,
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS packages_downloads_idx
    ON packages(package_downloads DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS packages_name_nocase_idx
    ON packages(package_name COLLATE NOCASE)
  `,
  `
    CREATE INDEX IF NOT EXISTS packages_repository_stars_name_idx
    ON packages(repository_stars DESC, package_name COLLATE NOCASE)
  `,
  `
    CREATE INDEX IF NOT EXISTS packages_last_published_at_name_idx
    ON packages(package_last_published_at DESC, package_name COLLATE NOCASE)
  `,
  `
    CREATE INDEX IF NOT EXISTS package_tags_tag_id_idx
    ON package_tags(tag_id, package_name)
  `,
  `
    CREATE INDEX IF NOT EXISTS package_tags_package_name_idx
    ON package_tags(package_name, tag_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS repository_tags_tag_id_idx
    ON repository_tags(tag_id, package_name)
  `,
  `
    CREATE INDEX IF NOT EXISTS repository_tags_package_name_idx
    ON repository_tags(package_name, tag_id)
  `,
]

const obsoleteIndexDropStatements: InStatement[] = [
  "DROP INDEX IF EXISTS packages_package_name_idx",
  "DROP INDEX IF EXISTS packages_last_published_at_idx",
  "DROP INDEX IF EXISTS packages_repository_stars_idx",
]

const destructiveResetStatements: InStatement[] = [
  "DROP INDEX IF EXISTS repository_tags_package_name_idx",
  "DROP INDEX IF EXISTS repository_tags_tag_id_idx",
  "DROP INDEX IF EXISTS package_tags_package_name_idx",
  "DROP INDEX IF EXISTS package_tags_tag_id_idx",
  "DROP INDEX IF EXISTS packages_last_published_at_name_idx",
  "DROP INDEX IF EXISTS packages_repository_stars_name_idx",
  "DROP INDEX IF EXISTS packages_name_nocase_idx",
  "DROP INDEX IF EXISTS packages_package_name_idx",
  "DROP INDEX IF EXISTS packages_last_published_at_idx",
  "DROP INDEX IF EXISTS packages_repository_stars_idx",
  "DROP INDEX IF EXISTS packages_downloads_idx",
  "DROP INDEX IF EXISTS packages_dependent_packages_count_idx",
  "DROP INDEX IF EXISTS packages_stars_idx",
  "DROP INDEX IF EXISTS packages_search_name_idx",
  "DROP INDEX IF EXISTS packages_source_type_idx",
  "DROP INDEX IF EXISTS packages_hits_idx",
  "DROP TABLE IF EXISTS repository_tags",
  "DROP TABLE IF EXISTS package_tags",
  `DROP TABLE IF EXISTS ${DERIVED_CATALOG_DIRTY_TABLE}`,
  "DROP TABLE IF EXISTS package_search_fts",
  "DROP TABLE IF EXISTS tag_aliases",
  "DROP TABLE IF EXISTS tag_stats",
  "DROP TABLE IF EXISTS catalog_meta",
  "DROP TABLE IF EXISTS tags",
  "DROP TABLE IF EXISTS packages",
  "DROP TABLE IF EXISTS raw_ecosystems_packages",
  "DROP TABLE IF EXISTS raw_jsdelivr_packages",
]

export async function ensureCatalogSchema(client: CatalogDatabaseClient) {
  const snapshot = await getCatalogSchemaSnapshot(client)
  const hasLegacySchema = hasLegacyCatalogSchema(snapshot)
  const hasMalformedDerivedDirtyTable =
    !hasLegacySchema && hasMalformedDerivedCatalogDirtyTable(snapshot)
  const missingTables = hasLegacySchema
    ? new Set<string>()
    : getMissingCatalogTables(snapshot)
  const staleActiveMarkedBefore = createStaleActiveDerivedMarkerCutoff()
  const dirtyState =
    !hasLegacySchema &&
    !hasMalformedDerivedDirtyTable &&
    snapshot.existingTables.has(DERIVED_CATALOG_DIRTY_TABLE)
      ? await getDerivedCatalogDirtyState(client, staleActiveMarkedBefore)
      : { hasAnyRows: false, hasRepairableRows: false }
  const hasRepairableDirtyRows = dirtyState.hasRepairableRows
  const hasDirtyDerivedCatalogData =
    hasMalformedDerivedDirtyTable || hasRepairableDirtyRows

  if (hasLegacySchema) {
    await applyStatements(client, destructiveResetStatements)
  }

  if (hasMalformedDerivedDirtyTable) {
    await applyStatements(client, [
      ...createDropDerivedCatalogDirtyTableStatements(),
      ...createFailDerivedCatalogDirtyStatements(
        MALFORMED_DERIVED_DIRTY_SYNC_ID,
        new Date().toISOString()
      ),
    ])
  }

  await applyStatements(client, obsoleteIndexDropStatements)
  await applyStatements(client, schemaStatements)

  if (
    hasLegacySchema ||
    hasDirtyDerivedCatalogData ||
    shouldRebuildDerivedTable(missingTables, "package_search_fts")
  ) {
    await applyStatements(client, createRebuildPackageSearchStatements())
  }

  if (
    hasLegacySchema ||
    hasDirtyDerivedCatalogData ||
    shouldRebuildDerivedTable(missingTables, "tag_stats")
  ) {
    await applyStatements(client, createRebuildTagStatsStatements())
  }

  if (hasDirtyDerivedCatalogData) {
    await applyStatements(
      client,
      createClearRepairableDerivedCatalogDirtyStatements(
        staleActiveMarkedBefore
      )
    )
  }

  if (
    snapshot.existingTables.has(DERIVED_CATALOG_DIRTY_TABLE) &&
    (hasDirtyDerivedCatalogData || !dirtyState.hasAnyRows)
  ) {
    await dropDerivedCatalogDirtyTableIfEmpty(client)
  }
}

export async function resetCatalogSchema(client: CatalogDatabaseClient) {
  await applyStatements(client, destructiveResetStatements)
  await applyStatements(client, schemaStatements)
  await applyStatements(client, createRebuildPackageSearchStatements())
  await applyStatements(client, createRebuildTagStatsStatements())
}

async function applyStatements(
  client: CatalogDatabaseClient,
  statements: InStatement[]
) {
  if (statements.length === 0) {
    return
  }

  await client.batch(statements, "write")
}

type CatalogSchemaSnapshot = {
  columnsByTable: Map<string, string[]>
  existingTables: Set<string>
}

async function getCatalogSchemaSnapshot(client: CatalogDatabaseClient) {
  const tableNames = [...CATALOG_TABLE_NAMES, DERIVED_CATALOG_DIRTY_TABLE]
  const placeholders = tableNames.map(() => "?").join(", ")
  const result = await client.execute({
    sql: `
      SELECT
        m.name AS table_name,
        p.name AS column_name
      FROM sqlite_master m
      LEFT JOIN pragma_table_info(m.name) p
      WHERE m.type = 'table'
        AND m.name IN (${placeholders})
      ORDER BY m.name ASC, p.cid ASC
    `,
    args: tableNames,
  })
  const snapshot: CatalogSchemaSnapshot = {
    columnsByTable: new Map(),
    existingTables: new Set(),
  }

  for (const row of result.rows) {
    const tableName = String(row.table_name)
    snapshot.existingTables.add(tableName)

    if (row.column_name === null) {
      continue
    }

    const columns = snapshot.columnsByTable.get(tableName) ?? []
    columns.push(String(row.column_name))
    snapshot.columnsByTable.set(tableName, columns)
  }

  return snapshot
}

function hasLegacyCatalogSchema(snapshot: CatalogSchemaSnapshot) {
  for (const [tableName, expectedColumns] of Object.entries(
    EXPECTED_TABLE_COLUMNS
  )) {
    const currentColumns = snapshot.columnsByTable.get(tableName)

    if (!currentColumns) {
      continue
    }

    const currentColumnSet = new Set(currentColumns)

    if (
      currentColumns.length !== expectedColumns.length ||
      expectedColumns.some((column) => !currentColumnSet.has(column))
    ) {
      return true
    }
  }

  return false
}

function hasMalformedDerivedCatalogDirtyTable(snapshot: CatalogSchemaSnapshot) {
  const currentColumns = snapshot.columnsByTable.get(
    DERIVED_CATALOG_DIRTY_TABLE
  )

  if (!currentColumns) {
    return false
  }

  const currentColumnSet = new Set(currentColumns)

  return (
    currentColumns.length !== EXPECTED_DERIVED_CATALOG_DIRTY_COLUMNS.length ||
    EXPECTED_DERIVED_CATALOG_DIRTY_COLUMNS.some(
      (column) => !currentColumnSet.has(column)
    )
  )
}

function getMissingCatalogTables(snapshot: CatalogSchemaSnapshot) {
  return new Set(
    CATALOG_TABLE_NAMES.filter(
      (tableName) => !snapshot.existingTables.has(tableName)
    )
  )
}

function shouldRebuildDerivedTable(
  missingTables: Set<string>,
  derivedTable: (typeof REBUILDABLE_DERIVED_TABLES)[number]
) {
  return (
    missingTables.has(derivedTable) ||
    DERIVED_TABLE_DEPENDENCIES.some((tableName) => missingTables.has(tableName))
  )
}

async function getDerivedCatalogDirtyState(
  client: CatalogDatabaseClient,
  staleActiveMarkedBefore: string
) {
  const result = await client.execute({
    sql: `
      SELECT
        EXISTS (
          SELECT 1
          FROM ${DERIVED_CATALOG_DIRTY_TABLE}
        ) AS has_any_rows,
        EXISTS (
          SELECT 1
          FROM ${DERIVED_CATALOG_DIRTY_TABLE}
          WHERE status = ?
            OR (
              status = ?
              AND marked_at <= ?
            )
        ) AS has_repairable_rows
    `,
    args: [
      DERIVED_CATALOG_DIRTY_FAILED_STATUS,
      DERIVED_CATALOG_DIRTY_ACTIVE_STATUS,
      staleActiveMarkedBefore,
    ],
  })

  return {
    hasAnyRows: Number(result.rows[0]?.has_any_rows ?? 0) === 1,
    hasRepairableRows: Number(result.rows[0]?.has_repairable_rows ?? 0) === 1,
  }
}

function createStaleActiveDerivedMarkerCutoff() {
  return new Date(Date.now() - STALE_ACTIVE_DERIVED_MARKER_MS).toISOString()
}

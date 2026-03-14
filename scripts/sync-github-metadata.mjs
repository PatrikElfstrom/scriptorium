import { readFile, writeFile } from "node:fs/promises"
import { parseDocument, isMap, isScalar, isSeq } from "yaml"

const toolingPath = process.env.TOOLING_PATH
  ? new URL(process.env.TOOLING_PATH, `file://${process.cwd()}/`)
  : new URL("../src/data/tooling.yaml", import.meta.url)
const githubToken = process.env.GITHUB_TOKEN
const githubApiBaseUrl =
  process.env.GITHUB_API_BASE_URL ?? "https://api.github.com"

const source = await readFile(toolingPath, "utf8")
const document = parseDocument(source)
const projectsNode = document.get("projects", true)

if (!isSeq(projectsNode)) {
  throw new Error("tooling.yaml must include a projects array.")
}

const repositoryNames = []

for (const projectNode of projectsNode.items) {
  if (!isMap(projectNode)) {
    throw new Error("Each project entry in tooling.yaml must be an object.")
  }

  const repositoryName = readOptionalString(projectNode.get("repository_name"))

  if (repositoryName) {
    repositoryNames.push(repositoryName)
  }
}

const uniqueRepositoryNames = Array.from(new Set(repositoryNames))
const metadataByRepository = await fetchRepositoryMetadata(uniqueRepositoryNames)

let updatedProjectCount = 0

for (const projectNode of projectsNode.items) {
  const repositoryName = readOptionalString(projectNode.get("repository_name"))

  if (!repositoryName) {
    continue
  }

  const metadata = metadataByRepository.get(repositoryName)

  if (!metadata) {
    continue
  }

  let projectChanged = false
  const currentStars = projectNode.get("stars")

  if (currentStars !== metadata.stars) {
    projectNode.set("stars", metadata.stars)
    projectChanged = true
  }

  if (shouldSyncTagsFromGitHub(projectNode)) {
    const nextTopics = metadata.topics.toSorted((left, right) =>
      left.localeCompare(right),
    )
    const currentTags = readStringArray(projectNode.get("tags"))

    if (!stringArraysEqual(currentTags, nextTopics)) {
      projectNode.set("tags", nextTopics)
      projectChanged = true
    }
  }

  if (projectChanged) {
    updatedProjectCount += 1
  }
}

const nextSource = document.toString()

if (nextSource === source) {
  console.log("GitHub metadata is already up to date.")
  process.exit(0)
}

await writeFile(toolingPath, nextSource)

console.log(
  `Updated ${updatedProjectCount} project entries across ${uniqueRepositoryNames.length} repositories.`,
)

function readOptionalString(value) {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readStringArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string")
  }

  if (!isSeq(value)) {
    return []
  }

  return value.items
    .map((item) => {
      if (typeof item === "string") {
        return item
      }

      if (isScalar(item) && typeof item.value === "string") {
        return item.value
      }

      return undefined
    })
    .filter((item) => typeof item === "string")
}

function shouldSyncTagsFromGitHub(projectNode) {
  const syncTags = projectNode.get("sync_tags_from_github")

  if (typeof syncTags === "boolean") {
    return syncTags
  }

  return readStringArray(projectNode.get("tags")).length === 0
}

function stringArraysEqual(left, right) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

async function fetchRepositoryMetadata(repositoryNames) {
  const metadataByRepository = new Map()
  const batchSize = 8

  for (let index = 0; index < repositoryNames.length; index += batchSize) {
    const batch = repositoryNames.slice(index, index + batchSize)
    const entries = await Promise.all(
      batch.map(async (repositoryName) => [
        repositoryName,
        await fetchSingleRepositoryMetadata(repositoryName),
      ]),
    )

    for (const [repositoryName, metadata] of entries) {
      metadataByRepository.set(repositoryName, metadata)
    }
  }

  return metadataByRepository
}

async function fetchSingleRepositoryMetadata(repositoryName) {
  const response = await fetch(`${githubApiBaseUrl}/repos/${repositoryName}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(githubToken
        ? {
            Authorization: `Bearer ${githubToken}`,
          }
        : {}),
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })

  if (!response.ok) {
    const details = await response.text()

    throw new Error(
      `Failed to fetch ${repositoryName}: ${response.status} ${response.statusText}\n${details}`,
    )
  }

  const repository = await response.json()

  if (!Number.isInteger(repository.stargazers_count)) {
    throw new Error(`GitHub response for ${repositoryName} is missing stars.`)
  }

  return {
    stars: repository.stargazers_count,
    topics: Array.isArray(repository.topics)
      ? repository.topics
          .filter((topic) => typeof topic === "string" && topic.length > 0)
          .map((topic) => topic.trim())
      : [],
  }
}

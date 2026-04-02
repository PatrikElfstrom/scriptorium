import { createServer } from "node:http"
import path from "node:path"

import { loadDotEnvFile } from "../server/catalog/load-env"
import worker from "../worker"

loadDotEnvFile()

const port = Number.parseInt(process.env.PORT ?? "8787", 10)
const host = process.env.HOST ?? "127.0.0.1"
const dataDirectory =
  process.env.SCRIPTORIUM_DATA_DIR ?? path.resolve(process.cwd(), ".data")

const env = {
  SCRIPTORIUM_DATA_DIR: dataDirectory,
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
}

const server = createServer(async (nodeRequest, nodeResponse) => {
  const requestUrl = new URL(
    nodeRequest.url ?? "/",
    `http://${nodeRequest.headers.host ?? `${host}:${port}`}`
  )

  const request = new Request(requestUrl, {
    method: nodeRequest.method,
    headers: normalizeHeaders(nodeRequest.headers),
  })

  try {
    const response = await worker.fetch(request, env)
    const responseBody = Buffer.from(await response.arrayBuffer())

    nodeResponse.writeHead(
      response.status,
      response.statusText,
      Object.fromEntries(response.headers.entries())
    )
    nodeResponse.end(responseBody)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown local worker error"

    nodeResponse.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
    })
    nodeResponse.end(JSON.stringify({ error: message }))
  }
})

server.listen(port, host, () => {
  console.log(
    `Local worker API listening on http://${host}:${port} using ${
      env.TURSO_DATABASE_URL ? "Turso" : dataDirectory
    }.`
  )
})

function normalizeHeaders(headers: NodeJS.Dict<string | string[]>) {
  const normalized = new Headers()

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        normalized.append(key, item)
      }
      continue
    }

    if (value !== undefined) {
      normalized.set(key, value)
    }
  }

  return normalized
}

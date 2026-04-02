// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { ThemeProvider } from "@/components/theme-provider"
import { CatalogPage } from "@/features/catalog/CatalogPage"
import { createCatalogApiUrl } from "@/features/catalog/api"

function renderCatalogPage() {
  return render(
    <ThemeProvider>
      <CatalogPage />
    </ThemeProvider>
  )
}

describe("CatalogPage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("renders loading and then sorted rows", async () => {
    vi.stubGlobal("fetch", vi.fn(createSuccessFetch))

    renderCatalogPage()

    expect(screen.getByText("Loading tooling catalog...")).toBeTruthy()

    await screen.findByText("React")
    fireEvent.click(screen.getByRole("button", { name: "Stars" }))
    fireEvent.click(screen.getByRole("button", { name: "Stars" }))

    await waitFor(() => {
      const rows = screen.getAllByRole("row")
      expect(rows[1]?.textContent).toContain("React")
      expect(rows[2]?.textContent).toContain("Vue")
    })
  })

  it("shows tag suggestions and empty results", async () => {
    vi.stubGlobal("fetch", vi.fn(createSuccessFetch))

    renderCatalogPage()
    await screen.findByText("React")

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "rea" },
    })

    expect(await screen.findByText("Tag suggestion")).toBeTruthy()

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "something-that-will-not-match" },
    })

    expect(
      await screen.findByText("No tooling matches this filter. Try removing a term or tag.")
    ).toBeTruthy()
  })

  it("shows an error state when the API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("boom", {
          status: 500,
        })
      )
    )

    renderCatalogPage()

    expect(await screen.findByText("Search request failed with 500.")).toBeTruthy()
  })

  it("uses the configured API base URL", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/")

    expect(createCatalogApiUrl("/api/search", new URLSearchParams({ limit: "5" }))).toBe(
      "https://api.example.com/api/search?limit=5"
    )
  })
})

function createSuccessFetch(request: RequestInfo | URL) {
  const url = String(request)

  if (url.includes("/api/search")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          items: [
            {
              packageKey: "npm:react",
              sourceType: "npm",
              sourceName: "react",
              name: "React",
              description: "UI library",
              url: "https://react.dev",
              repositoryName: "facebook/react",
              npmPackageName: "react",
              stars: 200_000,
              downloads: 1000,
              downloadsPeriod: "last-month",
              dependentPackagesCount: 500,
              tags: ["react", "ui"],
            },
            {
              packageKey: "npm:vue",
              sourceType: "npm",
              sourceName: "vue",
              name: "Vue",
              description: "Progressive framework",
              url: "https://vuejs.org",
              repositoryName: "vuejs/core",
              npmPackageName: "vue",
              stars: 150_000,
              downloads: 800,
              downloadsPeriod: "last-month",
              dependentPackagesCount: 400,
              tags: ["vue", "ui"],
            },
          ],
          nextCursor: null,
          totalApprox: 2,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    )
  }

  return Promise.resolve(
    new Response(
      JSON.stringify({
        items: [
          { id: "react", label: "react", packageCount: 1 },
          { id: "ui", label: "ui", packageCount: 2 },
          { id: "vue", label: "vue", packageCount: 1 },
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
}

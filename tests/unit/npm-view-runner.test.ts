import type { ChildProcess } from "node:child_process"
import { execFile } from "node:child_process"
import { tmpdir } from "node:os"

import { resolvePackageWithNpmView } from "../../server/catalog/npm-sync-service"

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}))

const execFileMock = vi.mocked(execFile)

describe("npm view package validation", () => {
  beforeEach(() => {
    execFileMock.mockImplementation(((
      _command: string,
      _args: readonly string[],
      _options: object,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      callback(null, "{}", "")
      return {} as ChildProcess
    }) as typeof execFile)
  })

  it("runs npm view outside the repository so local devEngines do not apply", async () => {
    await expect(
      resolvePackageWithNpmView("tailwindcss-animate")
    ).resolves.toBe(true)

    expect(execFileMock).toHaveBeenCalledWith(
      "npm",
      ["view", "tailwindcss-animate", "name", "version", "--json"],
      expect.objectContaining({
        cwd: tmpdir(),
      }),
      expect.any(Function)
    )
  })
})

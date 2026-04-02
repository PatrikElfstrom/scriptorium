import { ArrowUpRight } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import {
  formatStarCount,
  getAriaSort,
  getTagColorStyle,
  normalizeValue,
  toggleSelectedTag,
  toggleSortColumn,
} from "../helpers"
import type { CatalogRow, SortState } from "../types"
import { GitHubIcon } from "./GitHubIcon"
import { SortButton } from "./SortButton"

export function ResultsTable({
  errorMessage,
  isDarkMode,
  isLoading,
  rows,
  selectedTagSet,
  setSelectedTags,
  setSortState,
  sortState,
}: {
  errorMessage?: string
  isDarkMode: boolean
  isLoading: boolean
  rows: CatalogRow[]
  selectedTagSet: Set<string>
  setSelectedTags: Dispatch<SetStateAction<string[]>>
  setSortState: Dispatch<SetStateAction<SortState>>
  sortState: SortState
}) {
  return (
    <Table className="table-fixed">
      <TableHeader className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <TableRow className="hover:bg-transparent">
          <TableHead
            aria-sort={getAriaSort("name", sortState)}
            className="sticky top-0 z-10 bg-background/95"
          >
            <SortButton
              active={sortState.column === "name"}
              direction={sortState.direction}
              label="Name"
              onClick={() => toggleSortColumn("name", setSortState)}
            />
          </TableHead>
          <TableHead
            aria-sort={getAriaSort("stars", sortState)}
            className="sticky top-0 z-10 w-32 bg-background/95 text-right"
          >
            <SortButton
              active={sortState.column === "stars"}
              direction={sortState.direction}
              label="Stars"
              onClick={() => toggleSortColumn("stars", setSortState)}
            />
          </TableHead>
          <TableHead
            aria-sort={getAriaSort("tags", sortState)}
            className="sticky top-0 z-10 w-72 bg-background/95"
          >
            <SortButton
              active={sortState.column === "tags"}
              direction={sortState.direction}
              label="Tags"
              onClick={() => toggleSortColumn("tags", setSortState)}
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((tool) => (
          <TableRow key={tool.id} className="bg-background/65 odd:bg-muted/20">
            <TableCell className="w-0 font-medium text-foreground">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  {tool.url ? (
                    <a
                      className="inline-flex min-w-0 items-center gap-2 transition-colors hover:text-primary"
                      href={tool.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>{tool.name}</span>
                      <ArrowUpRight className="size-3.5 shrink-0" />
                    </a>
                  ) : (
                    <span>{tool.name}</span>
                  )}
                  {tool.npmPackageName || tool.description ? (
                    <div className="flex min-w-0 items-center gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">
                      {tool.npmPackageUrl && tool.npmPackageName ? (
                        <a
                          href={tool.npmPackageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 font-mono transition-colors hover:text-foreground"
                        >
                          {tool.npmPackageName}
                        </a>
                      ) : null}
                      {tool.description ? (
                        <span className="block min-w-0 flex-1 truncate">
                          {tool.description}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {tool.github ? (
                  <a
                    className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
                    href={tool.github}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${tool.name} on GitHub`}
                  >
                    <GitHubIcon className="size-4" />
                  </a>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">
              {formatStarCount(tool.stars)}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                {tool.tags.map((tag) => {
                  const isSelected = selectedTagSet.has(normalizeValue(tag))

                  return (
                    <button
                      key={`${tool.id}-${tag}`}
                      type="button"
                      onClick={() => toggleSelectedTag(tag, setSelectedTags)}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Remove" : "Add"} ${tag} filter`}
                      className="rounded-full transition-transform outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary/20"
                    >
                      <Badge
                        className={
                          isSelected ? "shadow-sm ring-2 ring-current/20" : undefined
                        }
                        style={getTagColorStyle(tag, isSelected, isDarkMode)}
                      >
                        {tag}
                      </Badge>
                    </button>
                  )
                })}
              </div>
            </TableCell>
          </TableRow>
        ))}
        {isLoading ? (
          <TableRow className="bg-background/65 hover:bg-background/65">
            <TableCell
              colSpan={3}
              className="py-10 text-center text-sm text-muted-foreground"
            >
              Loading tooling catalog...
            </TableCell>
          </TableRow>
        ) : null}
        {!isLoading && errorMessage ? (
          <TableRow className="bg-background/65 hover:bg-background/65">
            <TableCell
              colSpan={3}
              className="py-10 text-center text-sm text-destructive"
            >
              {errorMessage}
            </TableCell>
          </TableRow>
        ) : null}
        {!isLoading && !errorMessage && rows.length === 0 ? (
          <TableRow className="bg-background/65 hover:bg-background/65">
            <TableCell
              colSpan={3}
              className="py-10 text-center text-sm text-muted-foreground"
            >
              No tooling matches this filter. Try removing a term or tag.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  )
}

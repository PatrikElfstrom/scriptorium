import {
  useDeferredValue,
  useId,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react"

import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpRight,
  Github,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { useTheme } from "@/components/theme-provider"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import rawToolingDatabase from "@/data/tooling.yaml?raw"
import { loadToolingRows, type ToolRow } from "@/lib/tooling"

const toolingRows = loadToolingRows(rawToolingDatabase)
const allTags = Array.from(
  new Set(toolingRows.flatMap((row) => row.tags.map(normalizeValue)))
).sort((left, right) => left.localeCompare(right))

export function App() {
  const { theme, setTheme } = useTheme()
  const inputId = useId()
  const [searchText, setSearchText] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [sortState, setSortState] = useState<SortState>({
    column: "name",
    direction: "asc",
  })
  const selectedTagSet = new Set(selectedTags.map(normalizeValue))
  const deferredSearchText = useDeferredValue(searchText)
  const activeFilter = {
    tags: selectedTags,
    textTerms: parseTextTerms(deferredSearchText),
  }
  const { token: activeToken } = getActiveToken(searchText)
  const tagSuggestions = getTagSuggestions(activeToken, selectedTags)
  const normalizedSuggestionIndex =
    activeSuggestionIndex >= 0 && activeSuggestionIndex < tagSuggestions.length
      ? activeSuggestionIndex
      : -1
  const activeSuggestion =
    normalizedSuggestionIndex >= 0
      ? tagSuggestions[normalizedSuggestionIndex]
      : undefined
  const filteredRows = toolingRows.filter((tool) =>
    matchesFilter(tool, activeFilter)
  )
  const sortedRows = sortRows(filteredRows, sortState)
  const isDarkMode = getIsDarkMode(theme)

  return (
    <main className="min-h-svh">
      <section className="flex min-h-svh flex-col overflow-hidden bg-background/90 backdrop-blur">
        <div className="border-b border-border/60 bg-muted/30 px-4 py-4 sm:px-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-lg font-semibold tracking-[0.2em] text-foreground uppercase">
                scriptorium
              </h1>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTheme(isDarkMode ? "light" : "dark")}
                  className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-background/85 px-3 py-2 text-xs tracking-[0.18em] text-foreground uppercase shadow-sm transition-colors outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-primary/20"
                  aria-label={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
                >
                  {isDarkMode ? (
                    <Sun className="size-4" />
                  ) : (
                    <Moon className="size-4" />
                  )}
                  <span>{isDarkMode ? "Light" : "Dark"}</span>
                </button>
                <a
                  href="https://github.com/patrikelfstrom/scriptorium"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-xl border border-border/70 bg-background/85 p-2.5 text-foreground shadow-sm transition-colors outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-primary/20"
                  aria-label="Open scriptorium on GitHub"
                >
                  <Github className="size-4" />
                </a>
              </div>
            </div>
            <div className="flex items-end gap-4">
              <div className="min-w-0 max-w-2xl flex-1">
                <div className="relative">
                  <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-background/85 px-3 py-2 shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
                    <Search className="size-4 text-muted-foreground" />
                    {selectedTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => removeSelectedTag(tag, setSelectedTags)}
                        className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                        aria-label={`Remove ${tag} filter`}
                      >
                        <Badge style={getTagColorStyle(tag, false, isDarkMode)}>
                          {tag}
                          <X className="size-3" />
                        </Badge>
                      </button>
                    ))}
                    <input
                      id={inputId}
                      value={searchText}
                      onChange={(event) => {
                        setSearchText(event.target.value)
                        setActiveSuggestionIndex(-1)
                      }}
                      onKeyDown={(event) =>
                        handleFilterKeyDown({
                          event,
                          suggestions: tagSuggestions,
                          activeSuggestion,
                          setActiveSuggestionIndex,
                          setSearchText,
                          setSelectedTags,
                          selectedTags,
                        })
                      }
                      className="min-w-36 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80"
                      placeholder="Type to search. Press Tab to browse tags, then Space to add one."
                      aria-autocomplete="list"
                      aria-controls={`${inputId}-suggestions`}
                      aria-expanded={tagSuggestions.length > 0}
                      aria-label="Filter tooling by text and tag"
                      role="combobox"
                    />
                  </div>
                  {tagSuggestions.length > 0 ? (
                    <div
                      id={`${inputId}-suggestions`}
                      role="listbox"
                      className="absolute right-0 left-0 z-20 mt-2 overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-[0_24px_60px_-42px_rgba(8,34,64,0.8)] backdrop-blur"
                    >
                      {tagSuggestions.map((tag, index) => {
                        const isActive = index === normalizedSuggestionIndex

                        return (
                          <button
                            key={tag}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() =>
                              commitSuggestedTag({
                                suggestion: tag,
                                setSearchText,
                                setSelectedTags,
                              })
                            }
                            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                              isActive
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Badge
                                style={getTagColorStyle(tag, false, isDarkMode)}
                              >
                                {tag}
                              </Badge>
                              <span>Tag suggestion</span>
                            </div>
                            <span className="text-[0.65rem] tracking-[0.18em] uppercase">
                              {index === 0 ? "Top match" : `Match ${index + 1}`}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="ml-auto flex shrink-0 gap-2 text-[0.65rem] tracking-[0.18em] text-muted-foreground uppercase">
                <span>{filteredRows.length} shown</span>
                <span>{toolingRows.length} total</span>
              </div>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <Table>
            <TableHeader className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <TableRow className="hover:bg-transparent">
                <TableHead
                  aria-sort={getAriaSort("name", sortState)}
                  className="sticky top-0 z-10 min-w-52 bg-background/95 sm:min-w-64"
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
                  className="sticky top-0 z-10 min-w-64 bg-background/95"
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
              {sortedRows.map((tool) => (
                <TableRow
                  key={tool.id}
                  className="bg-background/65 odd:bg-muted/20"
                >
                  <TableCell className="font-medium text-foreground">
                    <div className="flex items-center justify-between gap-3">
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
                      {tool.github ? (
                        <a
                          className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
                          href={tool.github}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${tool.name} on GitHub`}
                        >
                          <Github className="size-4" />
                        </a>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatStarCount(tool.stars)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {tool.tags.map((tag) => {
                        const isSelected = selectedTagSet.has(
                          normalizeValue(tag)
                        )

                        return (
                          <button
                            key={`${tool.id}-${tag}`}
                            type="button"
                            onClick={() =>
                              toggleSelectedTag(tag, setSelectedTags)
                            }
                            aria-pressed={isSelected}
                            aria-label={`${isSelected ? "Remove" : "Add"} ${tag} filter`}
                            className="rounded-full transition-transform outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary/20"
                          >
                            <Badge
                              className={
                                isSelected
                                  ? "shadow-sm ring-2 ring-current/20"
                                  : undefined
                              }
                              style={getTagColorStyle(
                                tag,
                                isSelected,
                                isDarkMode
                              )}
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
              {sortedRows.length === 0 ? (
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
        </div>
      </section>
    </main>
  )
}

export default App

type ParsedFilter = {
  tags: string[]
  textTerms: string[]
}

type SortColumn = "name" | "stars" | "tags"

type SortState = {
  column: SortColumn
  direction: "asc" | "desc"
}

function SortButton({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean
  direction: SortState["direction"]
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-sm text-inherit transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
    >
      <span>{label}</span>
      {active ? (
        direction === "asc" ? (
          <ArrowUpAZ className="size-3.5" />
        ) : (
          <ArrowDownAZ className="size-3.5" />
        )
      ) : (
        <ArrowUpAZ className="size-3.5 opacity-35" />
      )}
    </button>
  )
}

function parseTextTerms(query: string) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
}

function matchesFilter(
  tool: (typeof toolingRows)[number],
  filter: ParsedFilter
) {
  if (filter.tags.length > 0) {
    const normalizedTags = tool.tags.map((tag) => normalizeValue(tag))

    if (!filter.tags.every((tag) => normalizedTags.includes(tag))) {
      return false
    }
  }

  if (filter.textTerms.length === 0) {
    return true
  }

  const searchableText = normalizeValue(tool.name)

  return filter.textTerms.every((term) => searchableText.includes(term))
}

function sortRows(rows: ToolRow[], sortState: SortState) {
  return [...rows].sort((left, right) => {
    const directionMultiplier = sortState.direction === "asc" ? 1 : -1

    let result = 0

    switch (sortState.column) {
      case "name":
        result = compareStrings(left.name, right.name)
        break
      case "tags":
        result = compareStrings(left.tags.join(" "), right.tags.join(" "))
        break
      case "stars":
        result = compareNumbers(left.stars, right.stars)
        break
    }

    if (result === 0) {
      result = compareStrings(left.name, right.name)
    }

    return result * directionMultiplier
  })
}

function compareStrings(
  left: string,
  right: string,
  options?: { emptyLast?: boolean }
) {
  const normalizedLeft = normalizeValue(left)
  const normalizedRight = normalizeValue(right)

  if (options?.emptyLast) {
    if (normalizedLeft.length === 0 && normalizedRight.length > 0) {
      return 1
    }

    if (normalizedRight.length === 0 && normalizedLeft.length > 0) {
      return -1
    }
  }

  return normalizedLeft.localeCompare(normalizedRight)
}

function compareNumbers(left?: number, right?: number) {
  return (left ?? 0) - (right ?? 0)
}

function toggleSortColumn(
  column: SortColumn,
  setSortState: Dispatch<SetStateAction<SortState>>
) {
  setSortState((currentState) =>
    currentState.column === column
      ? {
          column,
          direction: currentState.direction === "asc" ? "desc" : "asc",
        }
      : { column, direction: "asc" }
  )
}

function getAriaSort(column: SortColumn, sortState: SortState) {
  if (sortState.column !== column) {
    return "none"
  }

  return sortState.direction === "asc" ? "ascending" : "descending"
}

function getIsDarkMode(theme: "dark" | "light" | "system") {
  if (theme === "dark") {
    return true
  }

  if (theme === "light") {
    return false
  }

  if (typeof window === "undefined") {
    return false
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function normalizeValue(value: string) {
  return value.trim().toLowerCase()
}

function getActiveToken(value: string) {
  const match = value.match(/^(.*?)(\S*)$/)

  return {
    prefix: match?.[1] ?? "",
    token: normalizeValue(match?.[2] ?? ""),
  }
}

function getTagSuggestions(activeToken: string, selectedTags: string[]) {
  if (!activeToken) {
    return []
  }

  const selected = new Set(selectedTags.map(normalizeValue))

  return allTags
    .filter((tag) => !selected.has(tag))
    .map((tag) => ({
      tag,
      score: scoreSuggestion(tag, activeToken),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.tag.localeCompare(right.tag)
    )
    .slice(0, 5)
    .map((entry) => entry.tag)
}

function scoreSuggestion(tag: string, token: string) {
  if (tag === token) {
    return 4
  }

  if (tag.startsWith(token)) {
    return 3
  }

  if (tag.includes(token)) {
    return 2
  }

  return 0
}

function handleFilterKeyDown({
  event,
  suggestions,
  activeSuggestion,
  setActiveSuggestionIndex,
  setSearchText,
  setSelectedTags,
  selectedTags,
}: {
  event: KeyboardEvent<HTMLInputElement>
  suggestions: string[]
  activeSuggestion?: string
  setActiveSuggestionIndex: Dispatch<SetStateAction<number>>
  setSearchText: Dispatch<SetStateAction<string>>
  setSelectedTags: Dispatch<SetStateAction<string[]>>
  selectedTags: string[]
}) {
  if (event.key === "Tab" && suggestions.length > 0) {
    event.preventDefault()
    setActiveSuggestionIndex((currentIndex) =>
      currentIndex < 0 ? 0 : (currentIndex + 1) % suggestions.length
    )
    return
  }

  if (event.key === " " && activeSuggestion) {
    event.preventDefault()
    commitSuggestedTag({
      suggestion: activeSuggestion,
      setSearchText,
      setSelectedTags,
    })
    return
  }

  if (event.key === "Enter" && activeSuggestion) {
    event.preventDefault()
    commitSuggestedTag({
      suggestion: activeSuggestion,
      setSearchText,
      setSelectedTags,
    })
    return
  }

  if (
    event.key === "Backspace" &&
    event.currentTarget.value.length === 0 &&
    selectedTags.length > 0
  ) {
    event.preventDefault()
    removeSelectedTag(selectedTags[selectedTags.length - 1], setSelectedTags)
    return
  }

  if (event.key === "Escape") {
    setActiveSuggestionIndex(-1)
  }
}

function commitSuggestedTag({
  suggestion,
  setSearchText,
  setSelectedTags,
}: {
  suggestion: string
  setSearchText: Dispatch<SetStateAction<string>>
  setSelectedTags: Dispatch<SetStateAction<string[]>>
}) {
  setSelectedTags((currentTags) =>
    currentTags.includes(suggestion)
      ? currentTags
      : [...currentTags, suggestion]
  )
  setSearchText((currentText) =>
    `${getActiveToken(currentText).prefix}`.trimStart()
  )
}

function toggleSelectedTag(
  tag: string,
  setSelectedTags: Dispatch<SetStateAction<string[]>>
) {
  const normalizedTag = normalizeValue(tag)

  setSelectedTags((currentTags) =>
    currentTags.includes(normalizedTag)
      ? currentTags.filter((currentTag) => currentTag !== normalizedTag)
      : [...currentTags, normalizedTag]
  )
}

function removeSelectedTag(
  tagToRemove: string,
  setSelectedTags: Dispatch<SetStateAction<string[]>>
) {
  setSelectedTags((currentTags) =>
    currentTags.filter((tag) => tag !== tagToRemove)
  )
}

function getTagColorStyle(
  tag: string,
  isSelected: boolean,
  isDarkMode: boolean
): CSSProperties {
  const hash = hashString(tag)
  const hue = Math.abs(hash) % 360
  const saturation = isSelected ? 72 : 62

  if (isDarkMode) {
    return {
      backgroundColor: `hsl(${hue} ${saturation}% ${isSelected ? 28 : 20}% / ${isSelected ? 0.95 : 0.85})`,
      borderColor: `hsl(${hue} ${Math.min(saturation + 6, 88)}% ${isSelected ? 60 : 52}% / 0.42)`,
      color: `hsl(${hue} ${Math.min(saturation + 8, 90)}% 82%)`,
    }
  }

  return {
    backgroundColor: `hsl(${hue} ${saturation}% ${isSelected ? 88 : 94}% / ${isSelected ? 0.95 : 0.9})`,
    borderColor: `hsl(${hue} ${Math.min(saturation + 6, 88)}% ${isSelected ? 52 : 58}% / 0.35)`,
    color: `hsl(${hue} ${Math.min(saturation + 8, 90)}% 30%)`,
  }
}

function hashString(value: string) {
  let hash = 0

  for (const character of value) {
    hash = (hash << 5) - hash + character.charCodeAt(0)
    hash |= 0
  }

  return hash
}

function formatStarCount(stars?: number) {
  if (stars == null) {
    return ""
  }

  if (stars < 1_000) {
    return new Intl.NumberFormat("en-US").format(stars)
  }

  if (stars < 1_000_000) {
    return `${Math.round(stars / 1_000)}k`
  }

  return `${Math.round(stars / 1_000_000)}m`
}

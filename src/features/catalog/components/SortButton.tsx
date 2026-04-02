import { ArrowDownAZ, ArrowUpAZ } from "lucide-react"

import type { SortState } from "../types"

export function SortButton({
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

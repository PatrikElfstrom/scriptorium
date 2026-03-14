import type { InputHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

function Input({
  className,
  type = "text",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "flex h-10 w-full rounded-xl border border-border/70 bg-background/85 px-3 py-2 text-sm text-foreground shadow-sm transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground/80 focus-visible:border-primary/50 focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }

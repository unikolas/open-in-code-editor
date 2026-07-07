"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

export function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={() => setCount(count + 1)}>
        Count: {count}
      </Button>
      <span className="text-sm text-muted-foreground">
        A client component, for stack-trace testing.
      </span>
    </div>
  )
}

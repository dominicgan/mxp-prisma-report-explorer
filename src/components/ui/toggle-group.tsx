import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import type * as React from 'react'
import { cn } from '@/lib/utils'

function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn('bg-muted inline-flex w-fit items-center gap-0.5 rounded-lg p-[3px]', className)}
      {...props}
    />
  )
}
function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "data-[state=on]:bg-background data-[state=on]:text-foreground text-muted-foreground inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none data-[state=on]:shadow-sm [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  )
}
export { ToggleGroup, ToggleGroupItem }

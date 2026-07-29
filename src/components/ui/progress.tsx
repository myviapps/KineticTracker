"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
    {...props}
  >
    {/* transition-transform, not transition-all: the bar only ever moves, and
        `all` would also animate colour/layout on every re-render. Slower than
        the UI default so a refresh job's progress reads as a steady sweep
        rather than a series of jumps. */}
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-primary transition-transform duration-500 ease-glide"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };

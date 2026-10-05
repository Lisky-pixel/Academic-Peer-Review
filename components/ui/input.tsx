import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-10 w-full min-w-0 rounded-lg border px-3 py-1 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3",
        className,
      )}
      {...props}
    />
  );
}

export { Input };

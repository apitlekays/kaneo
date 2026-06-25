import { useState } from "react";
import { cn } from "@/lib/cn";
import { getColumnTintClass } from "@/lib/column-colors";
import type { ProjectWithTasks } from "@/types/project";
import { ColumnDropzone } from "./column-dropzone";
import { ColumnHeader } from "./column-header";

type ColumnProps = {
  column: ProjectWithTasks["columns"][number];
};

function Column({ column }: ColumnProps) {
  const [isDropzoneOver, setIsDropzoneOver] = useState(false);
  const tint = getColumnTintClass(column.slug, column.color);

  return (
    <div
      className={cn(
        "group relative flex h-full min-h-0 w-full flex-col rounded-xl border transition-all duration-300 ease-out",
        isDropzoneOver
          ? "border-ring/40 bg-accent/60 shadow-md ring-2 ring-ring/30"
          : cn(
              "border-border/70 shadow-xs/5 hover:border-border/90",
              tint || "bg-muted/40 dark:bg-card/90",
            ),
      )}
    >
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <ColumnHeader column={column} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 [-webkit-overflow-scrolling:touch]">
        <ColumnDropzone column={column} onIsOverChange={setIsDropzoneOver} />
      </div>
    </div>
  );
}

export default Column;

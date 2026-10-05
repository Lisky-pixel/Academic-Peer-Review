"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { publishTemplateAction } from "@/app/(admin)/admin/document-types/actions";
import { FormMessage } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_CRITERIA } from "@/lib/admin/template-schema";
import type { TemplateCriterionDTO } from "@/lib/dto/admin";

type Row = TemplateCriterionDTO & { key: number };

const INPUT_TYPE_LABEL = {
  BOTH: "Score and comment",
  RATING: "Score only",
  TEXT: "Written answer",
} as const;

const SELECT =
  "border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 h-10 w-full min-w-0 rounded-lg border px-3 text-sm shadow-xs outline-none focus-visible:ring-3";

/**
 * Edits the criteria of a document type's review template.
 *
 * Nothing is saved until "Publish": the list is edited in the browser, then
 * sent whole. Publishing never changes the existing version; it makes a new
 * one, which is why the button says so.
 */
export function TemplateEditor({
  documentTypeId,
  initial,
  currentVersion,
}: {
  documentTypeId: string;
  initial: TemplateCriterionDTO[];
  currentVersion: number | null;
}) {
  const nextKey = useRef(initial.length);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((criterion, key) => ({ ...criterion, key })),
  );
  const [result, setResult] = useState<{ ok: boolean; message: string; issues?: string[] }>();
  const [pending, startTransition] = useTransition();

  function change(key: number, patch: Partial<TemplateCriterionDTO>) {
    setResult(undefined);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function move(index: number, by: -1 | 1) {
    setResult(undefined);
    setRows((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function add() {
    setResult(undefined);
    const key = nextKey.current++;
    setRows((current) => [
      ...current,
      { key, label: "", helpText: "", inputType: "BOTH", required: true },
    ]);
  }

  function publish() {
    startTransition(async () => {
      setResult(
        await publishTemplateAction(
          documentTypeId,
          rows.map(({ label, helpText, inputType, required }) => ({
            label,
            helpText: helpText ?? "",
            inputType,
            required,
          })),
        ),
      );
    });
  }

  return (
    <div className="space-y-5">
      <ol className="space-y-3">
        {rows.map((row, index) => (
          <li key={row.key} className="border-border bg-card space-y-3 rounded-xl border p-4">
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground w-5 shrink-0 pt-2.5 text-sm tabular-nums">
                {index + 1}
              </span>
              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <Input
                  aria-label={`Criterion ${index + 1} name`}
                  placeholder="What the reviewer is judging"
                  maxLength={100}
                  value={row.label}
                  onChange={(event) => change(row.key, { label: event.target.value })}
                />
                <select
                  aria-label={`Criterion ${index + 1} answer type`}
                  value={row.inputType}
                  onChange={(event) =>
                    change(row.key, { inputType: event.target.value as Row["inputType"] })
                  }
                  className={SELECT}
                >
                  {Object.entries(INPUT_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label={`Criterion ${index + 1} guidance`}
                  placeholder="Guidance shown to the reviewer (optional)"
                  maxLength={300}
                  value={row.helpText ?? ""}
                  onChange={(event) => change(row.key, { helpText: event.target.value })}
                  className="sm:col-span-2"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pl-7">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(event) => change(row.key, { required: event.target.checked })}
                  className="accent-mark size-4"
                />
                Required
              </label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move criterion ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move criterion ${index + 1} down`}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove criterion ${index + 1}`}
                  disabled={rows.length === 1}
                  onClick={() => {
                    setResult(undefined);
                    setRows((current) => current.filter((other) => other.key !== row.key));
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={rows.length >= MAX_CRITERIA}
        onClick={add}
      >
        <Plus aria-hidden />
        Add a criterion
      </Button>

      {result && (
        <FormMessage tone={result.ok ? "success" : "error"}>
          {result.message}
          {result.issues?.map((issue) => (
            <span key={issue} className="mt-1 block">
              {issue}
            </span>
          ))}
        </FormMessage>
      )}

      <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-6">
        <Button
          type="button"
          size="lg"
          className="h-10 px-4 text-sm"
          disabled={pending}
          onClick={publish}
        >
          {pending
            ? "Publishing…"
            : `Publish as version ${currentVersion === null ? 1 : currentVersion + 1}`}
        </Button>
        <p className="text-muted-foreground text-sm">
          New reviews use the new version. Reviews already started keep theirs.
        </p>
      </div>
    </div>
  );
}

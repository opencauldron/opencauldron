"use client";

import React, { useState } from "react";
import {
  Sparkles,
  ChevronDown,
  Loader2,
  Wand2,
  Undo2,
  Zap,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { PromptTemplate } from "@/types";
import type { promptModifiers as PromptModifiersType } from "@/providers/prompt-improver";

type EnhanceMode = "llm" | "template";

interface PromptToolbarProps {
  prompt: string;
  isEnhancing: boolean;
  showUndo: boolean;
  onEnhance: (mode: EnhanceMode, template: PromptTemplate) => void;
  onUndo: () => void;
  onDismissUndo: () => void;
  modifiers: typeof PromptModifiersType;
  shortcutLabel: string;
}

export function PromptToolbar({
  prompt,
  isEnhancing,
  showUndo,
  onEnhance,
  onUndo,
  onDismissUndo,
  modifiers,
  shortcutLabel,
}: PromptToolbarProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EnhanceMode>("llm");
  const [template, setTemplate] = useState<PromptTemplate>({});
  const isMobile = useIsMobile();
  const disabled = !prompt.trim() || isEnhancing;

  const hasTemplateValues = Object.values(template).some((v) => v && v !== "none");

  function trigger(activeMode: EnhanceMode) {
    if (disabled) return;
    onEnhance(activeMode, activeMode === "template" ? template : {});
    if (activeMode === "template") setTemplate({});
    setOpen(false);
  }

  if (showUndo) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto relative flex items-center gap-1 overflow-hidden rounded-full border border-primary/30 bg-primary/[0.08] px-1 pl-3 pr-1 py-0.5 text-[11px] font-medium text-primary shadow-sm backdrop-blur-sm"
      >
        <Sparkles className="h-3 w-3 shrink-0 opacity-80" />
        <span className="select-none">Prompt enhanced</span>
        <button
          type="button"
          onClick={onUndo}
          className="ml-1 flex h-5 items-center gap-1 rounded-full bg-primary/15 px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/25 cursor-pointer"
        >
          <Undo2 className="h-3 w-3" />
          Undo
        </button>
        <button
          type="button"
          onClick={onDismissUndo}
          aria-label="Dismiss"
          className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-primary/70 transition-colors hover:bg-primary/15 hover:text-primary cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>
        <span
          aria-hidden="true"
          className="undo-progress absolute inset-x-0 bottom-0 h-[2px] bg-primary/60"
        />
      </div>
    );
  }

  const triggerButton = (
    <div className="pointer-events-auto inline-flex items-center rounded-full border border-primary/25 bg-primary/[0.06] backdrop-blur-sm shadow-[0_1px_0_0_oklch(var(--primary)/0.10)_inset]">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => trigger("llm")}
              disabled={disabled}
              aria-label={`Enhance prompt (${shortcutLabel})`}
              className={cn(
                "group/enh flex items-center gap-1.5 rounded-l-full pl-2.5 pr-2 h-7 text-[12px] font-medium tracking-tight transition-colors cursor-pointer",
                "text-primary/90 hover:text-primary hover:bg-primary/10",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              )}
            />
          }
        >
          {isEnhancing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 transition-transform group-hover/enh:rotate-12" />
          )}
          <span>{isEnhancing ? "Enhancing" : "Enhance"}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          AI rewrite ({shortcutLabel})
        </TooltipContent>
      </Tooltip>
      <span aria-hidden className="h-3.5 w-px bg-primary/20" />
      <PopoverWrapper
        open={open}
        onOpenChange={setOpen}
        isMobile={isMobile}
        trigger={
          <button
            type="button"
            aria-label="Open enhance options"
            aria-expanded={open}
            disabled={isEnhancing || !prompt.trim()}
            className={cn(
              "flex items-center justify-center rounded-r-full pl-1 pr-1.5 h-7 text-primary/80 transition-colors cursor-pointer hover:text-primary hover:bg-primary/10",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            )}
          >
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform",
                open && "rotate-180"
              )}
            />
          </button>
        }
      >
        <ToolbarPanel
          mode={mode}
          setMode={setMode}
          template={template}
          setTemplate={setTemplate}
          modifiers={modifiers}
          hasTemplateValues={hasTemplateValues}
          isEnhancing={isEnhancing}
          disabled={disabled}
          onRun={trigger}
          shortcutLabel={shortcutLabel}
        />
      </PopoverWrapper>
    </div>
  );

  return triggerButton;
}

function PopoverWrapper({
  open,
  onOpenChange,
  trigger,
  children,
  isMobile,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger: React.ReactElement;
  children: React.ReactNode;
  isMobile: boolean;
}) {
  if (isMobile) {
    return (
      <>
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            className="rounded-t-2xl border-primary/10 bg-popover/95 px-4 pb-6 pt-5 backdrop-blur-md"
          >
            <SheetHeader className="px-0 pb-3">
              <SheetTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Enhance prompt
              </SheetTitle>
              <SheetDescription className="text-xs">
                Choose how you want this prompt rewritten.
              </SheetDescription>
            </SheetHeader>
            {children}
          </SheetContent>
        </Sheet>
        {React.cloneElement(trigger, {
          onClick: () => onOpenChange(true),
        } as React.HTMLAttributes<HTMLButtonElement>)}
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={10}
        className="w-[320px] border border-primary/15 bg-popover/95 p-0 backdrop-blur-md"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function ToolbarPanel({
  mode,
  setMode,
  template,
  setTemplate,
  modifiers,
  hasTemplateValues,
  isEnhancing,
  disabled,
  onRun,
  shortcutLabel,
}: {
  mode: EnhanceMode;
  setMode: (m: EnhanceMode) => void;
  template: PromptTemplate;
  setTemplate: (next: PromptTemplate | ((prev: PromptTemplate) => PromptTemplate)) => void;
  modifiers: typeof PromptModifiersType;
  hasTemplateValues: boolean;
  isEnhancing: boolean;
  disabled: boolean;
  onRun: (m: EnhanceMode) => void;
  shortcutLabel: string;
}) {
  return (
    <div className="flex flex-col p-3 gap-3">
      <div className="inline-flex w-full rounded-full bg-secondary/60 p-0.5 ring-1 ring-border/40">
        <SegButton
          active={mode === "llm"}
          onClick={() => setMode("llm")}
          icon={<Sparkles className="h-3 w-3" />}
          label="AI Rewrite"
        />
        <SegButton
          active={mode === "template"}
          onClick={() => setMode("template")}
          icon={<Zap className="h-3 w-3" />}
          label="Templates"
        />
      </div>

      {mode === "llm" ? (
        <div className="rounded-md border border-dashed border-primary/20 bg-primary/[0.03] p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-primary/80">
            <Wand2 className="h-3 w-3" />
            Mistral rewrite
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Rewrites your prompt with model-specific phrasing tips for sharper
            results. Your original is saved — just hit Undo if you don&apos;t like it.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {Object.entries(modifiers).map(([category, options]) => (
            <div key={category}>
              <Label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 capitalize">
                {category}
              </Label>
              <Select
                value={template[category as keyof PromptTemplate] ?? ""}
                onValueChange={(v) =>
                  setTemplate((prev) => ({
                    ...prev,
                    [category]: v ?? "",
                  }))
                }
              >
                <SelectTrigger className="h-7 w-full border-border/50 bg-secondary/40 text-xs">
                  <SelectValue placeholder={`Select ${category}`} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((opt) => (
                    <SelectItem key={opt.label} value={opt.value || "none"}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}

      <Button
        size="sm"
        onClick={() => onRun(mode)}
        disabled={disabled || (mode === "template" && !hasTemplateValues)}
        className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {isEnhancing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {isEnhancing
          ? "Enhancing..."
          : mode === "llm"
            ? `Rewrite (${shortcutLabel})`
            : "Apply Template"}
      </Button>
    </div>
  );
}

function SegButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-all cursor-pointer",
        active
          ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

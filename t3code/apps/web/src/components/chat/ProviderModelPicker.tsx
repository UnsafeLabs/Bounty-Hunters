import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { ModelPickerContent } from "./ModelPickerContent";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  ModelEsque,
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
} from "./providerIconUtils";
import { setModelPickerOpen } from "../../modelPickerOpenState";
import type { ProviderInstanceEntry } from "../../providerInstances";

// ── LocalStorage persistence ──────────────────────────────────────────

const STORAGE_KEY = "t3code:providerModelPickerSelection";

interface PersistedSelection {
  readonly instanceId: string;
  readonly model: string;
}

function readPersistedSelection(): PersistedSelection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.instanceId === "string" &&
      typeof parsed.model === "string"
    ) {
      return { instanceId: parsed.instanceId, model: parsed.model };
    }
    return null;
  } catch {
    return null;
  }
}

function writePersistedSelection(instanceId: string, model: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ instanceId, model }));
  } catch {
    // localStorage may be unavailable (private browsing, quota, etc.)
  }
}

// ── Component ─────────────────────────────────────────────────────────

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  /**
   * The instance currently selected in the composer. Drives the trigger
   * icon, label and the default-highlighted combobox row.
   */
  activeInstanceId: ProviderInstanceId;
  model: string;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  /** Instance entries rendered in the sidebar + used to resolve display name. */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  terminalOpen?: boolean;
  open?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;

  // Track whether the initial restore from localStorage has been attempted
  // so we only fire it once on first mount.
  const restoredRef = useRef(false);

  // Persist on change: whenever the active instance or model changes from
  // a user action, write to localStorage.
  const isUserActionRef = useRef(false);

  // Resolve the active instance entry by exact routing key. The composer
  // resolves fallbacks before rendering this component; if the selected
  // instance disappears, do not infer a replacement from its driver kind.
  const activeEntry = useMemo(() => {
    return (
      props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null
    );
  }, [props.activeInstanceId, props.instanceEntries]);

  const activeInstanceId = props.activeInstanceId;
  const selectedInstanceOptions = props.modelOptionsByInstance.get(activeInstanceId) ?? [];
  // If the current slug belongs to a different instance (for example after
  // a provider switch or disable), prefer the active instance's first
  // option so the trigger icon and label stay in sync instead of showing
  // a stale foreign slug.
  const selectedModel =
    selectedInstanceOptions.find((option) => option.slug === props.model) ??
    selectedInstanceOptions[0];
  const triggerTitle = selectedModel ? getTriggerDisplayModelName(selectedModel) : props.model;
  const triggerSubtitle = selectedModel?.subProvider;
  const triggerLabel = selectedModel ? getTriggerDisplayModelLabel(selectedModel) : props.model;
  const duplicateDriverCount = props.instanceEntries.filter(
    (entry) => activeEntry !== null && entry.driverKind === activeEntry.driverKind,
  ).length;
  const showInstanceBadge = Boolean(activeEntry?.accentColor) || duplicateDriverCount > 1;

  const setIsMenuOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (props.open === undefined) {
      setUncontrolledIsMenuOpen(open);
    }
  };

  useEffect(() => {
    setModelPickerOpen(isMenuOpen);
    return () => {
      setModelPickerOpen(false);
    };
  }, [isMenuOpen]);

  // ── Restore persisted selection on mount ──────────────────────────
  // If the current instanceId/model pair looks like it came from the
  // default fallback (rather than an explicit user choice), check
  // localStorage for a previously-saved preference and restore it.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const persisted = readPersistedSelection();
    if (!persisted) return;

    // Validate the persisted instance is still available.
    const matchingEntry = props.instanceEntries.find(
      (entry) => entry.instanceId === persisted.instanceId && entry.enabled,
    );
    if (!matchingEntry) {
      // Persisted provider is no longer available — fall back to first available.
      const firstAvailable = props.instanceEntries.find((entry) => entry.enabled);
      if (firstAvailable) {
        const firstModelOptions = props.modelOptionsByInstance.get(firstAvailable.instanceId);
        const firstModel = firstAvailable.models[0]?.slug ?? firstModelOptions?.[0]?.slug;
        if (firstModel && firstModel !== props.model) {
          isUserActionRef.current = true;
          props.onInstanceModelChange(firstAvailable.instanceId, firstModel);
        }
      }
      return;
    }

    // Check the persisted model is still valid for this instance.
    const modelOptions = props.modelOptionsByInstance.get(matchingEntry.instanceId) ?? [];
    const modelStillValid = modelOptions.some(
      (option) => option.slug === persisted.model || option.name === persisted.model,
    );
    const resolvedModel = modelStillValid
      ? persisted.model
      : (modelOptions[0]?.slug ?? matchingEntry.models[0]?.slug);

    // Only restore if the current selection actually differs — this avoids
    // an unnecessary re-render cycle when the store has already been
    // hydrated from its own persistence layer.
    if (
      (props.activeInstanceId !== persisted.instanceId || props.model !== resolvedModel) &&
      resolvedModel
    ) {
      isUserActionRef.current = true;
      props.onInstanceModelChange(
        matchingEntry.instanceId as ProviderInstanceId,
        resolvedModel,
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist to localStorage when the user makes a selection ───────
  useEffect(() => {
    // Only persist if this change was driven by a user action (not initial
    // props from store hydration).
    if (isUserActionRef.current) {
      isUserActionRef.current = false;
      // Validate instanceId/model pair is real before persisting
      if (activeEntry && selectedModel) {
        writePersistedSelection(activeInstanceId, selectedModel.slug);
      } else {
        writePersistedSelection(activeInstanceId, props.model);
      }
    }
  }, [activeInstanceId, props.model, activeEntry, selectedModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    isUserActionRef.current = true;
    props.onInstanceModelChange(instanceId, model);
    setIsMenuOpen(false);
  };

  return (
    <Popover
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            data-chat-provider-model-picker="true"
            className={cn(
              "min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
              props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 w-full box-border items-center gap-2 overflow-hidden",
            props.compact ? "max-w-36 sm:pl-1" : undefined,
          )}
        >
          {activeEntry ? (
            <ProviderInstanceIcon
              driverKind={activeEntry.driverKind}
              displayName={activeEntry.displayName}
              accentColor={activeEntry.accentColor}
              showBadge={showInstanceBadge}
              className={showInstanceBadge ? "size-5" : "size-4"}
              iconClassName={cn("size-4", props.activeProviderIconClassName)}
              badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 text-[7px]"
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "min-w-0 flex-1 overflow-hidden",
                    triggerSubtitle
                      ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1"
                      : "truncate",
                  )}
                />
              }
            >
              {triggerSubtitle ? (
                <>
                  <span className="min-w-0 truncate">{triggerSubtitle}</span>
                  <span aria-hidden="true" className="shrink-0 opacity-60">
                    ·
                  </span>
                  <span className="min-w-0 truncate">{triggerTitle}</span>
                </>
              ) : (
                triggerTitle
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">{triggerLabel}</TooltipPopup>
          </Tooltip>
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </span>
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        className="border-0 bg-transparent p-0 shadow-none before:hidden [--viewport-inline-padding:0] *:data-[slot=popover-viewport]:p-0"
      >
        <ModelPickerContent
          activeInstanceId={activeInstanceId}
          model={props.model}
          lockedProvider={props.lockedProvider}
          lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
          instanceEntries={props.instanceEntries}
          {...(props.keybindings ? { keybindings: props.keybindings } : {})}
          modelOptionsByInstance={props.modelOptionsByInstance}
          terminalOpen={props.terminalOpen ?? false}
          onRequestClose={() => setIsMenuOpen(false)}
          onInstanceModelChange={handleInstanceModelChange}
        />
      </PopoverPopup>
    </Popover>
  );
});

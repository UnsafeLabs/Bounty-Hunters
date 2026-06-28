import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type PersistedSelection = {
  instanceId: ProviderInstanceId;
  model: string;
};

const PERSISTED_SELECTION_STORAGE_EVENT = "t3code:provider-model-picker-selection-change";

function isPersistedSelection(value: unknown): value is PersistedSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { instanceId?: unknown; model?: unknown };
  return typeof candidate.instanceId === "string" && typeof candidate.model === "string";
}

function readPersistedSelection(storageKey: string | null): PersistedSelection | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isPersistedSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writePersistedSelection(storageKey: string | null, next: PersistedSelection | null) {
  if (!storageKey || typeof window === "undefined") return;
  if (next === null) {
    window.localStorage.removeItem(storageKey);
  } else {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }
  window.dispatchEvent(
    new CustomEvent<{ key: string }>(PERSISTED_SELECTION_STORAGE_EVENT, {
      detail: { key: storageKey },
    }),
  );
}

function sameSelection(a: PersistedSelection, b: PersistedSelection) {
  return a.instanceId === b.instanceId && a.model === b.model;
}

function normalizePersistedSelection(
  selection: PersistedSelection | null,
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
): PersistedSelection | null {
  if (!selection) return null;
  const entry = instanceEntries.find(
    (candidate) =>
      candidate.instanceId === selection.instanceId &&
      candidate.enabled &&
      candidate.status === "ready",
  );
  if (!entry) return null;

  const options = modelOptionsByInstance.get(entry.instanceId) ?? [];
  if (options.some((option) => option.slug === selection.model)) {
    return selection;
  }

  const resolved = resolveSelectableModel(entry.driverKind, selection.model, options);
  return resolved ? { instanceId: selection.instanceId, model: resolved } : null;
}

function usePersistedSelection(storageKey: string | null) {
  const [selection, setSelection] = useState<PersistedSelection | null>(() =>
    readPersistedSelection(storageKey),
  );

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") {
      setSelection(null);
      return;
    }

    const syncFromStorage = () => {
      setSelection(readPersistedSelection(storageKey));
    };

    syncFromStorage();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) {
        syncFromStorage();
      }
    };

    const handleLocalChange = (event: CustomEvent<{ key: string }>) => {
      if (event.detail.key === storageKey) {
        syncFromStorage();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(PERSISTED_SELECTION_STORAGE_EVENT, handleLocalChange as EventListener);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        PERSISTED_SELECTION_STORAGE_EVENT,
        handleLocalChange as EventListener,
      );
    };
  }, [storageKey]);

  const persistSelection = useCallback(
    (next: PersistedSelection | null) => {
      writePersistedSelection(storageKey, next);
      setSelection(next);
    },
    [storageKey],
  );

  return [selection, persistSelection] as const;
}

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
  persistSelectionKey?: string;
  onOpenChange?: (open: boolean) => void;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;
  const defaultSelectionRef = useRef<PersistedSelection>({
    instanceId: props.activeInstanceId,
    model: props.model,
  });
  const hadPersistedSelectionRef = useRef(false);
  const [persistedSelection, setPersistedSelection] = usePersistedSelection(
    props.persistSelectionKey ?? null,
  );

  const currentSelection = useMemo(
    () => ({
      instanceId: props.activeInstanceId,
      model: props.model,
    }),
    [props.activeInstanceId, props.model],
  );
  const resolvedPersistedSelection = useMemo(
    () =>
      props.persistSelectionKey
        ? normalizePersistedSelection(
            persistedSelection,
            props.instanceEntries,
            props.modelOptionsByInstance,
          )
        : null,
    [
      persistedSelection,
      props.instanceEntries,
      props.modelOptionsByInstance,
      props.persistSelectionKey,
    ],
  );
  const effectiveSelection = resolvedPersistedSelection ?? currentSelection;

  // Resolve the active instance entry by exact routing key. The composer
  // resolves fallbacks before rendering this component; if the selected
  // instance disappears, do not infer a replacement from its driver kind.
  const activeEntry = useMemo(() => {
    return (
      props.instanceEntries.find((entry) => entry.instanceId === effectiveSelection.instanceId) ??
      null
    );
  }, [effectiveSelection.instanceId, props.instanceEntries]);

  const selectedInstanceOptions = props.modelOptionsByInstance.get(effectiveSelection.instanceId) ?? [];
  // If the current slug belongs to a different instance (for example after
  // a provider switch or disable), prefer the active instance's first
  // option so the trigger icon and label stay in sync instead of showing
  // a stale foreign slug.
  const selectedModel =
    selectedInstanceOptions.find((option) => option.slug === effectiveSelection.model) ??
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

  useEffect(() => {
    if (!props.persistSelectionKey) {
      return;
    }

    if (persistedSelection !== null) {
      hadPersistedSelectionRef.current = true;
    }

    const normalizedSelection = resolvedPersistedSelection;
    if (normalizedSelection) {
      hadPersistedSelectionRef.current = true;
      if (!sameSelection(currentSelection, normalizedSelection)) {
        props.onInstanceModelChange(
          normalizedSelection.instanceId,
          normalizedSelection.model,
        );
      }
      return;
    }

    if (persistedSelection !== null) {
      setPersistedSelection(null);
    }

    if (
      hadPersistedSelectionRef.current &&
      !sameSelection(currentSelection, defaultSelectionRef.current)
    ) {
      props.onInstanceModelChange(
        defaultSelectionRef.current.instanceId,
        defaultSelectionRef.current.model,
      );
    }
  }, [
    currentSelection,
    persistedSelection,
    props.onInstanceModelChange,
    props.persistSelectionKey,
    resolvedPersistedSelection,
    setPersistedSelection,
  ]);

  const handleResetToDefault = useCallback(() => {
    if (props.disabled) return;
    setPersistedSelection(null);
    props.onInstanceModelChange(
      defaultSelectionRef.current.instanceId,
      defaultSelectionRef.current.model,
    );
    setIsMenuOpen(false);
  }, [props.disabled, props.onInstanceModelChange, setPersistedSelection]);

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    props.onInstanceModelChange(instanceId, model);
    if (props.persistSelectionKey) {
      setPersistedSelection({ instanceId, model });
    }
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
                    路
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
        <div className="flex flex-col">
          {props.persistSelectionKey ? (
            <div className="flex items-center justify-end border-b bg-popover px-3 py-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={handleResetToDefault}
              >
                Reset to default
              </Button>
            </div>
          ) : null}
          <ModelPickerContent
            activeInstanceId={effectiveSelection.instanceId}
            model={effectiveSelection.model}
            lockedProvider={props.lockedProvider}
            lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
            instanceEntries={props.instanceEntries}
            {...(props.keybindings ? { keybindings: props.keybindings } : {})}
            modelOptionsByInstance={props.modelOptionsByInstance}
            terminalOpen={props.terminalOpen ?? false}
            onRequestClose={() => setIsMenuOpen(false)}
            onInstanceModelChange={handleInstanceModelChange}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
});

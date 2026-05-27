import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
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

const PROVIDER_MODEL_PICKER_PERSIST_EVENT = "t3code:provider-model-picker-selection-change";

type PersistedProviderModelPickerSelection = {
  instanceId: ProviderInstanceId;
  model: string;
};

function parsePersistedProviderModelPickerSelection(
  raw: string | null,
): PersistedProviderModelPickerSelection | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.instanceId === "string" &&
      typeof parsed.model === "string"
    ) {
      return {
        instanceId: parsed.instanceId as ProviderInstanceId,
        model: parsed.model,
      };
    }
  } catch {
    // Ignore malformed persisted picker state and fall back to defaults.
  }
  return null;
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
  persistenceKey?: string;
  onOpenChange?: (open: boolean) => void;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;
  const defaultSelectionRef = useRef<PersistedProviderModelPickerSelection>({
    instanceId: props.activeInstanceId,
    model: props.model,
  });

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
  const firstAvailableSelection = useMemo<PersistedProviderModelPickerSelection | null>(() => {
    for (const entry of props.instanceEntries) {
      if (!entry.enabled || entry.status !== "ready") {
        continue;
      }
      if (props.lockedProvider && entry.driverKind !== props.lockedProvider) {
        continue;
      }
      if (
        props.lockedContinuationGroupKey &&
        entry.continuationGroupKey !== props.lockedContinuationGroupKey
      ) {
        continue;
      }
      const firstOption = props.modelOptionsByInstance.get(entry.instanceId)?.[0];
      if (firstOption) {
        return {
          instanceId: entry.instanceId,
          model: firstOption.slug,
        };
      }
    }
    return null;
  }, [
    props.instanceEntries,
    props.lockedContinuationGroupKey,
    props.lockedProvider,
    props.modelOptionsByInstance,
  ]);

  const resolveSelectionIfValid = useCallback(
    (
      selection: PersistedProviderModelPickerSelection | null,
    ): PersistedProviderModelPickerSelection | null => {
      if (!selection) {
        return null;
      }
      const matchingEntry = props.instanceEntries.find(
        (entry) =>
          entry.instanceId === selection.instanceId &&
          entry.enabled &&
          entry.status === "ready" &&
          (!props.lockedProvider || entry.driverKind === props.lockedProvider) &&
          (!props.lockedContinuationGroupKey ||
            entry.continuationGroupKey === props.lockedContinuationGroupKey),
      );
      if (!matchingEntry) {
        return null;
      }
      const matchingModel = props.modelOptionsByInstance
        .get(matchingEntry.instanceId)
        ?.find((option) => option.slug === selection.model);
      if (!matchingModel) {
        return null;
      }
      return {
        instanceId: matchingEntry.instanceId,
        model: matchingModel.slug,
      };
    },
    [
      props.instanceEntries,
      props.lockedContinuationGroupKey,
      props.lockedProvider,
      props.modelOptionsByInstance,
    ],
  );

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

  const persistSelection = useCallback(
    (selection: PersistedProviderModelPickerSelection) => {
      if (!props.persistenceKey || typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem(props.persistenceKey, JSON.stringify(selection));
      window.dispatchEvent(
        new CustomEvent<PersistedProviderModelPickerSelection>(PROVIDER_MODEL_PICKER_PERSIST_EVENT, {
          detail: selection,
        }),
      );
    },
    [props.persistenceKey],
  );

  const clearPersistedSelection = useCallback(() => {
    if (!props.persistenceKey || typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(props.persistenceKey);
    window.dispatchEvent(
      new CustomEvent<{ instanceId: ProviderInstanceId | null }>(
        PROVIDER_MODEL_PICKER_PERSIST_EVENT,
        {
          detail: { instanceId: null },
        },
      ),
    );
  }, [props.persistenceKey]);

  const applySelection = useCallback(
    (selection: PersistedProviderModelPickerSelection | null) => {
      const resolvedSelection = selection ?? firstAvailableSelection;
      if (!resolvedSelection) {
        return;
      }
      if (
        props.activeInstanceId === resolvedSelection.instanceId &&
        props.model === resolvedSelection.model
      ) {
        return;
      }
      props.onInstanceModelChange(resolvedSelection.instanceId, resolvedSelection.model);
    },
    [firstAvailableSelection, props.activeInstanceId, props.model, props.onInstanceModelChange],
  );

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    persistSelection({ instanceId, model });
    props.onInstanceModelChange(instanceId, model);
    setIsMenuOpen(false);
  };

  const handleResetToDefault = useCallback(() => {
    clearPersistedSelection();
    const defaultSelection = resolveSelectionIfValid(defaultSelectionRef.current) ?? firstAvailableSelection;
    if (defaultSelection) {
      props.onInstanceModelChange(defaultSelection.instanceId, defaultSelection.model);
    }
    setIsMenuOpen(false);
  }, [
    clearPersistedSelection,
    firstAvailableSelection,
    props.onInstanceModelChange,
    resolveSelectionIfValid,
  ]);

  useEffect(() => {
    if (!props.persistenceKey || typeof window === "undefined") {
      return;
    }
    const persistenceKey = props.persistenceKey;

    const resolvePersistedSelection = (): PersistedProviderModelPickerSelection | null => {
      const persistedSelection = parsePersistedProviderModelPickerSelection(window.localStorage.getItem(persistenceKey));
      if (!persistedSelection) {
        return null;
      }
      return resolveSelectionIfValid(persistedSelection) ?? firstAvailableSelection;
    };

    const syncFromPersistence = () => {
      applySelection(resolvePersistedSelection());
    };

    syncFromPersistence();

    const onStorage = (event: StorageEvent) => {
      if (event.key === persistenceKey) {
        syncFromPersistence();
      }
    };
    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<PersistedProviderModelPickerSelection | null>).detail;
      if (detail === undefined) {
        return;
      }
      syncFromPersistence();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(PROVIDER_MODEL_PICKER_PERSIST_EVENT, onLocalChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PROVIDER_MODEL_PICKER_PERSIST_EVENT, onLocalChange);
    };
  }, [
    applySelection,
    firstAvailableSelection,
    props.instanceEntries,
    props.lockedContinuationGroupKey,
    props.lockedProvider,
    props.modelOptionsByInstance,
    props.persistenceKey,
    resolveSelectionIfValid,
  ]);

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
          {...(props.persistenceKey ? { onResetToDefault: handleResetToDefault } : {})}
          onRequestClose={() => setIsMenuOpen(false)}
          onInstanceModelChange={handleInstanceModelChange}
        />
      </PopoverPopup>
    </Popover>
  );
});

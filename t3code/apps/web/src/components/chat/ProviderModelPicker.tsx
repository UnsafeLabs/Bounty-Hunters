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
import {
  PROVIDER_MODEL_PICKER_STORAGE_KEY,
  readPersistedSelection,
  writePersistedSelection,
  clearPersistedSelection,
  isSelectionValid,
  resolveDefaultSelection,
  type KeyValueStorage,
} from "./providerModelPickerStorage";

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

  // --- localStorage persistence (issue #834) ---------------------------------
  const didRestore = useRef(false);
  const storage: KeyValueStorage | null =
    typeof window !== "undefined" && window.localStorage
      ? (window.localStorage as KeyValueStorage)
      : null;

  // On mount (once the instance list is available) restore the persisted
  // selection. Invalid persisted values are cleared and the selection falls
  // back to the first available provider/model.
  useEffect(() => {
    if (didRestore.current) return;
    if (props.instanceEntries.length === 0) return; // wait for entries to load
    didRestore.current = true;
    if (!storage) return;
    const deps = {
      instanceEntries: props.instanceEntries,
      modelOptionsByInstance: props.modelOptionsByInstance,
    };
    const persisted = readPersistedSelection(storage);
    if (persisted && isSelectionValid(persisted, deps)) {
      if (persisted.instanceId !== props.activeInstanceId || persisted.model !== props.model) {
        props.onInstanceModelChange(persisted.instanceId as ProviderInstanceId, persisted.model);
      }
    } else if (persisted) {
      clearPersistedSelection(storage);
      const def = resolveDefaultSelection(deps);
      if (def) {
        props.onInstanceModelChange(def.instanceId as ProviderInstanceId, def.model);
      }
    }
  }, [props.instanceEntries, props.modelOptionsByInstance]);

  // Keep other browser tabs in sync: a storage event for our key restores the
  // newly written selection (or falls back when it is invalid).
  useEffect(() => {
    if (!storage) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PROVIDER_MODEL_PICKER_STORAGE_KEY) return;
      const deps = {
        instanceEntries: props.instanceEntries,
        modelOptionsByInstance: props.modelOptionsByInstance,
      };
      const persisted = readPersistedSelection(storage);
      if (persisted && isSelectionValid(persisted, deps)) {
        props.onInstanceModelChange(persisted.instanceId as ProviderInstanceId, persisted.model);
      } else if (persisted) {
        clearPersistedSelection(storage);
        const def = resolveDefaultSelection(deps);
        if (def) {
          props.onInstanceModelChange(def.instanceId as ProviderInstanceId, def.model);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [props.instanceEntries, props.modelOptionsByInstance, props.onInstanceModelChange]);

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    props.onInstanceModelChange(instanceId, model);
    setIsMenuOpen(false);
    if (storage) {
      writePersistedSelection(storage, { instanceId: String(instanceId), model });
    }
  };

  const handleResetToDefault = () => {
    if (props.disabled) return;
    if (storage) {
      clearPersistedSelection(storage);
    }
    const deps = {
      instanceEntries: props.instanceEntries,
      modelOptionsByInstance: props.modelOptionsByInstance,
    };
    const def = resolveDefaultSelection(deps);
    if (def) {
      props.onInstanceModelChange(def.instanceId as ProviderInstanceId, def.model);
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
        <div className="flex items-center justify-center border-t border-border/60 px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetToDefault}
            disabled={props.disabled}
            className="text-muted-foreground/70 hover:text-foreground/80"
          >
            Reset to default
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
});

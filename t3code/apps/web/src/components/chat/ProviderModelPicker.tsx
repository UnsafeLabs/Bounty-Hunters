import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDownIcon, RotateCcwIcon } from "lucide-react";
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

const STORAGE_KEY_PROVIDER = "t3code:provider";
const STORAGE_KEY_MODEL = "t3code:model";

function readPersistedProviderId(): ProviderInstanceId | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY_PROVIDER);
    return value as ProviderInstanceId | null;
  } catch {
    return null;
  }
}

function readPersistedModelId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_MODEL);
  } catch {
    return null;
  }
}

function persistSelection(instanceId: ProviderInstanceId, model: string) {
  try {
    localStorage.setItem(STORAGE_KEY_PROVIDER, instanceId);
    localStorage.setItem(STORAGE_KEY_MODEL, model);
  } catch {
    // Ignore storage errors (e.g. quota exceeded, private browsing)
  }
}

function clearPersistedSelection() {
  try {
    localStorage.removeItem(STORAGE_KEY_PROVIDER);
    localStorage.removeItem(STORAGE_KEY_MODEL);
  } catch {
    // Ignore storage errors
  }
}

/** Find a valid model slug for the given instance, falling back to the first option. */
function resolveModelForInstance(
  instanceId: ProviderInstanceId,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
  preferredModel?: string | null,
): string {
  const options = modelOptionsByInstance.get(instanceId);
  if (!options || options.length === 0) return "";
  if (preferredModel) {
    const match = options.find((o) => o.slug === preferredModel);
    if (match) return match.slug;
  }
  return options[0].slug;
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

  // Persist selection to localStorage whenever the user makes a new choice.
  const handleInstanceModelChange = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (props.disabled) return;
      persistSelection(instanceId, model);
      props.onInstanceModelChange(instanceId, model);
      setIsMenuOpen(false);
    },
    [props.disabled, props.onInstanceModelChange],
  );

  // On mount, read persisted values from localStorage and restore the
  // selection by calling the parent callback with the stored values.
  // If the persisted provider is unavailable, fall back to the first available.
  useEffect(() => {
    const persistedProviderId = readPersistedProviderId();
    const persistedModelId = readPersistedModelId();
    if (!persistedProviderId) return;

    const availableIds = new Set(
      props.instanceEntries.map((entry) => entry.instanceId),
    );
    const validProviderId = availableIds.has(persistedProviderId)
      ? persistedProviderId
      : props.instanceEntries[0]?.instanceId;
    if (!validProviderId) return;

    const resolvedModel = resolveModelForInstance(
      validProviderId,
      props.modelOptionsByInstance,
      persistedModelId,
    );
    if (!resolvedModel) return;

    // Only call parent if the persisted values differ from current props
    // to avoid unnecessary re-renders.
    if (
      validProviderId !== props.activeInstanceId ||
      resolvedModel !== resolveModelForInstance(
        props.activeInstanceId,
        props.modelOptionsByInstance,
        props.model,
      )
    ) {
      props.onInstanceModelChange(validProviderId, resolvedModel);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-tab sync: listen for storage events from other tabs and apply
  // the persisted selection from localStorage.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== STORAGE_KEY_PROVIDER &&
        event.key !== STORAGE_KEY_MODEL
      ) {
        return;
      }
      const providerId = readPersistedProviderId();
      const modelId = readPersistedModelId();
      if (!providerId) return;

      const availableIds = new Set(
        props.instanceEntries.map((entry) => entry.instanceId),
      );
      const validProviderId = availableIds.has(providerId)
        ? providerId
        : props.instanceEntries[0]?.instanceId;
      if (!validProviderId) return;

      const resolvedModel = resolveModelForInstance(
        validProviderId,
        props.modelOptionsByInstance,
        modelId,
      );
      if (!resolvedModel) return;

      props.onInstanceModelChange(validProviderId, resolvedModel);
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [props.instanceEntries, props.modelOptionsByInstance, props.onInstanceModelChange]);

  // Reset to default: clear localStorage and revert to the first available
  // provider and its first model option.
  const handleResetToDefault = useCallback(() => {
    clearPersistedSelection();
    const firstEntry = props.instanceEntries[0];
    if (!firstEntry) return;
    const firstModel = resolveModelForInstance(
      firstEntry.instanceId,
      props.modelOptionsByInstance,
    );
    if (firstModel) {
      props.onInstanceModelChange(firstEntry.instanceId, firstModel);
    }
  }, [props.instanceEntries, props.modelOptionsByInstance, props.onInstanceModelChange]);

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
        <div className="flex flex-col gap-2">
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
          <div className="flex items-center justify-end border-t border-border/50 px-2 pt-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleResetToDefault}
            >
              <RotateCcwIcon className="size-3" />
              Reset to default
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});

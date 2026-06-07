import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { memo, useEffect, useMemo, useState } from "react";
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

const PROVIDER_MODEL_PICKER_STORAGE_KEY = "t3code:provider-model-picker-selection:v1";

type PersistedProviderModelSelection = {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
};

function readPersistedProviderModelSelection(): PersistedProviderModelSelection | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(PROVIDER_MODEL_PICKER_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedProviderModelSelection>;
    if (typeof parsed.instanceId !== "string" || typeof parsed.model !== "string") {
      return null;
    }
    return {
      instanceId: parsed.instanceId as ProviderInstanceId,
      model: parsed.model,
    };
  } catch {
    return null;
  }
}

function hasPersistedProviderModelSelection(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(PROVIDER_MODEL_PICKER_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function persistProviderModelSelection(selection: PersistedProviderModelSelection): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PROVIDER_MODEL_PICKER_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Ignore storage failures; the picker should remain fully usable.
  }
}

function clearPersistedProviderModelSelection(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(PROVIDER_MODEL_PICKER_STORAGE_KEY);
  } catch {
    // Ignore storage failures; reset still falls back in-memory.
  }
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

  const resolvePersistedSelection = (selection: PersistedProviderModelSelection | null) => {
    if (!selection) {
      return null;
    }
    const entry = props.instanceEntries.find((item) => item.instanceId === selection.instanceId);
    const options = props.modelOptionsByInstance.get(selection.instanceId) ?? [];
    if (!entry || options.length === 0) {
      return null;
    }
    const model = options.find((option) => option.slug === selection.model);
    if (!model) {
      return null;
    }
    return {
      instanceId: selection.instanceId,
      model: model.slug,
    };
  };

  const resolveDefaultSelection = () => {
    for (const entry of props.instanceEntries) {
      const options = props.modelOptionsByInstance.get(entry.instanceId) ?? [];
      const firstModel = options[0];
      if (firstModel) {
        return {
          instanceId: entry.instanceId,
          model: firstModel.slug,
        };
      }
    }
    return null;
  };

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
    if (props.lockedProvider !== null || props.disabled) {
      return;
    }
    const hasPersistedSelection = hasPersistedProviderModelSelection();
    const selection =
      resolvePersistedSelection(readPersistedProviderModelSelection()) ??
      (hasPersistedSelection ? resolveDefaultSelection() : null);
    if (!selection) {
      return;
    }
    if (selection.instanceId === props.activeInstanceId && selection.model === props.model) {
      return;
    }
    props.onInstanceModelChange(selection.instanceId, selection.model);
  }, [
    props.activeInstanceId,
    props.disabled,
    props.instanceEntries,
    props.lockedProvider,
    props.model,
    props.modelOptionsByInstance,
    props.onInstanceModelChange,
  ]);

  useEffect(() => {
    if (props.lockedProvider !== null || props.disabled || typeof window === "undefined") {
      return;
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PROVIDER_MODEL_PICKER_STORAGE_KEY) {
        return;
      }
      const selection = resolvePersistedSelection(readPersistedProviderModelSelection());
      const nextSelection = selection ?? resolveDefaultSelection();
      if (!nextSelection) {
        return;
      }
      if (nextSelection.instanceId === props.activeInstanceId && nextSelection.model === props.model) {
        return;
      }
      props.onInstanceModelChange(nextSelection.instanceId, nextSelection.model);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [
    props.activeInstanceId,
    props.disabled,
    props.instanceEntries,
    props.lockedProvider,
    props.model,
    props.modelOptionsByInstance,
    props.onInstanceModelChange,
  ]);

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    if (props.lockedProvider === null) {
      persistProviderModelSelection({ instanceId, model });
    }
    props.onInstanceModelChange(instanceId, model);
    setIsMenuOpen(false);
  };

  const handleResetToDefault = () => {
    if (props.disabled) return;
    clearPersistedProviderModelSelection();
    const defaultSelection = resolveDefaultSelection();
    if (defaultSelection) {
      props.onInstanceModelChange(defaultSelection.instanceId, defaultSelection.model);
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
          {...(props.lockedProvider === null ? { onResetToDefault: handleResetToDefault } : {})}
          onInstanceModelChange={handleInstanceModelChange}
        />
      </PopoverPopup>
    </Popover>
  );
});

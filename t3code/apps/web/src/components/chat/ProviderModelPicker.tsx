import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const PERSISTENCE_KEY = "t3code:provider-model-preference";

interface PersistedPreference {
  instanceId: ProviderInstanceId;
  model: string;
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

  // Track whether we've already attempted to restore from localStorage on mount.
  // We use a ref so it persists across re-renders but resets on unmount/remount.
  const hasRestoredRef = useRef(false);

  // Restore persisted provider/model selection on mount.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    try {
      const raw = localStorage.getItem(PERSISTENCE_KEY);
      if (!raw) return;
      const pref: PersistedPreference = JSON.parse(raw);
      if (!pref.instanceId || !pref.model) return;

      // Only restore if the persisted instance still exists in the available entries.
      const exists = props.instanceEntries.some(
        (entry) => entry.instanceId === pref.instanceId,
      );
      if (!exists) {
        // Stale preference — clear it and fall back to default.
        localStorage.removeItem(PERSISTENCE_KEY);
        return;
      }

      // Only restore if it differs from the current selection to avoid
      // an unnecessary re-render loop.
      if (
        pref.instanceId !== props.activeInstanceId ||
        pref.model !== props.model
      ) {
        props.onInstanceModelChange(pref.instanceId, pref.model);
      }
    } catch {
      // Corrupted data — clear it.
      localStorage.removeItem(PERSISTENCE_KEY);
    }
    // We only want this to fire on mount — don't re-run when props change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist selection to localStorage whenever it changes.
  const prevSelectionRef = useRef<{ instanceId: string; model: string } | null>(null);
  useEffect(() => {
    const current = { instanceId: props.activeInstanceId, model: props.model };
    if (
      prevSelectionRef.current?.instanceId === current.instanceId &&
      prevSelectionRef.current?.model === current.model
    ) {
      return;
    }
    prevSelectionRef.current = current;
    try {
      localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(current));
    } catch {
      // localStorage may be full or unavailable — silently ignore.
    }
  }, [props.activeInstanceId, props.model]);

  // Sync persisted preference across browser tabs via the storage event.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== PERSISTENCE_KEY || !e.newValue) return;
      try {
        const pref: PersistedPreference = JSON.parse(e.newValue);
        if (!pref.instanceId || !pref.model) return;

        const exists = props.instanceEntries.some(
          (entry) => entry.instanceId === pref.instanceId,
        );
        if (!exists) return;

        if (
          pref.instanceId !== props.activeInstanceId ||
          pref.model !== props.model
        ) {
          props.onInstanceModelChange(pref.instanceId, pref.model);
        }
      } catch {
        // Ignore parse errors from other tabs.
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [props.activeInstanceId, props.model, props.instanceEntries, props.onInstanceModelChange]);

  // Clear persisted preference and reset to the first available provider/model.
  const handleResetToDefault = useCallback(() => {
    localStorage.removeItem(PERSISTENCE_KEY);
    const firstEntry = props.instanceEntries[0];
    if (firstEntry) {
      const firstModel =
        props.modelOptionsByInstance.get(firstEntry.instanceId)?.[0];
      if (firstModel) {
        props.onInstanceModelChange(firstEntry.instanceId, firstModel.slug);
      }
    }
    setIsMenuOpen(false);
  }, [props.instanceEntries, props.modelOptionsByInstance, props.onInstanceModelChange]);

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

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
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
        <div className="border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground transition-colors"
          >
            <RotateCcwIcon className="size-3" />
            Reset to default
          </button>
        </div>
      </PopoverPopup>
    </Popover>
  );
});

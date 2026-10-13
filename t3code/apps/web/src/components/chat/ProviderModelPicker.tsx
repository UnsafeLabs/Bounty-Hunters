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
  clearPersistedProviderModelSelection,
  getProviderModelPickerStorage,
  isProviderModelPickerStorageKey,
  readProviderModelPickerStorageChange,
  readPersistedProviderModelSelection,
  resolveRestoredProviderModelSelection,
  writePersistedProviderModelSelection,
} from "./providerModelPickerPersistence";

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
  /**
   * Persist the picked provider/model to the namespaced localStorage keys
   * (`t3code.provider` / `t3code.model`), restore them on mount, keep other
   * tabs in sync via the `storage` event, and offer a "Reset to default"
   * rail action. Consumers that own their selection persistence themselves
   * (e.g. the settings panel storing into unified settings) can opt out.
   * @default true
   */
  persistSelection?: boolean;
  onOpenChange?: (open: boolean) => void;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;
  const persistSelection = props.persistSelection ?? true;

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

  // ── Selection persistence (UnsafeLabs/Bounty-Hunters#834) ─────────────
  //
  // The component stays controlled: restoring simply pushes the persisted
  // pick back up through `onInstanceModelChange`, and only user selections
  // (or a cross-tab `storage` event) write to localStorage. Restore is a
  // one-shot — it waits for provider data, then yields permanently to any
  // selection made through the picker afterwards.

  const restoreAttemptedRef = useRef(false);
  const lockedContinuationGroupKey = props.lockedContinuationGroupKey ?? null;
  // Alias for the exhaustive-deps rule: effects below call it, so the
  // dependency array needs a stable local name rather than `props`.
  const onInstanceModelChange = props.onInstanceModelChange;

  useEffect(() => {
    if (!persistSelection || restoreAttemptedRef.current) return;
    // A locked picker edits an already-sent turn; the owner pins the
    // instance, so persisted preferences must not re-route it.
    if (props.disabled || props.lockedProvider !== null) return;
    // Provider snapshots arrive asynchronously — retry once they land.
    if (props.instanceEntries.length === 0) return;
    const storage = getProviderModelPickerStorage();
    if (!storage) {
      restoreAttemptedRef.current = true;
      return;
    }
    const persisted = readPersistedProviderModelSelection(storage);
    // Empty storage means the default behavior stays untouched.
    if (!persisted) {
      restoreAttemptedRef.current = true;
      return;
    }
    const resolved = resolveRestoredProviderModelSelection({
      persisted,
      instanceEntries: props.instanceEntries,
      modelOptionsByInstance: props.modelOptionsByInstance,
      lockedProvider: props.lockedProvider,
      lockedContinuationGroupKey,
    });
    if (!resolved) {
      // Nothing selectable yet — retry once model options arrive.
      return;
    }
    restoreAttemptedRef.current = true;
    if (resolved.instanceId === activeInstanceId && resolved.model === props.model) return;
    onInstanceModelChange(resolved.instanceId, resolved.model);
  }, [
    activeInstanceId,
    lockedContinuationGroupKey,
    onInstanceModelChange,
    persistSelection,
    props.disabled,
    props.instanceEntries,
    props.lockedProvider,
    props.model,
    props.modelOptionsByInstance,
  ]);

  // Cross-tab sync: apply selections — and resets — persisted by another
  // tab. The `storage` event only fires in tabs that did not perform the
  // write, so this never echoes our own selections back.
  useEffect(() => {
    if (!persistSelection) return;
    const handleStorage = (event: StorageEvent) => {
      if (!isProviderModelPickerStorageKey(event.key)) return;
      if (props.disabled || props.lockedProvider !== null) return;
      const storage = getProviderModelPickerStorage();
      if (!storage) return;
      const change = readProviderModelPickerStorageChange(storage);
      if (!change) return;
      const resolved = resolveRestoredProviderModelSelection({
        persisted: change.kind === "selection" ? change.persisted : null,
        instanceEntries: props.instanceEntries,
        modelOptionsByInstance: props.modelOptionsByInstance,
        lockedProvider: props.lockedProvider,
        lockedContinuationGroupKey,
      });
      if (!resolved) return;
      restoreAttemptedRef.current = true;
      if (resolved.instanceId === activeInstanceId && resolved.model === props.model) return;
      onInstanceModelChange(resolved.instanceId, resolved.model);
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [
    activeInstanceId,
    lockedContinuationGroupKey,
    onInstanceModelChange,
    persistSelection,
    props.disabled,
    props.instanceEntries,
    props.lockedProvider,
    props.model,
    props.modelOptionsByInstance,
  ]);

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    if (persistSelection) {
      const storage = getProviderModelPickerStorage();
      if (storage) {
        writePersistedProviderModelSelection(storage, instanceId, model);
      }
    }
    // The user picked something — a pending restore must not override it.
    restoreAttemptedRef.current = true;
    props.onInstanceModelChange(instanceId, model);
    setIsMenuOpen(false);
  };

  const handleResetToDefault = () => {
    if (props.disabled || props.lockedProvider !== null) return;
    const storage = getProviderModelPickerStorage();
    if (storage) {
      clearPersistedProviderModelSelection(storage);
    }
    restoreAttemptedRef.current = true;
    const resolved = resolveRestoredProviderModelSelection({
      persisted: null,
      instanceEntries: props.instanceEntries,
      modelOptionsByInstance: props.modelOptionsByInstance,
      lockedProvider: props.lockedProvider,
      lockedContinuationGroupKey,
    });
    if (resolved && (resolved.instanceId !== activeInstanceId || resolved.model !== props.model)) {
      props.onInstanceModelChange(resolved.instanceId, resolved.model);
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
          onResetSelection={
            persistSelection && props.lockedProvider === null ? handleResetToDefault : null
          }
          onRequestClose={() => setIsMenuOpen(false)}
          onInstanceModelChange={handleInstanceModelChange}
        />
      </PopoverPopup>
    </Popover>
  );
});

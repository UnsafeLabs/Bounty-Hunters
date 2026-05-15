import {
  ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
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
import { useLocalStorage } from "../../hooks/useLocalStorage";

const ProviderModelPickerPreferenceSchema = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: Schema.String,
});

type ProviderModelPickerPreference = typeof ProviderModelPickerPreferenceSchema.Type;

function resolveSelectableEntries(
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
) {
  const withReadyModels = instanceEntries.filter((entry) => {
    const models = modelOptionsByInstance.get(entry.instanceId) ?? [];
    return entry.status === "ready" && models.length > 0;
  });
  if (withReadyModels.length > 0) {
    return withReadyModels;
  }
  return instanceEntries.filter((entry) => {
    const models = modelOptionsByInstance.get(entry.instanceId) ?? [];
    return models.length > 0;
  });
}

function resolveProviderModelPickerPreference(
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
  preference: ProviderModelPickerPreference | null,
): ProviderModelPickerPreference | null {
  const selectableEntries = resolveSelectableEntries(instanceEntries, modelOptionsByInstance);
  if (selectableEntries.length === 0) {
    return null;
  }

  const preferredEntry =
    (preference
      ? selectableEntries.find((entry) => entry.instanceId === preference.instanceId)
      : null) ?? selectableEntries[0]!;
  const preferredModels = modelOptionsByInstance.get(preferredEntry.instanceId) ?? [];
  if (preferredModels.length === 0) {
    return null;
  }

  const preferredModel =
    (preference
      ? preferredModels.find((option) => option.slug === preference.model)?.slug
      : null) ?? preferredModels[0]!.slug;

  return {
    instanceId: preferredEntry.instanceId,
    model: preferredModel,
  };
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
  persistenceKey?: string | null;
  onOpenChange?: (open: boolean) => void;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;
  const [persistedPreference, setPersistedPreference] = useLocalStorage(
    props.persistenceKey ?? "__provider-model-picker:disabled__",
    null,
    Schema.NullOr(ProviderModelPickerPreferenceSchema),
  );
  const previousPersistedPreferenceRef = useRef<ProviderModelPickerPreference | null | undefined>(
    undefined,
  );

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
  const defaultPreference = useMemo(
    () =>
      resolveProviderModelPickerPreference(
        props.instanceEntries,
        props.modelOptionsByInstance,
        null,
      ),
    [props.instanceEntries, props.modelOptionsByInstance],
  );
  const resolvedPersistedPreference = useMemo(
    () =>
      props.persistenceKey
        ? resolveProviderModelPickerPreference(
            props.instanceEntries,
            props.modelOptionsByInstance,
            persistedPreference,
          )
        : null,
    [
      persistedPreference,
      props.instanceEntries,
      props.modelOptionsByInstance,
      props.persistenceKey,
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

  useEffect(() => {
    if (!props.persistenceKey) {
      return;
    }

    const previousPersistedPreference = previousPersistedPreferenceRef.current;
    previousPersistedPreferenceRef.current = persistedPreference;

    if (persistedPreference === null) {
      if (
        previousPersistedPreference !== undefined &&
        previousPersistedPreference !== null &&
        defaultPreference &&
        (props.activeInstanceId !== defaultPreference.instanceId ||
          props.model !== defaultPreference.model)
      ) {
        props.onInstanceModelChange(defaultPreference.instanceId, defaultPreference.model);
      }
      return;
    }

    if (resolvedPersistedPreference === null) {
      return;
    }

    if (
      persistedPreference.instanceId !== resolvedPersistedPreference.instanceId ||
      persistedPreference.model !== resolvedPersistedPreference.model
    ) {
      setPersistedPreference(resolvedPersistedPreference);
    }

    if (
      props.activeInstanceId !== resolvedPersistedPreference.instanceId ||
      props.model !== resolvedPersistedPreference.model
    ) {
      props.onInstanceModelChange(
        resolvedPersistedPreference.instanceId as ProviderInstanceId,
        resolvedPersistedPreference.model,
      );
    }
  }, [
    defaultPreference,
    persistedPreference,
    props.activeInstanceId,
    props.model,
    props.onInstanceModelChange,
    props.persistenceKey,
    resolvedPersistedPreference,
    setPersistedPreference,
  ]);

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    if (props.persistenceKey) {
      setPersistedPreference({ instanceId, model });
    }
    props.onInstanceModelChange(instanceId, model);
    setIsMenuOpen(false);
  };

  const handleResetToDefault = () => {
    if (props.disabled || !props.persistenceKey) {
      return;
    }
    setPersistedPreference(null);
    if (
      defaultPreference &&
      (props.activeInstanceId !== defaultPreference.instanceId ||
        props.model !== defaultPreference.model)
    ) {
      props.onInstanceModelChange(
        defaultPreference.instanceId as ProviderInstanceId,
        defaultPreference.model,
      );
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
          showResetToDefault={Boolean(props.persistenceKey)}
          disableResetToDefault={persistedPreference === null}
          onResetToDefault={handleResetToDefault}
          onRequestClose={() => setIsMenuOpen(false)}
          onInstanceModelChange={handleInstanceModelChange}
        />
      </PopoverPopup>
    </Popover>
  );
});

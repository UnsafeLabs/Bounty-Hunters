import {
  BanIcon,
  ClockIcon,
  DownloadIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { isElectron } from "../../env";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktopUpdateReactQuery";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "../desktopUpdate.logic";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function formatBytes(bytes: number | null): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === "GB") {
      return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return null;
}

export function SidebarUpdatePill() {
  const queryClient = useQueryClient();
  const state = useDesktopUpdateState().data ?? null;
  const [dismissed, setDismissed] = useState(false);

  const visible = isElectron && shouldShowDesktopUpdateButton(state) && !dismissed;
  const tooltip = state ? getDesktopUpdateButtonTooltip(state) : "Update available";
  const disabled = isDesktopUpdateButtonDisabled(state);
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";

  const showArm64Warning = isElectron && shouldShowArm64IntelBuildWarning(state);
  const arm64Description =
    state && showArm64Warning ? getArm64IntelBuildWarningDescription(state) : null;

  const handleAction = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !state) return;
    if (disabled || action === "none") return;

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not download update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not start update download",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(getDesktopUpdateInstallConfirmationMessage(state));
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
    }
  }, [action, disabled, queryClient, state]);

  const handleDeferredAction = useCallback(
    (nextAction: "defer" | "skip") => {
      const bridge = window.desktopBridge;
      if (!bridge || !state || action !== "download") return;

      const request =
        nextAction === "defer" ? bridge.deferUpdate?.() : bridge.skipUpdateVersion?.();
      if (!request) return;

      void request
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
          toastManager.add({
            type: "success",
            title: nextAction === "defer" ? "Update deferred" : "Update skipped",
            description:
              nextAction === "defer"
                ? "This update will be shown again after 24 hours."
                : "This version will stay hidden across restarts.",
          });
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: nextAction === "defer" ? "Could not defer update" : "Could not skip update",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
    },
    [action, queryClient, state],
  );

  if (!visible && !showArm64Warning) return null;

  const transferredLabel = state ? formatBytes(state.downloadTransferredBytes) : null;
  const totalLabel = state ? formatBytes(state.downloadTotalBytes) : null;
  const progressLabel =
    transferredLabel && totalLabel
      ? `${transferredLabel} of ${totalLabel}`
      : (transferredLabel ?? null);
  const progressValue =
    state && typeof state.downloadPercent === "number"
      ? Math.min(100, Math.max(0, state.downloadPercent))
      : null;
  const releaseNotes = state?.releaseNotes?.trim() ? state.releaseNotes.trim() : null;

  return (
    <div className="flex flex-col gap-1">
      {showArm64Warning && arm64Description && (
        <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8 text-xs">
          <TriangleAlertIcon />
          <AlertTitle>Intel build on Apple Silicon</AlertTitle>
          <AlertDescription>{arm64Description}</AlertDescription>
        </Alert>
      )}
      {visible && (
        <div
          className={`group/update relative flex w-full flex-col overflow-hidden rounded-lg bg-primary/15 text-xs font-medium text-primary ${
            disabled ? " cursor-not-allowed opacity-60" : ""
          }`}
        >
          <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors group-has-[button.update-main:hover]/update:bg-primary/22" />
          <div className="relative flex min-h-7 w-full items-center">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={tooltip}
                    aria-disabled={disabled || undefined}
                    disabled={disabled}
                    className="update-main relative flex min-h-7 flex-1 items-center gap-2 px-2 enabled:cursor-pointer"
                    onClick={handleAction}
                  >
                    {action === "install" ? (
                      <>
                        <RotateCwIcon className="size-3.5" />
                        <span>Restart to update</span>
                      </>
                    ) : state?.status === "downloading" ? (
                      <>
                        <DownloadIcon className="size-3.5" />
                        <span>
                          Downloading
                          {typeof state.downloadPercent === "number"
                            ? ` (${Math.floor(state.downloadPercent)}%)`
                            : "..."}
                        </span>
                      </>
                    ) : (
                      <>
                        <DownloadIcon className="size-3.5" />
                        <span>Update available</span>
                      </>
                    )}
                  </button>
                }
              />
              <TooltipPopup side="top">{tooltip}</TooltipPopup>
            </Tooltip>
          </div>
          {state?.status === "downloading" && progressValue !== null && (
            <div className="relative px-2 pb-2">
              <div className="h-1 overflow-hidden rounded bg-primary/20">
                <div className="h-full bg-primary" style={{ width: `${progressValue}%` }} />
              </div>
              {progressLabel && (
                <div className="mt-1 text-[10px] text-primary/70">{progressLabel}</div>
              )}
            </div>
          )}
          {action === "download" && releaseNotes && (
            <div className="relative mx-2 mb-1 line-clamp-3 text-[10px] font-normal text-primary/75">
              {releaseNotes}
            </div>
          )}
          {action === "download" && (
            <div className="relative flex items-center gap-1 px-1 pb-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Remind me later"
                      className="inline-flex size-6 items-center justify-center rounded-md text-primary/70 transition-colors hover:bg-primary/12 hover:text-primary"
                      onClick={() => handleDeferredAction("defer")}
                    >
                      <ClockIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="top">Remind me later</TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Skip this version"
                      className="inline-flex size-6 items-center justify-center rounded-md text-primary/70 transition-colors hover:bg-primary/12 hover:text-primary"
                      onClick={() => handleDeferredAction("skip")}
                    >
                      <BanIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="top">Skip this version</TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Dismiss update"
                      className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-primary/70 transition-colors hover:bg-primary/12 hover:text-primary"
                      onClick={() => setDismissed(true)}
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="top">Dismiss until next launch</TooltipPopup>
              </Tooltip>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

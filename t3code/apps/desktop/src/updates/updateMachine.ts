import type {
  DesktopRuntimeInfo,
  DesktopUpdateChannel,
  DesktopUpdateState,
} from "@t3tools/contracts";

export function nextStatusAfterDownloadFailure(
  currentState: DesktopUpdateState,
): DesktopUpdateState["status"] {
  return currentState.availableVersion ? "available" : "error";
}

export function getCanRetryAfterDownloadFailure(currentState: DesktopUpdateState): boolean {
  return currentState.availableVersion !== null;
}

export function createInitialDesktopUpdateState(
  currentVersion: string,
  runtimeInfo: DesktopRuntimeInfo,
  channel: DesktopUpdateChannel,
): DesktopUpdateState {
  return {
    enabled: false,
    status: "disabled",
    channel,
    currentVersion,
    hostArch: runtimeInfo.hostArch,
    appArch: runtimeInfo.appArch,
    runningUnderArm64Translation: runtimeInfo.runningUnderArm64Translation,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    releaseNotes: null,
    deferredUpdateVersion: null,
    deferredUpdateUntil: null,
    skippedUpdateVersion: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnCheckStart(
  state: DesktopUpdateState,
  checkedAt: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "checking",
    checkedAt,
    message: null,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnCheckFailure(
  state: DesktopUpdateState,
  message: string,
  checkedAt: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "error",
    message,
    checkedAt,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    errorContext: "check",
    canRetry: true,
  };
}

export function reduceDesktopUpdateStateOnUpdateAvailable(
  state: DesktopUpdateState,
  version: string,
  checkedAt: string,
  releaseNotes: string | null = null,
): DesktopUpdateState {
  return {
    ...state,
    status: "available",
    availableVersion: version,
    downloadedVersion: null,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    releaseNotes,
    checkedAt,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnNoUpdate(
  state: DesktopUpdateState,
  checkedAt: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "up-to-date",
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    releaseNotes: null,
    checkedAt,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnDownloadStart(
  state: DesktopUpdateState,
): DesktopUpdateState {
  return {
    ...state,
    status: "downloading",
    downloadPercent: 0,
    downloadTransferredBytes: 0,
    downloadTotalBytes: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnDownloadFailure(
  state: DesktopUpdateState,
  message: string,
): DesktopUpdateState {
  return {
    ...state,
    status: nextStatusAfterDownloadFailure(state),
    message,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    errorContext: "download",
    canRetry: getCanRetryAfterDownloadFailure(state),
  };
}

export function reduceDesktopUpdateStateOnDownloadProgress(
  state: DesktopUpdateState,
  percent: number,
  transferredBytes: number | null = null,
  totalBytes: number | null = null,
): DesktopUpdateState {
  return {
    ...state,
    status: "downloading",
    downloadPercent: percent,
    downloadTransferredBytes: transferredBytes,
    downloadTotalBytes: totalBytes,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnDownloadComplete(
  state: DesktopUpdateState,
  version: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "downloaded",
    availableVersion: version,
    downloadedVersion: version,
    downloadPercent: 100,
    downloadTransferredBytes: state.downloadTotalBytes ?? state.downloadTransferredBytes,
    downloadTotalBytes: state.downloadTotalBytes,
    message: null,
    errorContext: null,
    canRetry: true,
  };
}

export function reduceDesktopUpdateStateOnUpdateDeferred(
  state: DesktopUpdateState,
  version: string,
  until: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "idle",
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    releaseNotes: null,
    deferredUpdateVersion: version,
    deferredUpdateUntil: until,
    message: `Update ${version} deferred until ${until}.`,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnUpdateSkipped(
  state: DesktopUpdateState,
  version: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "idle",
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    releaseNotes: null,
    deferredUpdateVersion: null,
    deferredUpdateUntil: null,
    skippedUpdateVersion: version,
    message: `Update ${version} skipped.`,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnInstallFailure(
  state: DesktopUpdateState,
  message: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "downloaded",
    message,
    errorContext: "install",
    canRetry: true,
  };
}

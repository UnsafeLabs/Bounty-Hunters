type DesktopMenuActionListener = (action: string) => void;

const listeners = new Set<DesktopMenuActionListener>();

export function dispatchDesktopMenuAction(action: string): void {
  for (const listener of listeners) {
    listener(action);
  }
}

export function subscribeDesktopMenuAction(listener: DesktopMenuActionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetDesktopMenuActionsForTests(): void {
  listeners.clear();
}

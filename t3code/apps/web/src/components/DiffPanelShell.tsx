import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export interface DiffLineComment {
  id: string;
  filePath: string;
  lineNumber: number;
  text: string;
  createdAt: string;
}

export interface DiffLineCommentsState {
  readonly comments: Record<string, DiffLineComment[]>;
  readonly activeLine: { filePath: string; lineNumber: number } | null;
}

const defaultCommentsState: DiffLineCommentsState = {
  comments: {},
  activeLine: null,
};

const DiffLineCommentsContext = createContext<{
  state: DiffLineCommentsState;
  setState: Dispatch<SetStateAction<DiffLineCommentsState>>;
}>({
  state: defaultCommentsState,
  setState: () => {},
});

function getCommentKey(filePath: string, lineNumber: number): string {
  return `${filePath}:${lineNumber}`;
}

export function useDiffLineComments() {
  const { state, setState } = useContext(DiffLineCommentsContext);

  const addComment = useCallback(
    (filePath: string, lineNumber: number, text: string) => {
      const comment: DiffLineComment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        filePath,
        lineNumber,
        text,
        createdAt: new Date().toISOString(),
      };
      setState((prev) => {
        const key = getCommentKey(filePath, lineNumber);
        const existing = prev.comments[key] ?? [];
        return {
          ...prev,
          comments: { ...prev.comments, [key]: [...existing, comment] },
        };
      });
    },
    [setState],
  );

  const getComments = useCallback(
    (filePath: string, lineNumber: number) => {
      return state.comments[getCommentKey(filePath, lineNumber)] ?? [];
    },
    [state.comments],
  );

  const getCommentCount = useCallback(
    (filePath: string, lineNumber: number) => {
      return getComments(filePath, lineNumber).length;
    },
    [getComments],
  );

  const setActiveLine = useCallback(
    (filePath: string, lineNumber: number) => {
      setState((prev) => ({
        ...prev,
        activeLine:
          prev.activeLine?.filePath === filePath && prev.activeLine?.lineNumber === lineNumber
            ? null
            : { filePath, lineNumber },
      }));
    },
    [setState],
  );

  const clearActiveLine = useCallback(() => {
    setState((prev) => ({ ...prev, activeLine: null }));
  }, [setState]);

  return { addComment, getComments, getCommentCount, setActiveLine, clearActiveLine, state };
}

export function DiffLineCommentButton(props: {
  filePath: string;
  lineNumber: number;
}) {
  const { getCommentCount, setActiveLine, state } = useDiffLineComments();
  const count = getCommentCount(props.filePath, props.lineNumber);
  const isActive =
    state.activeLine?.filePath === props.filePath &&
    state.activeLine?.lineNumber === props.lineNumber;

  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded px-1 text-[10px] font-medium transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : count > 0
            ? "bg-primary/10 text-primary hover:bg-primary/20"
            : "text-muted-foreground/40 opacity-0 hover:opacity-100 hover:text-muted-foreground",
      )}
      onClick={(e) => {
        e.stopPropagation();
        setActiveLine(props.filePath, props.lineNumber);
      }}
      aria-label={count > 0 ? `${count} comment${count !== 1 ? "s" : ""}` : "Add comment"}
    >
      {count > 0 && <span>{count}</span>}
    </button>
  );
}

export function DiffLineCommentInput(props: {
  filePath: string;
  lineNumber: number;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2 text-xs">
      <textarea
        className="min-h-[60px] w-full resize-none rounded border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:border-primary"
        placeholder="Add a comment..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="flex gap-1 justify-end">
        <Button
          variant="ghost"
          size="xs"
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          variant="default"
          size="xs"
          disabled={text.trim().length === 0}
          onClick={() => {
            props.onSubmit(text.trim());
            setText("");
          }}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}

export type DiffPanelMode = "inline" | "sheet" | "sidebar";

function getDiffPanelHeaderRowClassName(mode: DiffPanelMode) {
  const shouldUseDragRegion = isElectron && mode !== "sheet";
  return cn(
    "flex items-center justify-between gap-2 px-4",
    shouldUseDragRegion
      ? "drag-region h-[52px] border-b border-border wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]"
      : "h-12 wco:max-h-[env(titlebar-area-height)]",
  );
}

function DiffPanelShellInner(props: { children: ReactNode }) {
  const { state, addComment, clearActiveLine } = useDiffLineComments();

  return (
    <>
      {props.children}
      {state.activeLine ? (
        <div className="border-t border-border p-2">
          <DiffLineCommentInput
            filePath={state.activeLine.filePath}
            lineNumber={state.activeLine.lineNumber}
            onSubmit={(text) => {
              addComment(state.activeLine!.filePath, state.activeLine!.lineNumber, text);
              clearActiveLine();
            }}
            onCancel={clearActiveLine}
          />
        </div>
      ) : null}
    </>
  );
}

export function DiffPanelShell(props: {
  mode: DiffPanelMode;
  header: ReactNode;
  children: ReactNode;
}) {
  const shouldUseDragRegion = isElectron && props.mode !== "sheet";
  const [commentsState, setCommentsState] = useState<DiffLineCommentsState>(defaultCommentsState);
  const ctx = useMemo(() => ({ state: commentsState, setState: setCommentsState }), [commentsState]);

  return (
    <DiffLineCommentsContext.Provider value={ctx}>
      <div
        className={cn(
          "flex h-full min-w-0 flex-col bg-background",
          props.mode === "inline"
            ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-border"
            : "w-full",
        )}
      >
        {shouldUseDragRegion ? (
          <div className={getDiffPanelHeaderRowClassName(props.mode)}>{props.header}</div>
        ) : (
          <div className="border-b border-border">
            <div className={getDiffPanelHeaderRowClassName(props.mode)}>{props.header}</div>
          </div>
        )}
        <DiffPanelShellInner>{props.children}</DiffPanelShellInner>
      </div>
    </DiffLineCommentsContext.Provider>
  );
}

export function DiffPanelHeaderSkeleton() {
  return (
    <>
      <div className="relative min-w-0 flex-1">
        <Skeleton className="absolute left-0 top-1/2 size-6 -translate-y-1/2 rounded-md border border-border/50" />
        <Skeleton className="absolute right-0 top-1/2 size-6 -translate-y-1/2 rounded-md border border-border/50" />
        <div className="flex gap-1 overflow-hidden px-8 py-0.5">
          <Skeleton className="h-6 w-16 shrink-0 rounded-md" />
          <Skeleton className="h-6 w-24 shrink-0 rounded-md" />
          <Skeleton className="h-6 w-24 shrink-0 rounded-md max-sm:hidden" />
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="size-7 rounded-md" />
      </div>
    </>
  );
}

export function DiffPanelLoadingState(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-card/25"
        role="status"
        aria-live="polite"
        aria-label={props.label}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="ml-auto h-4 w-20 rounded-full" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 py-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-10/12 rounded-full" />
            <Skeleton className="h-3 w-11/12 rounded-full" />
            <Skeleton className="h-3 w-9/12 rounded-full" />
          </div>
          <span className="sr-only">{props.label}</span>
        </div>
      </div>
    </div>
  );
}

import { type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { type ReactNode } from "react";
import { shortcutLabelForCommand } from "../keybindings";
import {
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
  fuzzyMatch,
  type FuzzyMatchResult,
} from "./CommandPalette.logic";
import {
  CommandCollection,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./ui/command";
import { cn } from "~/lib/utils";

interface CommandPaletteResultsProps {
  emptyStateMessage?: string;
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
  isActionsOnly: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
  query?: string;
}

function highlightText(text: string, indices: readonly number[]): ReactNode {
  if (indices.length === 0) return text;
  const chars: ReactNode[] = [];
  const indicesSet = new Set(indices);
  for (let i = 0; i < text.length; i++) {
    if (indicesSet.has(i)) {
      chars.push(
        <mark key={i} className="rounded-sm bg-primary/20 text-foreground">
          {text[i]}
        </mark>,
      );
    } else {
      chars.push(text[i]);
    }
  }
  return <>{chars}</>;
}

function scoreBar(score: number): ReactNode {
  if (score <= 0) return null;
  const pct = Math.min(100, Math.round((score / 100) * 100));
  const bars = Math.max(1, Math.min(5, Math.ceil(pct / 20)));
  return (
    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60" title={`Score: ${score}`}>
      {"\u2502".repeat(bars)}
    </span>
  );
}

export function CommandPaletteResults(props: CommandPaletteResultsProps) {
  if (props.groups.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {props.emptyStateMessage ??
          (props.isActionsOnly
            ? "No matching actions."
            : "No matching commands, projects, or threads.")}
      </div>
    );
  }

  return (
    <CommandList>
      {props.groups.map((group) => (
        <CommandGroup items={group.items} key={group.value}>
          <CommandGroupLabel>{group.label}</CommandGroupLabel>
          <CommandCollection>
            {(item) =>
              item.disabled ? (
                <DisabledCommandPaletteResultRow item={item} key={item.value} />
              ) : (
                <CommandPaletteResultRow
                  item={item}
                  key={item.value}
                  keybindings={props.keybindings}
                  isActive={props.highlightedItemValue === item.value}
                  onExecuteItem={props.onExecuteItem}
                  query={props.query}
                />
              )
            }
          </CommandCollection>
        </CommandGroup>
      ))}
    </CommandList>
  );
}

function DisabledCommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
}) {
  return (
    <div className="flex min-h-8 select-none items-center gap-2 rounded-sm px-2 py-1.5 text-base opacity-64 sm:min-h-7 sm:text-sm">
      {props.item.icon}
      {props.item.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <span className="truncate">{props.item.title}</span>
          </span>
          <span className="truncate text-muted-foreground/70 text-xs">
            {props.item.description}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
    </div>
  );
}

function CommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
  isActive: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
  query?: string;
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(props.keybindings, props.item.shortcutCommand)
    : null;

  const query = props.query?.trim().toLowerCase();
  const fuzzyResult: FuzzyMatchResult | null =
    query && query.length > 0
      ? fuzzyMatch(
          props.item.searchTerms.filter((t) => t.length > 0).join(" "),
          query,
        )
      : null;

  const titleText = typeof props.item.title === "string" ? props.item.title : null;
  const highlightedTitle =
    titleText && fuzzyResult ? highlightText(titleText, fuzzyResult.indices) : props.item.title;

  return (
    <CommandItem
      value={props.item.value}
      className={cn(
        "cursor-pointer gap-2 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit data-selected:bg-transparent data-selected:text-inherit [&[data-highlighted][data-selected]]:bg-transparent [&[data-highlighted][data-selected]]:text-inherit",
        props.isActive && "bg-accent! text-accent-foreground!",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onExecuteItem(props.item);
      }}
    >
      {props.item.icon}
      {props.item.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <span className="truncate">{highlightedTitle}</span>
          </span>
          <span className="truncate text-muted-foreground/70 text-xs">
            {props.item.description}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{highlightedTitle}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
      {fuzzyResult ? scoreBar(fuzzyResult.score) : null}
      {props.item.timestamp ? (
        <span className="min-w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/70">
          {props.item.timestamp}
        </span>
      ) : null}
      {shortcutLabel ? <CommandShortcut>{shortcutLabel}</CommandShortcut> : null}
      {props.item.kind === "submenu" ? (
        <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground/50" />
      ) : null}
    </CommandItem>
  );
}

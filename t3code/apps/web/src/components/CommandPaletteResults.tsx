import { type ReactNode, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { shortcutLabelForCommand } from "../keybindings";
import {
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
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

function highlightCommandTitle(title: string, indices: ReadonlyArray<number>): ReactNode {
  if (indices.length === 0) {
    return title;
  }
  const matchSet = new Set(indices);
  const nodes: ReactNode[] = [];
  let buffer = "";
  let bufferIsMatch = false;
  for (let i = 0; i < title.length; i++) {
    const isMatch = matchSet.has(i);
    if (i === 0) {
      buffer = title[i];
      bufferIsMatch = isMatch;
      continue;
    }
    if (isMatch === bufferIsMatch) {
      buffer += title[i];
    } else {
      nodes.push(
        bufferIsMatch ? (
          <span key={nodes.length} className="cp-fuzzy-match font-semibold text-accent">
            {buffer}
          </span>
        ) : (
          <span key={nodes.length}>{buffer}</span>
        ),
      );
      buffer = title[i];
      bufferIsMatch = isMatch;
    }
  }
  nodes.push(
    bufferIsMatch ? (
      <span key={nodes.length} className="cp-fuzzy-match font-semibold text-accent">
        {buffer}
      </span>
    ) : (
      <span key={nodes.length}>{buffer}</span>
    ),
  );
  return <>{nodes}</>;
}

function resolveTitleNode(
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
): ReactNode {
  if (
    typeof item.title === "string" &&
    item.fuzzyMatchIndices &&
    item.fuzzyMatchIndices.length > 0
  ) {
    return highlightCommandTitle(item.title, item.fuzzyMatchIndices);
  }
  return item.title;
}

interface CommandPaletteResultsProps {
  emptyStateMessage?: string;
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
  isActionsOnly: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
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
            <span className="truncate">{resolveTitleNode(props.item)}</span>
          </span>
          <span className="truncate text-muted-foreground/70 text-xs">
            {props.item.description}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{resolveTitleNode(props.item)}</span>
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
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(props.keybindings, props.item.shortcutCommand)
    : null;

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
            <span className="truncate">{resolveTitleNode(props.item)}</span>
          </span>
          <span className="truncate text-muted-foreground/70 text-xs">
            {props.item.description}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{resolveTitleNode(props.item)}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
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

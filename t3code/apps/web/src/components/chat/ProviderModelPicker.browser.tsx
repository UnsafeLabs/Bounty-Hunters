import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { EnvironmentId } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderModelPicker } from "./ProviderModelPicker";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import type { ModelEsque } from "./providerIconUtils";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { __resetLocalApiForTests } from "../../localApi";

// Mock the environments/runtime module to provide a mock primary environment connection
vi.mock("../../environments/runtime", () => {
  const primaryConnection = {
    kind: "primary" as const,
    knownEnvironment: {
      id: "environment-local",
      label: "Local environment",
      source: "manual" as const,
      environmentId: EnvironmentId.make("environment-local"),
      target: {
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
      },
    },
    environmentId: EnvironmentId.make("environment-local"),
    client: {
      server: {
        getConfig: vi.fn(),
        updateSettings: vi.fn(),
      },
    },
    ensureBootstrapped: async () => undefined,
    reconnect: async () => undefined,
    dispose: async () => undefined,
  };

  return {
    getEnvironmentHttpBaseUrl: () => "http://localhost:3000",
    getSavedEnvironmentRecord: () => null,
    getSavedEnvironmentRuntimeState: () => null,
    hasSavedEnvironmentRegistryHydrated: () => true,
    listSavedEnvironmentRecords: () => [],
    resetSavedEnvironmentRegistryStoreForTests: vi.fn(),
    resetSavedEnvironmentRuntimeStoreForTests: vi.fn(),
    resolveEnvironmentHttpUrl: (_environmentId: unknown, path: string) =>
      new URL(path, "http://localhost:3000").toString(),
    waitForSavedEnvironmentRegistryHydration: async () => undefined,
    addSavedEnvironment: vi.fn(),
    disconnectSavedEnvironment: vi.fn(),
    ensureEnvironmentConnectionBootstrapped: async () => undefined,
    getPrimaryEnvironmentConnection: () => primaryConnection,
    readEnvironmentConnection: () => primaryConnection,
    reconnectSavedEnvironment: vi.fn(),
    removeSavedEnvironment: vi.fn(),
    requireEnvironmentConnection: () => primaryConnection,
    resetEnvironmentServiceForTests: vi.fn(),
    startEnvironmentConnectionService: vi.fn(),
    subscribeEnvironmentConnections: () => () => {},
    useSavedEnvironmentRegistryStore: (
      selector: (state: { byId: Record<string, never> }) => unknown,
    ) => selector({ byId: {} }),
    useSavedEnvironmentRuntimeStore: (
      selector: (state: { byId: Record<string, never> }) => unknown,
    ) => selector({ byId: {} }),
  };
});

function selectDescriptor(
  id: string,
  label: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
) {
  return {
    id,
    label,
    type: "select" as const,
    options: [...options],
    ...(options.find((option) => option.isDefault)?.id
      ? { currentValue: options.find((option) => option.isDefault)?.id }
      : {}),
  };
}

function booleanDescriptor(id: string, label: string) {
  return {
    id,
    label,
    type: "boolean" as const,
  };
}

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("reasoningEffort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
            ]),
            booleanDescriptor("fastMode", "Fast Mode"),
          ],
        }),
      },
      {
        slug: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("reasoningEffort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
            ]),
            booleanDescriptor("fastMode", "Fast Mode"),
          ],
        }),
      },
    ],
  },
  {
    driver: ProviderDriverKind.make("claudeAgent"),
    instanceId: ProviderInstanceId.make("claudeAgent"),
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
              { id: "max", label: "max" },
            ]),
            booleanDescriptor("thinking", "Thinking"),
          ],
        }),
      },
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
              { id: "max", label: "max" },
            ]),
            booleanDescriptor("thinking", "Thinking"),
          ],
        }),
      },
      {
        slug: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
            ]),
            booleanDescriptor("thinking", "Thinking"),
          ],
        }),
      },
    ],
  },
];

const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const CLAUDE_INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const OPENCODE_INSTANCE_ID = ProviderInstanceId.make("opencode");

// Namespaced persistence keys (UnsafeLabs/Bounty-Hunters#834). Tests that
// click through the picker write them, so every describe clears them in its
// hooks to keep mounts independent.
const PERSISTED_PROVIDER_KEY = "t3code.provider";
const PERSISTED_MODEL_KEY = "t3code.model";

function clearPersistedPickerSelectionKeys(): void {
  localStorage.removeItem(PERSISTED_PROVIDER_KEY);
  localStorage.removeItem(PERSISTED_MODEL_KEY);
}

function buildCodexProvider(models: ServerProvider["models"]): ServerProvider {
  return {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models,
    slashCommands: [],
    skills: [],
  };
}

function buildOpenCodeProvider(models: ServerProvider["models"]): ServerProvider {
  return {
    driver: ProviderDriverKind.make("opencode"),
    instanceId: ProviderInstanceId.make("opencode"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models,
    slashCommands: [],
    skills: [],
  };
}

async function mountPicker(props: {
  activeInstanceId?: ProviderInstanceId;
  model: string;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  providers?: ReadonlyArray<ServerProvider>;
  settings?: UnifiedSettings;
  triggerVariant?: "ghost" | "outline";
  persistSelection?: boolean;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onInstanceModelChange = vi.fn();
  const providers = props.providers ?? TEST_PROVIDERS;
  const instanceEntries = sortProviderInstanceEntries(deriveProviderInstanceEntries(providers));
  const activeInstanceId = props.activeInstanceId ?? CODEX_INSTANCE_ID;
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    props.settings ?? DEFAULT_UNIFIED_SETTINGS,
    providers,
    activeInstanceId,
    props.model,
  );
  const screen = await render(
    <ProviderModelPicker
      activeInstanceId={activeInstanceId}
      model={props.model}
      lockedProvider={props.lockedProvider}
      lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
      instanceEntries={instanceEntries}
      modelOptionsByInstance={modelOptionsByInstance}
      triggerVariant={props.triggerVariant}
      {...(props.persistSelection !== undefined ? { persistSelection: props.persistSelection } : {})}
      onInstanceModelChange={onInstanceModelChange}
    />,
    { container: host },
  );

  return {
    onInstanceModelChange,
    // Back-compat alias used by callers that still assert on the old callback
    // name. Delegates to the instance-aware mock so existing expectations work.
    get onProviderModelChange() {
      return onInstanceModelChange;
    },
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

function getModelPickerListElement() {
  const modelPickerList = document.querySelector<HTMLElement>(".model-picker-list");
  expect(modelPickerList).not.toBeNull();
  return modelPickerList!;
}

function getModelPickerListText() {
  return getModelPickerListElement().textContent ?? "";
}

function getVisibleModelNames() {
  return Array.from(getModelPickerListElement().querySelectorAll<HTMLDivElement>("div.font-medium"))
    .map((element) => element.textContent?.replace(/New$/u, "").trim() ?? "")
    .filter((text) => text.length > 0);
}

function getSidebarProviderOrder() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-model-picker-provider]")).map(
    (element) => element.dataset.modelPickerProvider ?? "",
  );
}

describe("ProviderModelPicker", () => {
  beforeEach(async () => {
    // Reset test environment before each test
    clearPersistedPickerSelectionKeys();
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    clearPersistedPickerSelectionKeys();
    await __resetLocalApiForTests();
  });

  it("shows provider sidebar in unlocked mode", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).not.toContain("Codex");
        expect(text).toContain("Claude");
        expect(text).toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows favorites first in the provider sidebar", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getSidebarProviderOrder().slice(0, 3)).toEqual([
          "favorites",
          "codex",
          "claudeAgent",
        ]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("filters models by selected provider in sidebar", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      // Start with Claude models visible
      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).not.toContain("GPT-5 Codex");
        expect(text).toContain("Claude Opus 4.6");
      });

      // Click on Codex provider in sidebar
      await vi.waitFor(() => {
        expect(document.querySelector('[data-model-picker-provider="codex"]')).not.toBeNull();
      });
      await page.getByRole("button", { name: "Codex", exact: true }).click();

      // Now should only show Codex models
      await vi.waitFor(() => {
        const listText = getModelPickerListText();
        expect(listText).toContain("GPT-5 Codex");
        expect(listText).not.toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("uses client model visibility and ordering preferences", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
      settings: {
        ...DEFAULT_UNIFIED_SETTINGS,
        providerModelPreferences: {
          [CLAUDE_INSTANCE_ID]: {
            hiddenModels: ["claude-opus-4-6"],
            modelOrder: ["claude-haiku-4-5", "claude-sonnet-4-6"],
          },
        },
      },
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getVisibleModelNames()).toEqual(["Claude Haiku 4.5", "Claude Sonnet 4.6"]);
        expect(getModelPickerListText()).not.toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("focuses the search input after selecting a sidebar provider", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(document.querySelector('[data-model-picker-provider="codex"]')).not.toBeNull();
      });
      await page.getByRole("button", { name: "Codex", exact: true }).click();

      await vi.waitFor(() => {
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[placeholder="Search models..."]',
        );
        expect(searchInput).not.toBeNull();
        expect(document.activeElement).toBe(searchInput);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows locked provider header and only its models in locked mode", async () => {
    localStorage.setItem(
      "t3code:client-settings:v1",
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        favorites: [
          { provider: "codex", model: "gpt-5-codex" },
          { provider: "claudeAgent", model: "claude-sonnet-4-6" },
        ],
      }),
    );

    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: ProviderDriverKind.make("claudeAgent"),
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        // Should show locked provider label
        expect(text).toContain("Claude");
        expect(getVisibleModelNames()).toEqual([
          "Claude Sonnet 4.6",
          "Claude Opus 4.6",
          "Claude Haiku 4.5",
        ]);
      });
    } finally {
      localStorage.removeItem("t3code:client-settings:v1");
      await mounted.cleanup();
    }
  });

  it("keeps an instance sidebar in locked mode when that provider has multiple instances", async () => {
    const defaultCodexModels: ServerProvider["models"] = [
      {
        slug: "gpt-work",
        name: "GPT Work",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ];
    const personalCodexModels: ServerProvider["models"] = [
      {
        slug: "gpt-personal",
        name: "GPT Personal",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ];
    const isolatedCodexModels: ServerProvider["models"] = [
      {
        slug: "gpt-isolated",
        name: "GPT Isolated",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ];
    const providers: ReadonlyArray<ServerProvider> = [
      {
        ...buildCodexProvider(defaultCodexModels),
        instanceId: "codex" as ProviderInstanceId,
        displayName: "Codex Work",
        accentColor: "#2563eb",
        continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      },
      {
        ...buildCodexProvider(personalCodexModels),
        instanceId: "codex_personal" as ProviderInstanceId,
        displayName: "Codex Personal",
        accentColor: "#dc2626",
        continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      },
      {
        ...buildCodexProvider(isolatedCodexModels),
        instanceId: "codex_isolated" as ProviderInstanceId,
        displayName: "Codex Isolated",
        accentColor: "#16a34a",
        continuation: { groupKey: "codex:home:/Users/julius/.codex_isolated" },
      },
      TEST_PROVIDERS[1]!,
    ];
    const mounted = await mountPicker({
      activeInstanceId: "codex" as ProviderInstanceId,
      model: "gpt-work",
      lockedProvider: ProviderDriverKind.make("codex"),
      lockedContinuationGroupKey: "codex:home:/Users/julius/.codex",
      providers,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getSidebarProviderOrder()).toEqual(["codex", "codex_personal"]);
        expect(getModelPickerListText()).not.toContain("Codex Isolated");
        expect(
          document.querySelector<HTMLElement>('[data-model-picker-provider="codex_personal"]')
            ?.dataset.providerAccentColor,
        ).toBe("#dc2626");
        expect(getModelPickerListText()).toContain("Codex Work");
        expect(getVisibleModelNames()).toEqual(["GPT Work"]);
      });

      await page.getByRole("button", { name: "Codex Personal" }).click();

      await vi.waitFor(() => {
        expect(getModelPickerListText()).toContain("Codex Personal");
        expect(getVisibleModelNames()).toEqual(["GPT Personal"]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to the active provider's first model when props.model belongs to another provider (#1982)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onInstanceModelChange = vi.fn();
    const modelOptionsByInstance = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>([
      [
        "claudeAgent" as ProviderInstanceId,
        [
          { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
          { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
        ],
      ],
      ["codex" as ProviderInstanceId, [{ slug: "gpt-5-codex", name: "GPT-5 Codex" }]],
      ["cursor" as ProviderInstanceId, []],
      ["opencode" as ProviderInstanceId, []],
    ]);
    const instanceEntries = sortProviderInstanceEntries(
      deriveProviderInstanceEntries(TEST_PROVIDERS),
    );
    const screen = await render(
      <ProviderModelPicker
        activeInstanceId={"claudeAgent" as ProviderInstanceId}
        model="gpt-5-codex"
        lockedProvider={null}
        instanceEntries={instanceEntries}
        modelOptionsByInstance={modelOptionsByInstance}
        onInstanceModelChange={onInstanceModelChange}
      />,
      { container: host },
    );

    try {
      const trigger = document.querySelector<HTMLElement>(
        '[data-chat-provider-model-picker="true"]',
      );
      expect(trigger).not.toBeNull();
      const label = trigger?.textContent ?? "";
      expect(label).not.toContain("gpt-5-codex");
      expect(label).toContain("Claude Opus 4.6");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("uses the trigger label for locked opencode rows", async () => {
    const providers: ReadonlyArray<ServerProvider> = [
      buildOpenCodeProvider([
        {
          slug: "github-copilot/claude-opus-4.5",
          name: "Claude Opus 4.5",
          subProvider: "GitHub Copilot",
          shortName: "Opus 4.5",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
            ],
          }),
        },
      ]),
    ];
    const mounted = await mountPicker({
      activeInstanceId: OPENCODE_INSTANCE_ID,
      model: "github-copilot/claude-opus-4.5",
      lockedProvider: ProviderDriverKind.make("opencode"),
      providers,
    });

    try {
      await vi.waitFor(() => {
        const trigger = document.querySelector<HTMLElement>(
          '[data-chat-provider-model-picker="true"]',
        );
        expect(trigger?.textContent).toContain("GitHub Copilot");
        expect(trigger?.textContent).toContain("Opus 4.5");
      });

      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getVisibleModelNames()).toEqual(["GitHub Copilot · Opus 4.5"]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("searches models by name in flat list", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
        expect(text).not.toContain("GPT-5 Codex");
      });

      // Find and type in search box
      const searchInput = page.getByPlaceholder("Search models...");
      await searchInput.fill("claude");

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
        expect(text).not.toContain("GPT-5 Codex");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("supports arrow-key navigation in the model picker", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: ProviderDriverKind.make("claudeAgent"),
    });

    try {
      await page.getByRole("button").click();

      const searchInput = page.getByPlaceholder("Search models...");
      await userEvent.click(searchInput);
      await userEvent.keyboard("{ArrowDown}");
      await vi.waitFor(() => {
        const highlightedItem = document.querySelector<HTMLElement>(
          '[data-slot="combobox-item"][data-highlighted]',
        );
        expect(highlightedItem).not.toBeNull();
        expect(highlightedItem?.textContent).toContain("Claude Opus 4.6");
      });
      await userEvent.keyboard("{ArrowDown}");
      await vi.waitFor(() => {
        const highlightedItem = document.querySelector<HTMLElement>(
          '[data-slot="combobox-item"][data-highlighted]',
        );
        expect(highlightedItem).not.toBeNull();
        expect(highlightedItem?.textContent).toContain("Claude Sonnet 4.6");
      });
      await userEvent.keyboard("{Enter}");

      expect(mounted.onProviderModelChange).toHaveBeenCalledWith(
        "claudeAgent",
        "claude-sonnet-4-6",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("hides the provider sidebar while searching", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getSidebarProviderOrder().length).toBeGreaterThan(0);
      });

      await page.getByPlaceholder("Search models...").fill("cla");

      await vi.waitFor(() => {
        expect(getSidebarProviderOrder()).toEqual([]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("closes the picker when escape is pressed in search", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      const searchInput = page.getByPlaceholder("Search models...");
      await searchInput.click();
      const searchInputElement = document.querySelector<HTMLInputElement>(
        'input[placeholder="Search models..."]',
      );
      expect(searchInputElement).not.toBeNull();
      searchInputElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );

      await vi.waitFor(() => {
        expect(document.querySelector(".model-picker-list")).toBeNull();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("searches models by provider name", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
        expect(text).not.toContain("GPT-5 Codex");
      });

      // Search by provider name
      const searchInput = page.getByPlaceholder("Search models...");
      await searchInput.fill("codex");

      await vi.waitFor(() => {
        const listText = getModelPickerListText();
        expect(listText).toContain("GPT-5 Codex");
        expect(listText).not.toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("matches fuzzy multi-token queries across provider and model text", async () => {
    const providers: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5-codex",
          name: "GPT-5 Codex",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
      ]),
      buildOpenCodeProvider([
        {
          slug: "github-copilot/claude-opus-4.7",
          name: "Claude Opus 4.7",
          subProvider: "GitHub Copilot",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
            ],
          }),
        },
      ]),
    ];
    const mounted = await mountPicker({
      activeInstanceId: OPENCODE_INSTANCE_ID,
      model: "github-copilot/claude-opus-4.7",
      lockedProvider: null,
      providers,
    });

    try {
      await page.getByRole("button").click();
      await page.getByPlaceholder("Search models...").fill("coplt op");

      await vi.waitFor(() => {
        const listText = getModelPickerListText();
        expect(listText).toContain("Claude Opus 4.7");
        expect(listText).not.toContain("GPT-5 Codex");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders each search result with its own provider branding", async () => {
    const providers: ReadonlyArray<ServerProvider> = [
      buildOpenCodeProvider([
        {
          slug: "github-copilot/claude-opus-4.7",
          name: "Claude Opus 4.7",
          subProvider: "GitHub Copilot",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
            ],
          }),
        },
      ]),
      {
        ...TEST_PROVIDERS[1]!,
        models: [
          {
            slug: "claude-opus-4-6",
            name: "Claude Opus 4.6",
            isCustom: false,
            capabilities: createModelCapabilities({
              optionDescriptors: [
                selectDescriptor("effort", "Reasoning", [
                  { id: "low", label: "low" },
                  { id: "medium", label: "medium", isDefault: true },
                  { id: "high", label: "high" },
                  { id: "max", label: "max" },
                ]),
                booleanDescriptor("thinking", "Thinking"),
              ],
            }),
          },
        ],
      },
    ];
    const mounted = await mountPicker({
      activeInstanceId: OPENCODE_INSTANCE_ID,
      model: "github-copilot/claude-opus-4.7",
      lockedProvider: null,
      providers,
    });

    try {
      await page.getByRole("button").click();
      await page.getByPlaceholder("Search models...").fill("opus");

      await vi.waitFor(() => {
        const listText = getModelPickerListText();
        expect(listText).toContain("OpenCode · GitHub Copilot");
        expect(listText).toContain("Claude");
        expect(listText).not.toContain("OpenCodeClaude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("toggles favorite stars when clicked", async () => {
    localStorage.removeItem("t3code:client-settings:v1");

    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
      });

      const getFirstStarButton = () => {
        const starButton = document.querySelector<HTMLButtonElement>(
          'button[aria-label*="favorites"]',
        );
        expect(starButton).not.toBeNull();
        return starButton!;
      };

      const firstStar = getFirstStarButton();
      const initialAriaLabel = firstStar.getAttribute("aria-label");
      expect(
        initialAriaLabel === "Add to favorites" || initialAriaLabel === "Remove from favorites",
      ).toBe(true);

      await page.getByRole("button", { name: initialAriaLabel! }).first().click();

      const expectedAriaLabel =
        initialAriaLabel === "Add to favorites" ? "Remove from favorites" : "Add to favorites";

      await vi.waitFor(() => {
        expect(getFirstStarButton().getAttribute("aria-label")).toBe(expectedAriaLabel);
      });
    } finally {
      await mounted.cleanup();
      localStorage.removeItem("t3code:client-settings:v1");
    }
  });

  it("does not duplicate favorited models across favorites and all models sections", async () => {
    localStorage.removeItem("t3code:client-settings:v1");

    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
      });

      const favoriteButton = page.getByRole("button", {
        name: "Add to favorites",
      });
      await favoriteButton.first().click();

      await vi.waitFor(async () => {
        const favoritedModelRows = Array.from(
          getModelPickerListElement().querySelectorAll<HTMLDivElement>("div.font-medium"),
        ).filter((element) => element.textContent?.trim() === "Claude Opus 4.6");
        expect(favoritedModelRows.length).toBe(1);
      });
    } finally {
      await mounted.cleanup();
      localStorage.removeItem("t3code:client-settings:v1");
    }
  });

  it("shows favorited models first within the selected provider list", async () => {
    localStorage.setItem(
      "t3code:client-settings:v1",
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        favorites: [{ provider: "codex", model: "gpt-5.3-codex" }],
      }),
    );

    const mounted = await mountPicker({
      model: "gpt-5-codex",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("button", { name: "Codex", exact: true }).click();

      await vi.waitFor(() => {
        expect(getVisibleModelNames().slice(0, 2)).toEqual(["GPT-5.3 Codex", "GPT-5 Codex"]);
      });
    } finally {
      await mounted.cleanup();
      localStorage.removeItem("t3code:client-settings:v1");
    }
  });

  it("dispatches callback with correct provider and model when selected", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: ProviderDriverKind.make("claudeAgent"),
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Sonnet 4.6");
      });

      // Click on a model
      const modelRow = page.getByText("Claude Sonnet 4.6").first();
      await modelRow.click();

      // Verify callback was called with correct values
      expect(mounted.onProviderModelChange).toHaveBeenCalledWith(
        "claudeAgent",
        "claude-sonnet-4-6",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("only shows codex spark when the server reports it", async () => {
    const providersWithoutSpark: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
      ]),
      TEST_PROVIDERS[1]!,
    ];
    const providersWithSpark: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
        {
          slug: "gpt-5.3-codex-spark",
          name: "GPT-5.3 Codex Spark",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
      ]),
      TEST_PROVIDERS[1]!,
    ];

    const hidden = await mountPicker({
      model: "gpt-5.3-codex",
      lockedProvider: null,
      providers: providersWithoutSpark,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("GPT-5.3 Codex");
        expect(text).not.toContain("GPT-5.3 Codex Spark");
      });
    } finally {
      await hidden.cleanup();
    }

    const visible = await mountPicker({
      model: "gpt-5.3-codex",
      lockedProvider: null,
      providers: providersWithSpark,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("GPT-5.3 Codex Spark");
      });
    } finally {
      await visible.cleanup();
    }
  });

  it("shows disabled providers grayed out in sidebar", async () => {
    const disabledProviders = TEST_PROVIDERS.slice();
    const claudeIndex = disabledProviders.findIndex(
      (provider) => provider.instanceId === ProviderInstanceId.make("claudeAgent"),
    );
    if (claudeIndex >= 0) {
      const claudeProvider = disabledProviders[claudeIndex]!;
      disabledProviders[claudeIndex] = {
        ...claudeProvider,
        enabled: false,
        status: "disabled",
      };
    }

    const mounted = await mountPicker({
      model: "gpt-5-codex",
      lockedProvider: null,
      providers: disabledProviders,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("GPT-5 Codex");
        // Disabled provider should not have its models shown
        expect(text).not.toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("accepts outline trigger styling", async () => {
    const mounted = await mountPicker({
      model: "gpt-5-codex",
      lockedProvider: null,
      triggerVariant: "outline",
    });

    try {
      const button = document.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Expected picker trigger button to be rendered.");
      }
      expect(button.className).toContain("border-input");
      expect(button.className).toContain("bg-popover");
    } finally {
      await mounted.cleanup();
    }
  });
});

describe("ProviderModelPicker selection persistence (#834)", () => {
  const PROVIDER_KEY = PERSISTED_PROVIDER_KEY;
  const MODEL_KEY = PERSISTED_MODEL_KEY;

  const clearPersistedPickerKeys = clearPersistedPickerSelectionKeys;

  beforeEach(() => {
    clearPersistedPickerKeys();
  });

  afterEach(() => {
    clearPersistedPickerKeys();
  });

  // Mirrors mountPicker's option derivation so "first available" assertions
  // track the exact slugs the component saw, not a hand-copied guess.
  function modelOptionsForFixture(): ReadonlyMap<
    ProviderInstanceId,
    ReadonlyArray<ModelEsque>
  > {
    return getCustomModelOptionsByInstance(
      DEFAULT_UNIFIED_SETTINGS,
      TEST_PROVIDERS,
      CODEX_INSTANCE_ID,
      "gpt-5-codex",
    );
  }

  function firstSelectableSelection(): { instanceId: string; model: string } {
    const instanceEntries = sortProviderInstanceEntries(
      deriveProviderInstanceEntries(TEST_PROVIDERS),
    );
    const modelOptionsByInstance = modelOptionsForFixture();
    for (const entry of instanceEntries) {
      if (!entry.enabled || entry.status !== "ready" || !entry.isAvailable) continue;
      const first = modelOptionsByInstance.get(entry.instanceId)?.[0];
      if (first) {
        return { instanceId: entry.instanceId, model: first.slug };
      }
    }
    throw new Error("No selectable provider/model in the test fixture.");
  }

  function firstOptionSlugForInstance(instanceId: ProviderInstanceId): string {
    const first = modelOptionsForFixture().get(instanceId)?.[0];
    if (!first) {
      throw new Error(`No model options for instance ${instanceId} in the test fixture.`);
    }
    return first.slug;
  }

  it("persists the selected provider and model to namespaced localStorage keys", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Claude Sonnet 4.6");
      });
      await page.getByText("Claude Sonnet 4.6").first().click();

      await vi.waitFor(() => {
        expect(localStorage.getItem(PROVIDER_KEY)).toBe("claudeAgent");
        expect(localStorage.getItem(MODEL_KEY)).toBe("claude-sonnet-4-6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("restores the persisted selection on mount", async () => {
    localStorage.setItem(PROVIDER_KEY, "claudeAgent");
    localStorage.setItem(MODEL_KEY, "claude-sonnet-4-6");

    const mounted = await mountPicker({
      activeInstanceId: CODEX_INSTANCE_ID,
      model: "gpt-5-codex",
      lockedProvider: null,
    });

    try {
      await vi.waitFor(() => {
        expect(mounted.onInstanceModelChange).toHaveBeenCalledWith(
          "claudeAgent",
          "claude-sonnet-4-6",
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to the first available provider when the persisted provider is unavailable", async () => {
    localStorage.setItem(PROVIDER_KEY, "nonexistent_provider");
    localStorage.setItem(MODEL_KEY, "whatever-model");

    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    const expected = firstSelectableSelection();
    try {
      await vi.waitFor(() => {
        expect(mounted.onInstanceModelChange).toHaveBeenCalledWith(
          expected.instanceId,
          expected.model,
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to the persisted provider's first model when the saved slug is stale", async () => {
    localStorage.setItem(PROVIDER_KEY, "claudeAgent");
    localStorage.setItem(MODEL_KEY, "claude-4-obsolete");

    const mounted = await mountPicker({
      activeInstanceId: CODEX_INSTANCE_ID,
      model: "gpt-5-codex",
      lockedProvider: null,
    });

    try {
      await vi.waitFor(() => {
        expect(mounted.onInstanceModelChange).toHaveBeenCalledWith(
          "claudeAgent",
          firstOptionSlugForInstance(CLAUDE_INSTANCE_ID),
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("reset to default clears the persisted keys and returns the first available selection", async () => {
    localStorage.setItem(PROVIDER_KEY, "claudeAgent");
    localStorage.setItem(MODEL_KEY, "claude-sonnet-4-6");

    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-sonnet-4-6",
      lockedProvider: null,
    });

    const expected = firstSelectableSelection();
    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(document.querySelector('[data-model-picker-reset="true"]')).not.toBeNull();
      });
      await page.getByRole("button", { name: "Reset to default" }).click();

      await vi.waitFor(() => {
        expect(localStorage.getItem(PROVIDER_KEY)).toBeNull();
        expect(localStorage.getItem(MODEL_KEY)).toBeNull();
        expect(mounted.onInstanceModelChange).toHaveBeenCalledWith(
          expected.instanceId,
          expected.model,
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("syncs a selection made in another tab via the storage event", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CODEX_INSTANCE_ID,
      model: "gpt-5-codex",
      lockedProvider: null,
    });

    try {
      // Wait for the trigger (and thus the storage listener) to attach
      // before dispatching, and let the one-shot restore settle.
      await vi.waitFor(() => {
        expect(
          document.querySelector('[data-chat-provider-model-picker="true"]'),
        ).not.toBeNull();
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(mounted.onInstanceModelChange).not.toHaveBeenCalled();

      localStorage.setItem(PROVIDER_KEY, "claudeAgent");
      localStorage.setItem(MODEL_KEY, "claude-haiku-4-5");
      window.dispatchEvent(new StorageEvent("storage", { key: PROVIDER_KEY }));

      await vi.waitFor(() => {
        expect(mounted.onInstanceModelChange).toHaveBeenCalledWith(
          "claudeAgent",
          "claude-haiku-4-5",
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("returns to the default selection when another tab resets the persisted keys", async () => {
    localStorage.setItem(PROVIDER_KEY, "claudeAgent");
    localStorage.setItem(MODEL_KEY, "claude-sonnet-4-6");

    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-sonnet-4-6",
      lockedProvider: null,
    });

    const expected = firstSelectableSelection();
    try {
      // Restore on mount matches the props, so no callback fires yet.
      await vi.waitFor(() => {
        expect(
          document.querySelector('[data-chat-provider-model-picker="true"]'),
        ).not.toBeNull();
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(mounted.onInstanceModelChange).not.toHaveBeenCalled();

      // Another tab clears the keys; each removeItem fires its own event,
      // and only the second one sees the fully cleared pair.
      localStorage.removeItem(PROVIDER_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: PROVIDER_KEY }));
      localStorage.removeItem(MODEL_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: MODEL_KEY }));

      await vi.waitFor(() => {
        expect(mounted.onInstanceModelChange).toHaveBeenCalledWith(
          expected.instanceId,
          expected.model,
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("ignores the transient half-written state between the two storage keys", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CODEX_INSTANCE_ID,
      model: "gpt-5-codex",
      lockedProvider: null,
    });

    try {
      await vi.waitFor(() => {
        expect(
          document.querySelector('[data-chat-provider-model-picker="true"]'),
        ).not.toBeNull();
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Only the provider key is written so far — the observer must wait
      // for the model key instead of applying a half-written pair.
      localStorage.setItem(PROVIDER_KEY, "claudeAgent");
      window.dispatchEvent(new StorageEvent("storage", { key: PROVIDER_KEY }));

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(mounted.onInstanceModelChange).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("reset to default does not dispatch a change when already at the default selection", async () => {
    const expected = firstSelectableSelection();

    const mounted = await mountPicker({
      activeInstanceId: CODEX_INSTANCE_ID,
      model: "gpt-5-codex",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(document.querySelector('[data-model-picker-reset="true"]')).not.toBeNull();
      });
      await page.getByRole("button", { name: "Reset to default" }).click();

      await vi.waitFor(() => {
        expect(localStorage.getItem(PROVIDER_KEY)).toBeNull();
        expect(localStorage.getItem(MODEL_KEY)).toBeNull();
      });
      // Give a would-be callback a settle window before asserting absence.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(mounted.onInstanceModelChange).not.toHaveBeenCalledWith(
        expected.instanceId,
        expected.model,
      );
      expect(mounted.onInstanceModelChange).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("leaves the default selection untouched when localStorage is empty", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await vi.waitFor(() => {
        expect(
          document.querySelector('[data-chat-provider-model-picker="true"]'),
        ).not.toBeNull();
      });
      // Give the one-shot restore effect a settle window before asserting.
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mounted.onInstanceModelChange).not.toHaveBeenCalled();
      expect(localStorage.getItem(PROVIDER_KEY)).toBeNull();
      expect(localStorage.getItem(MODEL_KEY)).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not persist or restore when persistSelection is false", async () => {
    localStorage.setItem(PROVIDER_KEY, "claudeAgent");
    localStorage.setItem(MODEL_KEY, "claude-sonnet-4-6");

    const mounted = await mountPicker({
      activeInstanceId: CODEX_INSTANCE_ID,
      model: "gpt-5-codex",
      lockedProvider: null,
      persistSelection: false,
    });

    try {
      await vi.waitFor(() => {
        expect(
          document.querySelector('[data-chat-provider-model-picker="true"]'),
        ).not.toBeNull();
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(mounted.onInstanceModelChange).not.toHaveBeenCalled();

      await page.getByRole("button").click();
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("GPT-5.3 Codex");
      });
      await page.getByText("GPT-5.3 Codex").first().click();

      await vi.waitFor(() => {
        expect(mounted.onInstanceModelChange).toHaveBeenCalledWith("codex", "gpt-5.3-codex");
      });
      expect(localStorage.getItem(PROVIDER_KEY)).toBe("claudeAgent");
      expect(localStorage.getItem(MODEL_KEY)).toBe("claude-sonnet-4-6");
    } finally {
      await mounted.cleanup();
    }
  });
});

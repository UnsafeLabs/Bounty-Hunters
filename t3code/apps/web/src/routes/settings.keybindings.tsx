import { createFileRoute } from "@tanstack/react-router";

import { KeybindingsEditor } from "../components/settings/KeybindingsEditor";

export const Route = createFileRoute("/settings/keybindings")({
  component: KeybindingsEditor,
});

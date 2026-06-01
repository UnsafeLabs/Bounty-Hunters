/**
 * Visual keybinding editor with conflict detection and reset.
 */

interface Keybinding {
  id: string;
  command: string;
  keys: string[];
  category: string;
  custom: boolean;
}

export class KeybindingEditor {
  private bindings: Map<string, Keybinding> = new Map();
  private defaults: Map<string, Keybinding> = new Map();

  constructor(defaults: Keybinding[]) {
    for (const kb of defaults) {
      this.bindings.set(kb.id, kb);
      this.defaults.set(kb.id, { ...kb });
    }
    this.loadCustom();
  }

  setBinding(id: string, keys: string[]): { success: boolean; conflict?: string } {
    const conflict = this.findConflict(id, keys);
    if (conflict) return { success: false, conflict: conflict.command };

    const binding = this.bindings.get(id);
    if (binding) {
      binding.keys = keys;
      binding.custom = true;
      this.save();
    }
    return { success: true };
  }

  resetBinding(id: string): void {
    const def = this.defaults.get(id);
    if (def) {
      this.bindings.set(id, { ...def, custom: false });
      this.save();
    }
  }

  resetAll(): void {
    for (const [id, def] of this.defaults) {
      this.bindings.set(id, { ...def, custom: false });
    }
    this.save();
  }

  private findConflict(excludeId: string, keys: string[]): Keybinding | null {
    const keyStr = keys.sort().join("+");
    for (const [id, kb] of this.bindings) {
      if (id !== excludeId && kb.keys.sort().join("+") === keyStr) return kb;
    }
    return null;
  }

  private save(): void {
    const custom = Array.from(this.bindings.values()).filter((b) => b.custom);
    localStorage.setItem("keybindings-custom", JSON.stringify(custom));
  }

  private loadCustom(): void {
    try {
      const data = JSON.parse(localStorage.getItem("keybindings-custom") || "[]");
      for (const kb of data) this.bindings.set(kb.id, kb);
    } catch {}
  }

  getBindings(): Keybinding[] { return Array.from(this.bindings.values()); }
  getBinding(id: string): Keybinding | undefined { return this.bindings.get(id); }
}

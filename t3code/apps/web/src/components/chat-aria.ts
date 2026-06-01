/**
 * ARIA attributes and keyboard navigation for ChatView.
 * Adds screen reader support and keyboard accessibility.
 */

export const chatAriaAttributes = {
  chatContainer: {
    role: "log",
    "aria-label": "Chat messages",
    "aria-live": "polite",
    "aria-relevant": "additions",
  },
  messageList: {
    role: "list",
    "aria-label": "Message history",
  },
  messageItem: {
    role: "listitem",
    "aria-label": (sender: string, time: string) => `Message from ${sender} at ${time}`,
  },
  inputArea: {
    role: "textbox",
    "aria-label": "Type a message",
    "aria-multiline": "true",
    "aria-describedby": "input-help",
  },
  sendButton: {
    "aria-label": "Send message",
    "aria-keyshortcuts": "Enter",
  },
};

export const chatKeyboardHandlers = {
  onInputKeyDown: (e: KeyboardEvent, sendMessage: () => void) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  },

  onMessageFocus: (e: KeyboardEvent, messages: HTMLElement[]) => {
    const currentIndex = messages.indexOf(document.activeElement as HTMLElement);

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (currentIndex > 0) messages[currentIndex - 1].focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        if (currentIndex < messages.length - 1) messages[currentIndex + 1].focus();
        break;
      case "Home":
        e.preventDefault();
        messages[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        messages[messages.length - 1]?.focus();
        break;
    }
  },
};

export function announceToScreenReader(message: string): void {
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.className = "sr-only";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

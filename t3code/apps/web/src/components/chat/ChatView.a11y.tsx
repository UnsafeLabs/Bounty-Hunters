/**
 * Accessibility enhancements for ChatView
 * This module provides ARIA attributes and keyboard navigation
 */

export const CHAT_ROLE = "log";
export const CHAT_ITEM_ROLE = "listitem";
export const COMPOSE_ROLE = "form";
export const COMPOSE_INPUT_ROLE = "textbox";

export interface A11yChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly timestamp: number;
}

export function getChatViewAriaProps() {
  return {
    role: CHAT_ROLE,
    "aria-label": "Chat messages",
    "aria-live": "polite" as const,
    "aria-relevant": "additions" as const,
    tabIndex: 0,
  };
}

export function getChatMessageAriaProps(message: A11yChatMessage) {
  return {
    role: CHAT_ITEM_ROLE,
    "aria-label": `${message.role} message at ${new Date(message.timestamp).toLocaleTimeString()}`,
    "aria-describedby": `msg-content-${message.id}`,
    tabIndex: -1,
  };
}

export function getComposeAriaProps() {
  return {
    role: COMPOSE_ROLE,
    "aria-label": "Compose message",
  };
}

export function getInputAriaProps() {
  return {
    role: COMPOSE_INPUT_ROLE,
    "aria-label": "Type your message",
    "aria-multiline": true,
    "aria-describedby": "compose-help",
  };
}

/**
 * Keyboard navigation handler for chat messages
 */
export function handleChatKeyDown(
  event: React.KeyboardEvent,
  messages: A11yChatMessage[],
  currentIndex: number,
  setCurrentIndex: (idx: number) => void,
  onSendMessage?: (text: string) => void,
) {
  switch (event.key) {
    case "ArrowUp":
      event.preventDefault();
      setCurrentIndex(Math.max(0, currentIndex - 1));
      break;
    case "ArrowDown":
      event.preventDefault();
      setCurrentIndex(Math.min(messages.length - 1, currentIndex + 1));
      break;
    case "Home":
      event.preventDefault();
      setCurrentIndex(0);
      break;
    case "End":
      event.preventDefault();
      setCurrentIndex(messages.length - 1);
      break;
    case "Escape":
      // Return focus to input
      document.getElementById("compose-input")?.focus();
      break;
  }
}

/**
 * Announce new messages to screen readers
 */
export function announceForScreenReader(message: string) {
  const announcer = document.getElementById("sr-announcer");
  if (announcer) {
    announcer.textContent = message;
  }
}

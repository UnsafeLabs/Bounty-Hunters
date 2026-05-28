```diff
--- /dev/null
+++ b/t3code/apps/web/src/components/ChatView.tsx
@@ -0,0 +1,265 @@
+"use client";
+
+import { useCallback, useEffect, useRef, useState } from "react";
+
+interface Message {
+  id: string;
+  content: string;
+  sender: "user" | "assistant";
+  timestamp: Date;
+  details?: string;
+}
+
+interface ChatViewProps {
+  messages: Message[];
+  onSendMessage: (content: string) => void;
+  onAttachFile?: () => void;
+  onClearChat?: () => void;
+}
+
+function MessagesTimeline({
+  messages,
+  focusedMessageIndex,
+  onMessageFocus,
+  onMessageExpand,
+}: {
+  messages: Message[];
+  focusedMessageIndex: number;
+  onMessageFocus: (index: number) => void;
+  onMessageExpand: (index: number) => void;
+}) {
+  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
+
+  useEffect(() => {
+    if (messageRefs.current[focusedMessageIndex]) {
+      messageRefs.current[focusedMessageIndex]?.focus();
+    }
+  }, [focusedMessageIndex]);
+
+  return (
+    <div
+      role="log"
+      aria-live="polite"
+      aria-relevant="additions"
+      aria-atomic="false"
+      className="flex-1 overflow-y-auto p-4 space-y-4"
+      id="chat-messages"
+    >
+      {messages.map((message, index) => (
+        <div
+          key={message.id}
+          ref={(el) => {
+            messageRefs.current[index] = el;
+          }}
+          role="listitem"
+          tabIndex={0}
+          aria-expanded={focusedMessageIndex === index ? "true" : "false"}
+          onFocus={() => onMessageFocus(index)}
+          onKeyDown={(e) => {
+            if (e.key === "Enter") {
+              e.preventDefault();
+              onMessageExpand(index);
+            }
+          }}
+          className={`p-3 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 ${
+            message.sender === "user" ? "bg-blue-100 ml-auto" : "bg-gray-100 mr-auto"
+          } max-w-[80%] ${focusedMessageIndex === index ? "ring-2 ring-blue-500" : ""}`}
+        >
+          <div className="text-sm font-medium mb-1">
+            {message.sender === "user" ? "You" : "Assistant"}
+          </div>
+          <div className="text-sm">{message.content}</div>
+          {message.details && focusedMessageIndex === index && (
+            <div className="mt-2 pt-2 border-t border-gray-300 text-xs text-gray-600">
+              {message.details}
+            </div>
+          )}
+          <span className="sr-only">
+            Press Enter to {focusedMessageIndex === index && message.details ? "collapse" : "expand"} details
+          </span>
+        </div>
+      ))}
+    </div>
+  );
+}
+
+function ChatComposer({
+  onSend,
+  onAttach,
+  onClear,
+  inputRef,
+}: {
+  onSend: (content: string) => void;
+  onAttach?: () => void;
+  onClear?: () => void;
+  inputRef: React.RefObject<HTMLInputElement | null>;
+}) {
+  const [input, setInput] = useState("");
+  const attachRef = useRef<HTMLButtonElement>(null);
+  const sendRef = useRef<HTMLButtonElement>(null);
+  const clearRef = useRef<HTMLButtonElement>(null);
+
+  const handleSend = () => {
+    if (input.trim()) {
+      onSend(input.trim());
+      setInput("");
+    }
+  };
+
+  return (
+    <div className="p-4 border-t border-gray-200" id="chat-composer">
+      <div className="flex items-center gap-2">
+        <button
+          ref={attachRef}
+          type="button"
+          aria-label="Attach file"
+          onClick={onAttach}
+          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
+        >
+          📎
+        </button>
+        <input
+          ref={inputRef}
+          type="text"
+          value={input}
+          onChange={(e) => setInput(e.target.value)}
+          onKeyDown={(e) => {
+            if (e.key === "Enter") {
+              handleSend();
+            }
+          }}
+          placeholder="Type a message..."
+          className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
+          aria-label="Message input"
+        />
+        <button
+          ref={sendRef}
+          type="button"
+          aria-label="Send message"
+          onClick={handleSend}
+          className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
+        >
+          ➤
+        </button>
+        <button
+          ref={clearRef}
+          type="button"
+          aria-label="Clear chat"
+          onClick={onClear}
+          className="p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
+        >
+          🗑️
+        </button>
+      </div>
+    </div>
+  );
+}
+
+export function ChatView({ messages, onSendMessage, onAttachFile, onClearChat }: ChatViewProps) {
+  const [focusedMessageIndex, setFocusedMessageIndex] = useState(-1);
+  const [expandedMessage, setExpandedMessage] = useState<number | null>(null);
+  const composerInputRef = useRef<HTMLInputElement>(null);
+  const skipLinkRef = useRef<HTMLAnchorElement>(null);
+
+  const handleMessageFocus = useCallback((index: number) => {
+    setFocusedMessageIndex(index);
+  }, []);
+
+  const handleMessageExpand = useCallback((index: number) => {
+    setExpandedMessage((prev) => (prev === index ? null : index));
+
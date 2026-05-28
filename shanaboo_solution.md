```diff
--- /dev/null
+++ b/t3code/apps/web/src/components/ChatView.tsx
@@ -0,0 +1,298 @@
+"use client";
+
+import React, { useCallback, useEffect, useRef, useState } from "react";
+
+// Types
+interface Message {
+  id: string;
+  content: string;
+  sender: "user" | "bot";
+  timestamp: Date;
+  details?: string;
+}
+
+// MessagesTimeline Component
+function MessagesTimeline({
+  messages,
+  activeIndex,
+  onSelectMessage,
+}: {
+  messages: Message[];
+  activeIndex: number;
+  onSelectMessage: (index: number) => void;
+}) {
+  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
+
+  useEffect(() => {
+    if (itemRefs.current[activeIndex]) {
+      itemRefs.current[activeIndex]?.focus();
+    }
+  }, [activeIndex]);
+
+  const handleKeyDown = useCallback(
+    (event: React.KeyboardEvent, index: number) => {
+      if (event.key === "Enter") {
+        event.preventDefault();
+        onSelectMessage(index);
+      }
+    },
+    [onSelectMessage]
+  );
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
+      {messages.length === 0 && (
+        <div className="text-gray-500 text-center py-8">No messages yet</div>
+      )}
+      {messages.map((message, index) => (
+        <div
+          key={message.id}
+          ref={(el) => {
+            itemRefs.current[index] = el;
+          }}
+          role="listitem"
+          tabIndex={0}
+          onKeyDown={(e) => handleKeyDown(e, index)}
+          onClick={() => onSelectMessage(index)}
+          className={`p-3 rounded-lg cursor-pointer outline-none focus:ring-2 focus:ring-blue-500 ${
+            message.sender === "user" ? "bg-blue-100 ml-auto" : "bg-gray-100"
+          } ${activeIndex === index ? "ring-2 ring-blue-500" : ""} max-w-[80%]`}
+          aria-selected={activeIndex === index}
+        >
+          <div className="text-sm font-medium mb-1">
+            {message.sender === "user" ? "You" : "Assistant"}
+          </div>
+          <div>{message.content}</div>
+          {message.details && activeIndex === index && (
+            <div className="mt-2 text-sm text-gray-600 border-t pt-2">
+              {message.details}
+            </div>
+          )}
+        </div>
+      ))}
+    </div>
+  );
+}
+
+// ChatComposer Component
+function ChatComposer({
+  onSend,
+  onClear,
+  composerRef,
+}: {
+  onSend: (message: string) => void;
+  onClear: () => void;
+  composerRef: React.RefObject<HTMLDivElement | null>;
+}) {
+  const [text, setText] = useState("");
+  const inputRef = useRef<HTMLInputElement>(null);
+  const sendButtonRef = useRef<HTMLButtonElement>(null);
+  const attachButtonRef = useRef<HTMLButtonElement>(null);
+  const clearButtonRef = useRef<HTMLButtonElement>(null);
+
+  const handleSend = useCallback(() => {
+    if (text.trim()) {
+      onSend(text.trim());
+      setText("");
+    }
+  }, [text, onSend]);
+
+  const handleKeyDown = useCallback(
+    (event: React.KeyboardEvent) => {
+      if (event.key === "Enter" && !event.shiftKey) {
+        event.preventDefault();
+        handleSend();
+      }
+    },
+    [handleSend]
+  );
+
+  // Focus trap within composer
+  const handleComposerKeyDown = useCallback(
+    (event: React.KeyboardEvent) => {
+      if (event.key !== "Tab") return;
+
+      const focusableElements = [
+        inputRef.current,
+        attachButtonRef.current,
+        clearButtonRef.current,
+        sendButtonRef.current,
+      ].filter(Boolean) as HTMLElement[];
+
+      const firstElement = focusableElements[0];
+      const lastElement = focusableElements[focusableElements.length - 1];
+
+      if (event.shiftKey && document.activeElement === firstElement) {
+        event.preventDefault();
+        lastElement?.focus();
+      } else if (!event.shiftKey && document.activeElement === lastElement) {
+        event.preventDefault();
+        firstElement?.focus();
+      }
+    },
+    []
+  );
+
+  return (
+    <div
+      ref={composerRef}
+      onKeyDown={handleComposerKeyDown}
+      className="p-4 border-t"
+      id="chat-composer"
+    >
+      <div className="flex items-center gap-2">
+        <input
+          ref={inputRef}
+          type="text"
+          value={text}
+          onChange={(e) => setText(e.target.value)}
+          onKeyDown={handleKeyDown}
+          placeholder="Type a message..."
+          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
+          aria-label="Message input"
+        />
+        <button
+          ref={attachButtonRef}
+          type="button"
+          aria-label="Attach file"
+          className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
+        >
+          📎
+        </button>
+        <button
+          ref={clearButtonRef}
+          type="button"
+          onClick={onClear}
+          aria-label="Clear chat"
+          className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
+        >
+          🗑️
+        </button>
+        <button
+          ref={sendButtonRef}
+          type="button"
+          onClick={handleSend}
+          aria-label
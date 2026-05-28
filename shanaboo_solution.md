```diff
--- a/t3code/apps/web/src/components/ChatView.tsx
+++ b/t3code/apps/web/src/components/ChatView.tsx
@@ -1,10 +1,12 @@
 "use client";
 
-import { useCallback, useEffect, useRef, useState } from "react";
+import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
 import { AnimatedHeight } from "./AnimatedHeight";
 
 interface Message {
   id: string;
+  role: "user" | "assistant";
+  content: string;
   text: string;
   timestamp: Date;
 }
@@ -15,6 +17,8 @@ interface ChatViewProps {
 
 export function ChatView({ messages, onSendMessage }: ChatViewProps) {
   const [inputValue, setInputValue] = useState("");
+  const messagesEndRef = useRef<HTMLDivElement>(null);
+  const messageRefs = useRef<(HTMLLIElement | null)[]>([]);
   const inputRef = useRef<HTMLInputElement>(null);
   const sendButtonRef = useRef<HTMLButtonElement>(null);
   const attachButtonRef = useRef<HTMLButtonElement>(null);
@@ -22,6 +26,12 @@ export function ChatView({ messages, onSendMessage }: ChatViewProps) {
   const composerRef = useRef<HTMLDivElement>(null);
   const skipLinkRef = useRef<HTMLAnchorElement>(null);
 
+  useEffect(() => {
+    if (messagesEndRef.current) {
+      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
+    }
+  }, [messages]);
+
   const handleSend = useCallback(() => {
     const trimmed = inputValue.trim();
     if (!trimmed) return;
@@ -30,6 +40,51 @@ export function ChatView({ messages, onSendMessage }: ChatViewProps) {
     inputRef.current?.focus();
   }, [inputValue, onSendMessage]);
 
+  const handleMessageKeyDown = useCallback((event: KeyboardEvent<HTMLLIElement>, index: number) => {
+    switch (event.key) {
+      case "ArrowUp":
+        event.preventDefault();
+        if (index > 0) {
+          messageRefs.current[index - 1]?.focus();
+        } else {
+          inputRef.current?.focus();
+        }
+        break;
+      case "ArrowDown":
+        event.preventDefault();
+        if (index < messages.length - 1) {
+          messageRefs.current[index + 1]?.focus();
+        } else {
+          inputRef.current?.focus();
+        }
+        break;
+      case "Enter":
+        event.preventDefault();
+        // Expand message details - toggle expanded state
+        const message = messages[index];
+        if (message) {
+          // Dispatch custom event for message detail expansion
+          const detailEvent = new CustomEvent("message:expand", { detail: { messageId: message.id } });
+          window.dispatchEvent(detailEvent);
+        }
+        break;
+      case "Escape":
+        event.preventDefault();
+        inputRef.current?.focus();
+        break;
+    }
+  }, [messages]);
+
+  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
+    if (event.key === "ArrowUp" && messages.length > 0) {
+      event.preventDefault();
+      messageRefs.current[messages.length - 1]?.focus();
+    }
+  }, [messages.length]);
+
+  const handleSkipToMessages = useCallback((event: React.MouseEvent) => {
+    event.preventDefault();
+    const lastMessage = messageRefs.current[messages.length - 1];
+    lastMessage?.focus();
+  }, [messages.length]);
+
   const handleSkipToComposer = useCallback((event: React.MouseEvent) => {
     event.preventDefault();
     inputRef.current?.focus();
@@ -41,6 +96,11 @@ export function ChatView({ messages, onSendMessage }: ChatViewProps) {
     clearButtonRef.current?.focus();
   }, []);
 
+  const handleSkipToSidebar = useCallback((event: React.MouseEvent) => {
+    event.preventDefault();
+    // Focus on sidebar - assuming sidebar has id="sidebar"
+    document.getElementById("sidebar")?.focus();
+  }, []);
+
   const handleClear = useCallback(() => {
     setInputValue("");
     inputRef.current?.focus();
@@ -48,6 +108,7 @@ export function ChatView({ messages, onSendMessage }: ChatViewProps) {
 
   return (
     <div className="flex flex-col h-full">
+      {/* Skip links - visually hidden until focused */}
       <a
         href="#chat-messages"
         ref={skipLinkRef}
@@ -56,6 +117,7 @@ export function ChatView({ messages, onSendMessage }: ChatViewProps) {
           focus:static focus:w-auto focus:h-auto focus:m-0 focus:overflow-visible focus:clip-auto focus:whitespace-normal
           sr-only focus:not-sr-only
         "
+        onClick={handleSkipToMessages}
       >
         Skip to messages
       </a>
@@ -66,6 +128,7 @@ export function ChatView({ messages, onSendMessage }: ChatViewProps) {
           focus:static focus:w-auto focus:h-auto focus:m-0 focus:overflow-visible focus:clip-auto focus:whitespace-normal
           sr-only focus:not-sr-only
         "
+        onClick={handleSkipToSidebar}
       >
         Skip to sidebar
       </a>
@@ -82,25 +145,46 @@ export function ChatView({ messages, onSendMessage }: ChatViewProps) {
       </a>
 
       {/* Messages Timeline */}
-      <div id="chat-messages" className="flex-1 overflow-y-auto p-4 space-y-4" role="log" aria-live="polite" aria-relevant="additions">
+      <div
+        id="chat-messages"
+        className="flex-1 overflow-y-auto p-4 space-y-4"
+        role="log"
+        aria-live="polite"
+        aria-relevant="additions"
+        aria-atomic="false"
+      >
         {messages.length === 0 ? (
           <div className="text-center text-gray-500" role="status">
             No messages yet. Start a conversation!
           </div>
         ) : (
-          <ul className="space-y-4" aria-label="Chat messages">
-            {messages.map((message) => (
-              <li key={message.id} className="p-3 rounded-lg bg-gray-100 dark:bg-gray-800">
-                <div className="text-sm text-gray-600 dark:text-gray-300">{message.text}</div>
+          <ul className="space-y-4" aria-label
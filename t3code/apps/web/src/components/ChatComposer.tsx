 "use client";
 
 import { useState, useRef } from "react";
 
 interface ChatComposerProps {
   onSendMessage: (message: string) => void;
   onAttachFile: () => void;
   onClear: () => void;
 }
 
 export function ChatComposer() {
   const [message, setMessage] = useState("");
   const inputRef = useRef<HTMLInputElement>(null);
   
   const sendMessage = () => {
     // Send message logic
   };
 
   const attachFile = () => {
     // Attach file logic
   };
 
   const clearChat = () => {
     // Clear chat logic
   };
 
   return (
     <div className="chat-composer">
       <div className="composer-actions">
         <button 
           onClick={sendMessage}
           aria-label="Send message"
         >
           Send
         </button>
         <button 
           onClick={attachFile}
           aria-label="Attach file"
         >
           Attach
         </button>
         <button 
           onClick={clearChat}
           aria-label="Clear chat"
           aria-label="Clear conversation"
         >
           Clear
         </button>
       </div>
     </div>
   );
 }
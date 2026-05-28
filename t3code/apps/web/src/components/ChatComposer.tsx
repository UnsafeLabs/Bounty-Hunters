import { useState, useRef } from "react";

interface ChatComposerProps {
  onSendMessage: (message: string) => void;
}

export function ChatComposer({ onSendMessage }: ChatComposerProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);

  const handleSend = () => {
    onSendMessage(message);
  };

  return (
    <div className="composer">
      <div className="composer-header">
        <h3>Chat Composer</h3>
      </div>
      
      <div 
        className="composer-input-container"
        role="form"
      >
        <textarea
          ref={textareaRef}
          aria-label="Type your message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby="instructions"
        />
        
        <div className="composer-controls">
          <button
            ref={sendButtonRef}
            onClick={handleSend}
            aria-label="Send message"
          >
            Send
          </button>
          
          <button
            ref={attachButtonRef}
            aria-label="Attach file"
          >
            Attach
          </button>
          
          <button
            ref={clearButtonRef}
            aria-label="Clear chat"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
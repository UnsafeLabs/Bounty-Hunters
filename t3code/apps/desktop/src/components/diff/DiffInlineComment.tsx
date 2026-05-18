import React, { useState } from "react";

/**
 * Fix: Add inline commenting on diff lines in DiffPanelShell (#846)
 */

interface DiffComment {
  id: string;
  line: number;
  author: string;
  body: string;
  timestamp: number;
}

interface DiffLineProps {
  lineNumber: number;
  content: string;
  type: "add" | "remove" | "context";
  comments: DiffComment[];
  onAddComment: (line: number, body: string) => void;
}

export const DiffLineWithComments: React.FC<DiffLineProps> = ({
  lineNumber, content, type, comments, onAddComment,
}) => {
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [commentText, setCommentText] = useState("");

  const bgColor = type === "add" ? "bg-green-900/20" : type === "remove" ? "bg-red-900/20" : "";

  return (
    <div className="group relative">
      <div className={`flex ${bgColor} hover:bg-gray-800/50`}>
        <span className="w-12 text-right pr-2 text-gray-500 text-xs select-none">{lineNumber}</span>
        <span className="flex-1 text-sm whitespace-pre font-mono">{content}</span>
        <button
          onClick={() => setShowCommentBox(!showCommentBox)}
          className="opacity-0 group-hover:opacity-100 text-xs px-2 text-blue-400 hover:text-blue-300"
        >
          💬
        </button>
      </div>
      {showCommentBox && (
        <div className="ml-12 p-2 bg-gray-800 border border-gray-700 rounded">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            className="w-full bg-gray-900 text-sm p-2 rounded border border-gray-600"
            placeholder="Add a comment..."
            rows={2}
          />
          <button
            onClick={() => { onAddComment(lineNumber, commentText); setCommentText(""); setShowCommentBox(false); }}
            className="mt-1 text-xs px-3 py-1 bg-blue-600 rounded hover:bg-blue-500"
          >
            Submit
          </button>
        </div>
      )}
      {comments.map((c) => (
        <div key={c.id} className="ml-12 p-2 bg-gray-800/50 border-l-2 border-blue-500">
          <span className="text-xs text-gray-400">{c.author}</span>
          <p className="text-sm">{c.body}</p>
        </div>
      ))}
    </div>
  );
};

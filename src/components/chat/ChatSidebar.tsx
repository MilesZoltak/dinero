'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, AlertTriangle, Sparkles, User, RefreshCw, Move } from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export default function ChatSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);

  // Position state for movable Floating Action Button
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; initialFabX: number; initialFabY: number }>({
    x: 0,
    y: 0,
    initialFabX: 0,
    initialFabY: 0,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  // Handle Dragging of FAB
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = false;
    const initialX = fabPos ? fabPos.x : window.innerWidth - 220;
    const initialY = fabPos ? fabPos.y : window.innerHeight - 80;

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      initialFabX: initialX,
      initialFabY: initialY,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - dragStartRef.current.x;
      const deltaY = moveEvent.clientY - dragStartRef.current.y;

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        isDraggingRef.current = true;
      }

      let newX = dragStartRef.current.initialFabX + deltaX;
      let newY = dragStartRef.current.initialFabY + deltaY;

      // Bound within viewport
      newX = Math.max(16, Math.min(window.innerWidth - 200, newX));
      newY = Math.max(16, Math.min(window.innerHeight - 70, newY));

      setFabPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleFabClick = () => {
    if (!isDraggingRef.current) {
      setIsOpen(!isOpen);
    }
  };

  const handleCloseAttempt = () => {
    if (messages.length > 0) {
      setShowCloseModal(true);
    } else {
      setIsOpen(false);
    }
  };

  const confirmCloseAndClear = () => {
    setMessages([]);
    setShowCloseModal(false);
    setIsOpen(false);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = {
      id: 'msg_user_' + Date.now(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    const assistantMsgId = 'msg_assistant_' + Date.now();
    const initialAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, initialAssistantMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) {
        let errMessage = `HTTP ${res.status} Error`;
        try {
          const errData = await res.json();
          if (errData.error) errMessage = errData.error;
        } catch {
          const txt = await res.text();
          if (txt) errMessage = txt;
        }
        throw new Error(errMessage);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let buffer = '';

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // Keep incomplete last line in buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith('data: ')) {
                const dataStr = trimmedLine.slice(6).trim();
                if (dataStr === '[DONE]') break;
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.text) {
                    accumulatedText += parsed.text;
                    setMessages((prev) =>
                      prev.map((msg) => (msg.id === assistantMsgId ? { ...msg, content: accumulatedText } : msg))
                    );
                  }
                } catch (e) {
                  // Buffer partial line
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Error fetching chat response:', err);
      const errMsg = err.message || 'Error communicating with assistant service.';
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content: `⚠️ **Error**: ${errMsg}`,
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessageContent = (content: string) => {
    if (!content) return <span className="animate-pulse opacity-60">Thinking...</span>;

    const lines = content.split('\n');
    let inTable = false;
    const elements: React.ReactNode[] = [];
    let tableHeaders: string[] = [];
    let tableRows: string[][] = [];

    lines.forEach((line, idx) => {
      if (line.startsWith('|')) {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        if (line.includes('---')) return;
        if (!inTable) {
          inTable = true;
          tableHeaders = cells;
          tableRows = [];
        } else {
          tableRows.push(cells);
        }
        return;
      }

      if (inTable) {
        elements.push(
          <div key={`table_${idx}`} className="my-2 overflow-x-auto rounded border border-white/10">
            <table className="min-w-full text-xs text-left">
              <thead className="bg-white/10 font-semibold">
                <tr>
                  {tableHeaders.map((th, hIdx) => (
                    <th key={hIdx} className="px-2.5 py-1.5 border-b border-white/10">
                      {th.replace(/\*\*/g, '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tableRows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-2.5 py-1">
                        {cell.replace(/\*\*/g, '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        inTable = false;
      }

      if (line.startsWith('### ')) {
        elements.push(
          <h4 key={idx} className="font-semibold text-xs text-emerald-400 mt-2 mb-1">
            {line.replace('### ', '')}
          </h4>
        );
        return;
      }

      if (line.startsWith('- ')) {
        const text = line.replace('- ', '');
        elements.push(
          <div key={idx} className="flex items-start gap-1.5 my-0.5 text-xs">
            <span className="text-emerald-400 mt-0.5">•</span>
            <span>{formatBoldText(text)}</span>
          </div>
        );
        return;
      }

      if (line.trim() !== '') {
        elements.push(
          <p key={idx} className="text-xs my-1 leading-relaxed">
            {formatBoldText(line)}
          </p>
        );
      }
    });

    if (inTable) {
      elements.push(
        <div key={`table_end`} className="my-2 overflow-x-auto rounded border border-white/10">
          <table className="min-w-full text-xs text-left">
            <thead className="bg-white/10 font-semibold">
              <tr>
                {tableHeaders.map((th, hIdx) => (
                  <th key={hIdx} className="px-2.5 py-1.5 border-b border-white/10">
                    {th.replace(/\*\*/g, '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tableRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-2.5 py-1">
                      {cell.replace(/\*\*/g, '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return elements;
  };

  const formatBoldText = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  // Compute inline position for FAB if moved
  const fabStyle: React.CSSProperties = fabPos
    ? { left: `${fabPos.x}px`, top: `${fabPos.y}px`, right: 'auto', bottom: 'auto' }
    : {};

  return (
    <>
      {/* Floating Action Button (Movable) */}
      <button
        onMouseDown={handleMouseDown}
        onClick={handleFabClick}
        style={fabStyle}
        className="dinero-fab-trigger group"
        title="Drag to move, click to toggle Dinero Assistant"
      >
        <Bot className="w-5 h-5 text-white" />
        <span>Dinero Assistant</span>
        <Move className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 transition-opacity ml-1" />
      </button>

      {/* Floating Expandable Chat Box */}
      {isOpen && (
        <div
          className="dinero-chat-floating-window"
          style={
            fabPos
              ? {
                  left: `${Math.min(window.innerWidth - 420, Math.max(16, fabPos.x - 200))}px`,
                  top: `${Math.max(16, fabPos.y - 620)}px`,
                  right: 'auto',
                  bottom: 'auto',
                }
              : {}
          }
        >
          {/* Header */}
          <div className="dinero-chat-header dinero-chat-drag-handle">
            <div className="dinero-chat-header-title">
              <div className="dinero-chat-header-icon">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-white flex items-center gap-1.5">
                  Dinero Assistant
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                </h3>
                <p className="text-[10px] text-emerald-400 font-medium">Financial Context Active</p>
              </div>
            </div>
            <button onClick={handleCloseAttempt} className="dinero-chat-close-btn">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="dinero-chat-messages">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-400 space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                  <Bot className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-semibold text-white">Ask Dinero Assistant</h4>
                <p className="text-xs text-gray-400 max-w-[240px]">
                  Ask questions about your accounts, net worth, top spending categories, or recent transactions.
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs mt-0.5 ${
                      msg.role === 'user'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-gray-800 text-emerald-400 border border-gray-700'
                    }`}
                  >
                    {msg.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                  </div>

                  <div
                    className={`dinero-chat-bubble ${
                      msg.role === 'user' ? 'dinero-chat-bubble-user' : 'dinero-chat-bubble-assistant'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1 pb-1 border-b border-white/10 text-[10px] opacity-75">
                      <span className="font-semibold">{msg.role === 'user' ? 'You' : 'Dinero Assistant'}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    {msg.role === 'user' ? msg.content : renderMessageContent(msg.content)}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Disclaimer */}
          <div className="dinero-chat-footer-disclaimer">
            Financial AI suggestions are for informational purposes only. Consult a certified financial planner for official advice.
          </div>

          {/* Input Bar */}
          <form onSubmit={handleSendMessage} className="dinero-chat-input-form">
            <div className="dinero-chat-input-wrapper">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Ask about your accounts or transactions..."
                rows={1}
                className="dinero-chat-textarea"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="dinero-chat-send-btn"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/60 z-[1001] flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-white">Temporary Conversation</h4>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              Your conversation with Dinero Assistant is temporary and will be cleared once closed. Are you sure you want to close?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCloseModal(false)}
                className="px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                Keep Chatting
              </button>
              <button
                onClick={confirmCloseAndClear}
                className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors"
              >
                Clear & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

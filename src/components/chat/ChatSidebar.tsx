'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, AlertTriangle, Sparkles, User, RefreshCw } from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatSidebar({ isOpen, onClose }: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const handleCloseAttempt = () => {
    if (messages.length > 0) {
      setShowCloseModal(true);
    } else {
      onClose();
    }
  };

  const confirmCloseAndClear = () => {
    setMessages([]);
    setShowCloseModal(false);
    onClose();
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
        throw new Error('Failed to send message');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          if (value) {
            const chunkValue = decoder.decode(value);
            const lines = chunkValue.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.replace('data: ', '').trim();
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
                  // ignore partial JSON buffer parses
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching chat response:', err);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content:
                  'Sorry, I encountered an error communicating with the financial assistant service. Please try again.',
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Helper to render markdown formatting simply (bold, headers, tables)
  const renderMessageContent = (content: string) => {
    if (!content) return <span className="animate-pulse text-gray-400">Thinking...</span>;

    const lines = content.split('\n');
    let inTable = false;
    const elements: React.ReactNode[] = [];
    let tableHeaders: string[] = [];
    let tableRows: string[][] = [];

    lines.forEach((line, idx) => {
      // Table row parser
      if (line.startsWith('|')) {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        if (line.includes('---')) {
          return; // divider line
        }
        if (!inTable) {
          inTable = true;
          tableHeaders = cells;
          tableRows = [];
        } else {
          tableRows.push(cells);
        }
        return;
      }

      // Flush table if line is not a table row
      if (inTable) {
        elements.push(
          <div key={`table_${idx}`} className="my-2 overflow-x-auto rounded border border-gray-700">
            <table className="min-w-full text-xs text-left text-gray-300">
              <thead className="bg-gray-800 text-gray-200 uppercase font-semibold">
                <tr>
                  {tableHeaders.map((th, hIdx) => (
                    <th key={hIdx} className="px-3 py-2 border-b border-gray-700">
                      {th.replace(/\*\*/g, '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-gray-900/50">
                {tableRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-gray-800/40">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-1.5">
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

      // Headers
      if (line.startsWith('### ')) {
        elements.push(
          <h4 key={idx} className="font-semibold text-sm text-emerald-400 mt-2 mb-1">
            {line.replace('### ', '')}
          </h4>
        );
        return;
      }

      // Bullet points
      if (line.startsWith('- ')) {
        const text = line.replace('- ', '');
        elements.push(
          <div key={idx} className="flex items-start gap-1.5 my-0.5 text-xs text-gray-300">
            <span className="text-emerald-400 mt-0.5">•</span>
            <span>{formatBoldText(text)}</span>
          </div>
        );
        return;
      }

      if (line.trim() !== '') {
        elements.push(
          <p key={idx} className="text-xs text-gray-200 my-1 leading-relaxed">
            {formatBoldText(line)}
          </p>
        );
      }
    });

    // Flush trailing table
    if (inTable) {
      elements.push(
        <div key={`table_end`} className="my-2 overflow-x-auto rounded border border-gray-700">
          <table className="min-w-full text-xs text-left text-gray-300">
            <thead className="bg-gray-800 text-gray-200 uppercase font-semibold">
              <tr>
                {tableHeaders.map((th, hIdx) => (
                  <th key={hIdx} className="px-3 py-2 border-b border-gray-700">
                    {th.replace(/\*\*/g, '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 bg-gray-900/50">
              {tableRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-gray-800/40">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-1.5">
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

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 transition-opacity"
        onClick={handleCloseAttempt}
      />

      {/* Slide-out Sidebar */}
      <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[380px] bg-gray-900 border-l border-gray-800 shadow-2xl z-50 flex flex-col transition-transform transform duration-300">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/80 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
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
          <button
            onClick={handleCloseAttempt}
            className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
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
                className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 text-xs mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-xl p-3 text-xs ${
                    msg.role === 'user'
                      ? 'bg-emerald-600 text-white rounded-br-none shadow-sm'
                      : 'bg-gray-800 border border-gray-700 text-gray-200 rounded-bl-none shadow-sm'
                  }`}
                >
                  {msg.role === 'user' ? msg.content : renderMessageContent(msg.content)}
                  <span className="block text-[9px] text-gray-400 mt-1 text-right">{msg.timestamp}</span>
                </div>

                {msg.role === 'user' && (
                  <div className="w-6 h-6 rounded-full bg-gray-700 text-gray-300 flex items-center justify-center shrink-0 text-xs mt-0.5">
                    <User className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Disclaimer Notice */}
        <div className="px-4 py-2 bg-gray-950/60 border-t border-gray-800 text-[10px] text-gray-500 text-center">
          Financial AI suggestions are for informational purposes only. Consult a certified financial planner for official advice.
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSendMessage} className="p-3 border-t border-gray-800 bg-gray-900">
          <div className="relative flex items-center">
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
              className="w-full bg-gray-800 text-xs text-white rounded-lg pl-3 pr-10 py-2.5 border border-gray-700 focus:outline-none focus:border-emerald-500 resize-none"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute right-2 text-emerald-400 disabled:text-gray-600 hover:text-emerald-300 p-1 transition-colors"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </form>
      </div>

      {/* Confirmation Modal on Reset / Close */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
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

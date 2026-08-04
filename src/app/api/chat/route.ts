import { NextResponse } from 'next/server';
import {
  getAccountsSummaryTool,
  queryTransactionsTool,
  getSpendingByCategoryTool,
  CHATBOT_TOOLS_SCHEMA,
} from '@/lib/chatbot/tools';

export const runtime = 'nodejs';

// Dispatcher for tool execution requested by LLM
async function executeTool(name: string, args: any) {
  try {
    switch (name) {
      case 'get_accounts_summary':
        return await getAccountsSummaryTool();
      case 'query_transactions':
        return await queryTransactionsTool({
          startDate: args.startDate,
          endDate: args.endDate,
          minAmount: args.minAmount ? parseFloat(args.minAmount) : undefined,
          maxAmount: args.maxAmount ? parseFloat(args.maxAmount) : undefined,
          category: args.category,
          subcategory: args.subcategory,
          merchant: args.merchant,
          limit: args.limit ? parseInt(args.limit, 10) : undefined,
        });
      case 'get_spending_by_category':
        return await getSpendingByCategoryTool({
          startDate: args.startDate,
          endDate: args.endDate,
        });
      default:
        return { error: `Unknown tool name: ${name}` };
    }
  } catch (err: any) {
    console.error(`Error executing chatbot tool ${name}:`, err);
    return { error: err.message || 'Tool execution failed' };
  }
}

// Fallback rule-based smart assistant logic when external GEMINI_API_KEY is not configured
async function generateMockAssistantResponse(messages: any[]) {
  const lastMessage = messages[messages.length - 1]?.content || '';
  const lowerMsg = lastMessage.toLowerCase();

  if (lowerMsg.includes('account') || lowerMsg.includes('balance') || lowerMsg.includes('net worth')) {
    const summary = await getAccountsSummaryTool();
    let text = `Here is a summary of your financial accounts:\n\n`;
    text += `- **Net Worth**: $${summary.netWorth.toLocaleString()}\n`;
    text += `- **Total Assets**: $${summary.totalAssets.toLocaleString()}\n`;
    text += `- **Total Liabilities**: $${summary.totalLiabilities.toLocaleString()}\n\n`;
    text += `### Account Breakdown\n`;
    summary.accounts.forEach((acc) => {
      text += `- **${acc.name}** (${acc.institutionName || 'Manual'}): $${acc.balance.toLocaleString()}\n`;
    });
    return text;
  }

  if (lowerMsg.includes('category') || lowerMsg.includes('where did my money go') || lowerMsg.includes('spending')) {
    const categories = await getSpendingByCategoryTool({});
    let text = `Here is your spending breakdown by category:\n\n`;
    text += `| Category | Total Spent | Transactions |\n| :--- | :--- | :--- |\n`;
    categories.forEach((c) => {
      text += `| **${c.category}** | $${c.totalAmount.toLocaleString()} | ${c.transactionCount} |\n`;
    });
    return text;
  }

  // Default transaction query response
  const txData = await queryTransactionsTool({ limit: 10 });
  let text = `I found **${txData.count}** recent transactions in your records. Here are the top 10:\n\n`;
  text += `| Date | Name | Category | Amount |\n| :--- | :--- | :--- | :--- |\n`;
  txData.transactions.forEach((t) => {
    const formattedAmt = t.amount > 0 ? `$${t.amount.toFixed(2)}` : `+$${Math.abs(t.amount).toFixed(2)}`;
    text += `| ${t.date} | ${t.name} | ${t.category} | ${formattedAmt} |\n`;
  });
  text += `\n*Feel free to ask me to filter by date, category, or specific merchant!*`;
  return text;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    // Safety Guard: Truncate context to last 20 turns
    const recentMessages = messages.slice(-20);

    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

    // Direct stream generator using SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let responseContent = '';

          // If Gemini API Key exists and is valid, invoke function calling API loop
          if (apiKey && process.env.GEMINI_API_KEY) {
            try {
              const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
              
              // Format conversation history for Gemini API
              const contents = recentMessages.map((m: any) => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }],
              }));

              const systemInstruction = {
                parts: [
                  {
                    text: `You are Dinero Assistant, a helpful and friendly personal finance assistant in Dinero.
You have read-only access to the user's financial accounts and transaction records via tool function calls.
Always use tool function calls when asked questions about spending, balances, transactions, or categories.
Format financial amounts nicely with dollar signs and commas. Use markdown tables for list breakdowns.
Always remind users that AI suggestions are for informational purposes only.`,
                  },
                ],
              };

              const payload = {
                contents,
                systemInstruction,
                tools: [{ functionDeclarations: CHATBOT_TOOLS_SCHEMA }],
              };

              const res = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });

              if (res.ok) {
                const geminiData = await res.json();
                const candidatePart = geminiData.candidates?.[0]?.content?.parts?.[0];

                if (candidatePart?.functionCall) {
                  const call = candidatePart.functionCall;
                  const toolResult = await executeTool(call.name, call.args || {});

                  // Follow up turn with tool execution output
                  const followUpPayload = {
                    contents: [
                      ...contents,
                      geminiData.candidates[0].content,
                      {
                        role: 'user',
                        parts: [
                          {
                            functionResponse: {
                              name: call.name,
                              response: { content: toolResult },
                            },
                          },
                        ],
                      },
                    ],
                    systemInstruction,
                  };

                  const followUpRes = await fetch(geminiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(followUpPayload),
                  });

                  if (followUpRes.ok) {
                    const followUpData = await followUpRes.json();
                    responseContent = followUpData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  }
                } else if (candidatePart?.text) {
                  responseContent = candidatePart.text;
                }
              }
            } catch (apiErr) {
              console.error('Error contacting Gemini API:', apiErr);
            }
          }

          // Fallback if no response generated from remote API
          if (!responseContent) {
            responseContent = await generateMockAssistantResponse(recentMessages);
          }

          // Chunked streaming simulated delivery
          const chunkSize = 20;
          for (let i = 0; i < responseContent.length; i += chunkSize) {
            const chunk = responseContent.slice(i, i + chunkSize);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, 15));
          }

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err) {
          console.error('Streaming response error:', err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Error in /api/chat route:', error);
    return NextResponse.json({ error: 'Internal server error in chatbot endpoint' }, { status: 500 });
  }
}

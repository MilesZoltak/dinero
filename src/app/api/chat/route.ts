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

/**
 * Intelligent Data Query Assistant for offline / isolated environments.
 * Runs exact tool functions against dbAdapter when outbound Gemini network is unreachable.
 */
async function processOfflineAgentQuery(messages: any[]): Promise<string> {
  const lastMsg = (messages[messages.length - 1]?.content || '').toLowerCase();

  if (lastMsg.includes('account') || lastMsg.includes('balance') || lastMsg.includes('net worth')) {
    const summary = await executeTool('get_accounts_summary', {});
    let text = `Here is a summary of your financial accounts:\n\n`;
    text += `- **Net Worth**: $${summary.netWorth.toLocaleString()}\n`;
    text += `- **Total Assets**: $${summary.totalAssets.toLocaleString()}\n`;
    text += `- **Total Liabilities**: $${summary.totalLiabilities.toLocaleString()}\n\n`;
    text += `### Account Breakdown\n`;
    summary.accounts.forEach((acc: any) => {
      text += `- **${acc.name}** (${acc.institutionName || 'Manual'}): $${acc.balance.toLocaleString()}\n`;
    });
    return text;
  }

  if (lastMsg.includes('category') || lastMsg.includes('spending') || lastMsg.includes('where did my money go')) {
    const categories = await executeTool('get_spending_by_category', {});
    let text = `Here is your spending breakdown by category:\n\n`;
    text += `| Category | Total Spent | Transactions |\n| :--- | :--- | :--- |\n`;
    categories.forEach((c: any) => {
      text += `| **${c.category}** | $${c.totalAmount.toLocaleString()} | ${c.transactionCount} |\n`;
    });
    return text;
  }

  // Default: Query recent transactions from dbAdapter
  const txData = await executeTool('query_transactions', { limit: 10 });
  let text = `I queried your financial records and found **${txData.count}** transactions:\n\n`;
  text += `| Date | Name | Category | Amount |\n| :--- | :--- | :--- | :--- |\n`;
  txData.transactions.forEach((t: any) => {
    const formattedAmt = t.amount > 0 ? `$${t.amount.toFixed(2)}` : `+$${Math.abs(t.amount).toFixed(2)}`;
    text += `| ${t.date} | ${t.name} | ${t.category} | ${formattedAmt} |\n`;
  });
  text += `\n*Ask me to filter by category, date range, or merchant!*`;
  return text;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Gemini API key is not configured. Set GEMINI_API_KEY in .env.local.' },
        { status: 500 }
      );
    }

    // Truncate context to last 20 turns
    const recentMessages = messages.slice(-20);
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const contents = recentMessages.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const systemInstruction = {
      parts: [
        {
          text: `You are Dinero Assistant, a helpful personal finance assistant in Dinero.
You have read-only access to user financial data via tool function calls.
Format financial amounts nicely with dollar signs and commas. Use markdown tables for breakdowns.`,
        },
      ],
    };

    const payload = {
      contents,
      systemInstruction,
      tools: [{ functionDeclarations: CHATBOT_TOOLS_SCHEMA }],
    };

    let responseContent = '';

    try {
      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('Gemini API Error Response:', res.status, errText);
        return NextResponse.json(
          { error: `Gemini API call failed with status ${res.status}: ${errText}` },
          { status: res.status }
        );
      }

      const geminiData = await res.json();
      const candidatePart = geminiData.candidates?.[0]?.content?.parts?.[0];

      if (candidatePart?.functionCall) {
        const call = candidatePart.functionCall;
        const toolResult = await executeTool(call.name, call.args || {});

        const followUpPayload = {
          contents: [
            ...contents,
            geminiData.candidates[0].content,
            {
              role: 'function',
              parts: [{ functionResponse: { name: call.name, response: { content: toolResult } } }],
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
    } catch (networkErr: any) {
      console.warn('Outbound Gemini network call unreachable, executing offline database tool processor:', networkErr.message);
      // Execute offline tool processor directly against database
      responseContent = await processOfflineAgentQuery(recentMessages);
    }

    if (!responseContent) {
      return NextResponse.json(
        { error: 'No response content returned from model or database tool execution.' },
        { status: 500 }
      );
    }

    // SSE Stream delivery
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const chunkSize = 20;
          for (let i = 0; i < responseContent.length; i += chunkSize) {
            const chunk = responseContent.slice(i, i + chunkSize);
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
            } catch {
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 15));
          }

          try {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch {
            // Stream closed
          }
        } catch (err) {
          console.error('Streaming error:', err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Error in /api/chat route:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error in chatbot endpoint' },
      { status: 500 }
    );
  }
}

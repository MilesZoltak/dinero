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

      if (!followUpRes.ok) {
        const errText = await followUpRes.text();
        console.error('Gemini Tool Follow-up Error:', errText);
        return NextResponse.json(
          { error: `Gemini tool follow-up failed with status ${followUpRes.status}: ${errText}` },
          { status: followUpRes.status }
        );
      }

      const followUpData = await followUpRes.json();
      responseContent = followUpData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else if (candidatePart?.text) {
      responseContent = candidatePart.text;
    }

    if (!responseContent) {
      return NextResponse.json(
        { error: 'No response content returned from model function execution.' },
        { status: 500 }
      );
    }

    // Real SSE Stream delivery
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

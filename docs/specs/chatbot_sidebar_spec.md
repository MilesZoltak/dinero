# Feature Specification: Dinero Assistant Sidebar

Comprehensive product specification and implementation requirements for the expandable AI chatbot sidebar in Dinero.

---

## 1. Overview & Vision

**Dinero Assistant** is a collapsible right-side AI chatbot designed to help users inquire about their personal finances, analyze spending patterns, track cash flow, and receive tailored financial insights.

- **Branding**: `Dinero Assistant`
- **Default State**: Closed by default; opened via an action button in the main navigation.
- **Session Lifecycle**: Ephemeral per drawer open/close cycle (with user confirmation modal upon closing).

---

## 2. User Interface & Experience (UI & UX)

### Sidebar Drawer Component
- **Position & Animation**: Right-aligned drawer (380px fixed width).
- **Layout Behavior**: Drawer overlays dashboard content with a semi-transparent backdrop overlay.
- **Branding Header**:
  - Title: `Dinero Assistant`
  - Action Controls: Close button `(X)`.
- **Message Feed**:
  - User vs Assistant message bubbles.
  - **Rich Text & Formatting**: Supports markdown formatting, bold metrics, currency styling (`$1,234.56`), bullet points, and dynamic financial summary table markdown.
  - Sticky Disclaimer Footer: *"Financial AI suggestions are for informational purposes only. Consult a certified financial planner for official advice."*
- **Input Bar**: Textarea with `Enter` (send) and `Shift+Enter` (newline).

### Session Reset Confirmation Modal
When a user clicks to close the sidebar:
- A modal dialog appears: *"Your conversation with Dinero Assistant is temporary and will be cleared once closed. Are you sure you want to close?"*
- Buttons: `Keep Chatting` (cancel) and `Clear & Close` (confirm).

---

## 3. Data Access Architecture & Direct API Endpoint Bridge

Instead of introducing a separate MCP layer immediately, the chatbot backend engine calls internal REST API endpoint controllers directly (or direct database queries via `dbAdapter`).

```
┌─────────────────────────────────────────────────────────────┐
│                   Next.js Chat Drawer UI                    │
│           - Ephemeral React State (messages[])              │
└──────────────────────────────┬──────────────────────────────┘
                               │ POST /api/chat (SSE stream)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Chat Route & Agent Engine                 │
│                 (src/app/api/chat/route.ts)                 │
│  - Truncates context window (last 20 turns)                 │
│  - Enforces max token payload bounds                        │
│  - Executes Gemini Function Calling / Tool Execution Loop   │
└──────────────────────────────┬──────────────────────────────┘
                               │ Invokes Tool Functions
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Direct Internal Data Tools                  │
│                (src/lib/chatbot/tools.ts)                   │
│  - get_accounts_summary()                                   │
│  - query_transactions(params)                               │
│  - get_category_breakdown(params)                           │
└──────────────────────────────┬──────────────────────────────┘
                               │ Reads DB / API Logic
                               ▼
┌─────────────────────────────────────────────────────────────┐
│            Database (Cloud Firestore / db.json)             │
└─────────────────────────────────────────────────────────────┘
```

### Agent Tool Specifications
1. **`get_accounts`**: Returns all user accounts (checking, savings, credit cards, investments) with balances and type metadata.
2. **`query_transactions`**:
   - Query filters: `startDate`, `endDate`, `minAmount`, `maxAmount`, `category`, `subcategory`, `merchant`, `limit` (max 50 per tool call to prevent context overflow).
3. **`get_categories`**: Returns active category rules and hierarchy.

---

## 4. Context Management & Safety Guards

1. **Turn Truncation**: Maximum of **last 20 message turns** sent to the LLM backend per request.
2. **Tool Output Truncation**: Tool response payloads returned to the LLM are capped at **50 records / 8KB** maximum JSON size per function response to prevent context window overflow.
3. **Auto Truncation Strategy**: Backend automatically drops oldest message turns if total payload exceeds safety token limits.
4. **Read-Only Scope**: Agent has zero mutation capabilities (`POST`/`DELETE` prohibited).

---

## 5. Decision Log

| Date | Decision ID | Topic | Decision Made | Rationale / Notes |
| :--- | :--- | :--- | :--- | :--- |
| 2026-08-04 | DEC-001 | UI Prompt Chips | Omit quick-prompt chips | Kept UI simple and uncluttered. |
| 2026-08-04 | DEC-002 | Streaming Control | Omit stop generation button | Kept UI controls minimal. |
| 2026-08-04 | DEC-003 | Conversation State | Ephemeral per open/close | Closing sidebar resets session; warning modal informs user. |
| 2026-08-04 | DEC-004 | Tool Architecture | Direct Internal API Bridge (No MCP yet) | Simplified architecture; direct API tool calls to avoid early complexity. |
| 2026-08-04 | DEC-005 | Branding | `Dinero Assistant` | Official feature name. |
| 2026-08-04 | DEC-006 | Keyboard Shortcuts | Omit keyboard shortcuts | User choice to avoid hotkey collisions. |
| 2026-08-04 | DEC-007 | Context Guards | Last 20 turns max + Tool payload capping | Prevents context window overflows and reduces token cost. |
| 2026-08-04 | DEC-008 | Reset Warning Modal | Show confirmation modal when closing sidebar | Prevents accidental loss of ephemeral chat context. |

# Quick Reference: createAgent API Research

**Full Document:** [RESEARCH_CREATEAGENT_API.md](./RESEARCH_CREATEAGENT_API.md)

---

## Quick Answers

### Q1: Where is `createAgent` defined?

**File:** `libs/langchain/src/agents/index.ts`  
**Exports from:** `langchain` package  
**Implementation:** `libs/langchain/src/agents/ReactAgent.ts`

```typescript
import { createAgent } from "langchain";

const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [myTool],
  middleware: [myMiddleware],
});
```

---

### Q2: Can middleware modify the model at runtime?

**YES ✅** - Use the `wrapModelCall` hook.

```typescript
createMiddleware({
  name: "dynamicModel",
  wrapModelCall: (request, handler) => {
    // Change the model
    return handler({
      ...request,
      model: new ChatOpenAI({ model: "gpt-4o-mini" }),
    });
  },
});
```

---

### Q3: Can middleware modify tools at runtime?

**YES ✅** - Use the `wrapModelCall` hook.

```typescript
createMiddleware({
  name: "toolFilter",
  wrapModelCall: (request, handler) => {
    // Filter tools
    const filteredTools = request.tools.filter(
      t => permissions.includes(t.name)
    );
    return handler({ ...request, tools: filteredTools });
  },
});
```

---

### Q4: What hooks are available?

Six hooks in execution order:

1. **`beforeAgent`** - Once at start (can modify initial state)
2. **`beforeModel`** - Before each model call (can modify state)
3. **`wrapModelCall`** - Wrap model invocation (**can modify model & tools**)
4. **`afterModel`** - After model call (can modify tool calls)
5. **`wrapToolCall`** - Wrap each tool execution (can intercept tools)
6. **`afterAgent`** - Once at end (final cleanup)

---

### Q5: How to pass runtime configuration?

Use **context** (read-only, per-request):

```typescript
const agent = createAgent({
  model: "openai:gpt-4o",
  middleware: [
    createMiddleware({
      name: "config",
      contextSchema: z.object({
        userId: z.string(),
        modelPreference: z.string().optional(),
      }),
      wrapModelCall: (request, handler) => {
        // Access runtime config
        const { modelPreference } = request.runtime.context;
        // Use it...
      },
    }),
  ],
});

// Pass at invocation
await agent.invoke(
  { messages: [...] },
  { context: { userId: "123", modelPreference: "gpt-4o-mini" } }
);
```

---

### Q6: Should agents be created per-request or as singletons?

**SINGLETON ✅** - Create once at startup, reuse for all requests.

```typescript
// ✅ Good: Create once
const agent = createAgent({ /* ... */ });

app.post("/chat", async (req) => {
  return agent.invoke({ messages: req.body.messages });
});

// ❌ Bad: Create per-request
app.post("/chat", async (req) => {
  const agent = createAgent({ /* ... */ }); // Expensive!
  return agent.invoke({ messages: req.body.messages });
});
```

**Why?** Graph compilation is expensive (done once in constructor).

---

### Q7: Multi-tenant pattern?

One agent + context-based filtering:

```typescript
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: allTools,
  middleware: [
    createMiddleware({
      name: "tenantFilter",
      contextSchema: z.object({
        tenantId: z.string(),
        permissions: z.array(z.string()),
      }),
      wrapModelCall: (request, handler) => {
        const { permissions } = request.runtime.context;
        const tools = request.tools.filter(t => 
          permissions.includes(t.name)
        );
        return handler({ ...request, tools });
      },
    }),
  ],
});

// Per-tenant invocation
await agent.invoke(
  { messages: [...] },
  { 
    context: { tenantId: "tenant-1", permissions: ["tool1", "tool2"] },
    configurable: { thread_id: "tenant-1-thread-123" },
  }
);
```

---

### Q8: How to implement model factories?

No built-in factory, but middleware achieves the same:

```typescript
createMiddleware({
  name: "modelFactory",
  contextSchema: z.object({
    model: z.enum(["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet"]),
  }),
  wrapModelCall: (request, handler) => {
    const modelName = request.runtime.context.model;
    const model = modelName.startsWith("gpt")
      ? new ChatOpenAI({ model: modelName })
      : new ChatAnthropic({ model: modelName });
    
    return handler({ ...request, model });
  },
});
```

---

### Q9: Available middleware examples?

Built-in middleware (in `libs/langchain/src/agents/middleware/`):

- **modelFallback** - Fallback to alternative models
- **modelRetry** - Retry failed model calls
- **toolRetry** - Retry failed tool calls
- **modelCallLimit** - Limit model calls
- **toolCallLimit** - Limit tool calls
- **summarization** - Summarize long conversations
- **contextEditing** - Edit conversation context
- **piiRedaction** - Redact PII
- **hitl** - Human-in-the-loop
- **llmToolSelector** - LLM-based tool selection
- **promptCaching** - Anthropic prompt caching
- **moderation** - OpenAI content moderation

---

### Q10: Performance implications?

From benchmarks (`libs/langchain/src/agents/tests/agent.bench.test.ts`):

- Simple agent: ≤60ms per invocation
- Agent with 10 tools: ≤60ms
- Agent with 50 tools: Still fast

**Key:** Graph compiled once (singleton pattern = no per-request cost).

---

## Code Examples Location

**Examples directory:** `examples/src/createAgent/`

Key examples:
- `updateModelBeforeCall.ts` - Dynamic model selection
- `updateToolsBeforeModelCall.ts` - Dynamic tool availability
- `dynamicTools/simple.ts` - Context-based tool gating
- `dynamicTools/advanced.ts` - Semantic tool selection
- `middleware/` - Various middleware examples

---

## Recent Changes (v1.0)

**Released:** December 2024

Major changes:
- `createAgent` introduced as the new standard
- Middleware-first design
- Built on LangGraph (persistence, streaming, HITL)
- Improved structured output

Recent additions:
- `modelRetryMiddleware` (v1.1.5)
- `SystemMessage` support for `systemPrompt` (v1.1.5)
- OpenAI moderation middleware (v1.1.5)

---

## See Full Document

For complete details, code samples, and in-depth analysis:

👉 **[RESEARCH_CREATEAGENT_API.md](./RESEARCH_CREATEAGENT_API.md)**

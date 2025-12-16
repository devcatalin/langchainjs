# Research Report: Context Propagation in LangChain Agents

**Date:** December 16, 2024  
**Repository:** langchain-ai/langchainjs  
**Focus:** Context propagation when using subagents/nested agents

---

## Executive Summary

**Key Findings:**
- ❌ **Context does NOT automatically propagate** from parent agent to subagents
- ✅ **Subagents must be invoked with explicit config** to receive context
- ✅ **Tools receive RunnableConfig** and can forward it to subagents
- ✅ **`getCurrentTaskInput` provides access** to parent state from tool context

---

## Table of Contents

1. [Context Propagation Model](#1-context-propagation-model)
2. [How to Pass Context to Subagents](#2-how-to-pass-context-to-subagents)
3. [Examples from Codebase](#3-examples-from-codebase)
4. [Best Practices](#4-best-practices)
5. [Limitations and Workarounds](#5-limitations-and-workarounds)

---

## 1. Context Propagation Model

### 1.1 Default Behavior

**Context does NOT propagate automatically.** When you wrap a subagent as a tool and invoke it from a parent agent:

```typescript
// Parent agent with context
const parentAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [subagentTool],
});

// Invoke with context
await parentAgent.invoke(
  { messages: [...] },
  { context: { userId: "user-123", tenantId: "tenant-1" } }
);

// Inside the tool that wraps the subagent:
const subagentTool = tool(async ({ request }) => {
  // ❌ Subagent invoked WITHOUT context
  const result = await subagent.invoke({
    messages: [{ role: "user", content: request }],
  });
  // The subagent does NOT have access to userId or tenantId
  return result.messages.at(-1)?.content;
});
```

**Why?** Because the tool function needs to explicitly forward the config parameter.

### 1.2 How Configuration Flows

```
Parent Agent Invocation
  ↓ (with config { context: { userId, tenantId } })
Parent Agent Execution
  ↓
Tool Call (RunnableConfig passed to tool)
  ↓ (tool receives config parameter)
Tool Implementation
  ↓ (must explicitly pass config to subagent)
Subagent Invocation
  ↓ (only if config is forwarded)
Subagent Execution (with context)
```

### 1.3 Agent Invoke Signature

From `libs/langchain/src/agents/ReactAgent.ts`:

```typescript
class ReactAgent<...> {
  async invoke(
    state: InvokeStateParameter<StateSchema, TMiddleware>,
    config?: InvokeConfiguration<
      InferContextInput<ContextSchema> & InferMiddlewareContextInputs<TMiddleware>
    >
  ): Promise<FullState>
}

// InvokeConfiguration includes:
type InvokeConfiguration<TContext> = {
  context?: TContext;           // Runtime context
  configurable?: {              // LangGraph configuration
    thread_id?: string;
    [key: string]: unknown;
  };
  streamMode?: StreamMode;
  recursionLimit?: number;
  // ... other LangGraph PregelOptions
};
```

**Key Insight:** The `config` parameter contains the `context` and must be passed explicitly to subagents.

---

## 2. How to Pass Context to Subagents

### 2.1 Basic Pattern

**Step 1:** Tool receives `config` parameter

```typescript
const subagentTool = tool(
  async ({ request }, config) => {  // ✅ Receive config
    // Tool implementation
  },
  {
    name: "subagent_tool",
    description: "Invokes a subagent",
    schema: z.object({ request: z.string() }),
  }
);
```

**Step 2:** Forward `config` to subagent invocation

```typescript
const subagentTool = tool(
  async ({ request }, config) => {
    // ✅ Forward config to subagent
    const result = await subagent.invoke(
      { messages: [{ role: "user", content: request }] },
      config  // Pass config here
    );
    return result.messages.at(-1)?.content;
  },
  {
    name: "subagent_tool",
    description: "Invokes a subagent",
    schema: z.object({ request: z.string() }),
  }
);
```

**Step 3:** Subagent middleware can access context

```typescript
const subagent = createAgent({
  model: "openai:gpt-4o",
  tools: [],
  middleware: [
    createMiddleware({
      name: "contextLogger",
      contextSchema: z.object({
        userId: z.string(),
        tenantId: z.string(),
      }),
      beforeModel: (state, runtime) => {
        // ✅ Access context from parent
        console.log("User ID:", runtime.context.userId);
        console.log("Tenant ID:", runtime.context.tenantId);
      },
    }),
  ],
});
```

### 2.2 Complete Example

```typescript
import { createAgent, createMiddleware, tool } from "langchain";
import { z } from "zod";

// Define context schema
const contextSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  permissions: z.array(z.string()),
});

// Create subagent with context awareness
const subagent = createAgent({
  model: "openai:gpt-4o",
  tools: [myTool],
  middleware: [
    createMiddleware({
      name: "tenantFilter",
      contextSchema,
      wrapModelCall: (request, handler) => {
        // Access context from parent agent
        const { permissions } = request.runtime.context;
        
        // Filter tools based on permissions
        const tools = request.tools.filter(t =>
          permissions.includes(t.name)
        );
        
        return handler({ ...request, tools });
      },
    }),
  ],
});

// Create tool that wraps subagent
const subagentTool = tool(
  async ({ task }, config) => {
    // ✅ Forward config to subagent
    const result = await subagent.invoke(
      { messages: [{ role: "user", content: task }] },
      config  // Config contains context
    );
    
    return result.messages.at(-1)?.content;
  },
  {
    name: "delegate_task",
    description: "Delegate task to specialized subagent",
    schema: z.object({
      task: z.string().describe("Task description"),
    }),
  }
);

// Create parent agent
const parentAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [subagentTool],
});

// Invoke with context
await parentAgent.invoke(
  { messages: [{ role: "user", content: "Do something" }] },
  {
    context: {
      userId: "user-123",
      tenantId: "tenant-1",
      permissions: ["myTool"],
    },
    configurable: {
      thread_id: "thread-456",
    },
  }
);
```

### 2.3 Accessing Parent State

Use `getCurrentTaskInput` from `@langchain/langgraph` to access parent state:

```typescript
import { getCurrentTaskInput } from "@langchain/langgraph";
import type { BuiltInState } from "langchain";

const subagentTool = tool(
  async ({ task }, config) => {
    // ✅ Access parent agent's state
    const parentState = getCurrentTaskInput<BuiltInState>(config);
    
    // Access parent messages
    const parentMessages = parentState.messages;
    const originalUserMessage = parentMessages.find(HumanMessage.isInstance);
    
    // Customize prompt for subagent with parent context
    const prompt = `
You are assisting with the following user inquiry:

${originalUserMessage?.content || "No context available"}

You are tasked with the following sub-request:

${task}
    `.trim();
    
    // Invoke subagent with enriched prompt
    const result = await subagent.invoke(
      { messages: [{ role: "user", content: prompt }] },
      config  // Forward config
    );
    
    return result.messages.at(-1)?.content;
  },
  {
    name: "delegate_task",
    description: "Delegate task to specialized subagent",
    schema: z.object({
      task: z.string(),
    }),
  }
);
```

---

## 3. Examples from Codebase

### 3.1 Supervisor Pattern

From `examples/src/createAgent/supervisor.ts`:

```typescript
// Step 1: Create subagents with middleware
const calendarAgent = createAgent({
  model: llm,
  tools: [createCalendarEvent, getAvailableTimeSlots],
  systemPrompt: CALENDAR_AGENT_PROMPT,
  middleware: [
    humanInTheLoopMiddleware({
      interruptOn: { create_calendar_event: true },
    }),
  ],
});

// Step 2: Wrap subagent as tool WITH config parameter
const scheduleEvent = tool(
  async ({ request }, config) => {
    // Access parent state using getCurrentTaskInput
    const currentMessages = getCurrentTaskInput<BuiltInState>(config).messages;
    const originalUserMessage = currentMessages.find(HumanMessage.isInstance);
    
    // Create enriched prompt
    const prompt = `
You are assisting with the following user inquiry:

${originalUserMessage?.content || "No context available"}

You are tasked with the following sub-request:

${request}
    `.trim();
    
    // Invoke subagent
    // NOTE: This example does NOT forward config, so context is lost
    const result = await calendarAgent.invoke({
      messages: [{ role: "user", content: prompt }],
    });
    
    return result.messages[result.messages.length - 1].text;
  },
  {
    name: "schedule_event",
    description: "Schedule calendar events using natural language",
    schema: z.object({
      request: z.string(),
    }),
  }
);

// Step 3: Create supervisor with wrapped tool
const supervisorAgent = createAgent({
  model: llm,
  tools: [scheduleEvent, manageEmail],
  systemPrompt: SUPERVISOR_PROMPT,
  checkpointer: new MemorySaver(),
});

// Step 4: Invoke supervisor
await supervisorAgent.invoke(
  { messages: [{ role: "user", content: "Schedule a meeting..." }] },
  { configurable: { thread_id: "6" } }
);
```

**Important:** The supervisor example does NOT forward config to subagents. To propagate context, you would need to modify it:

```typescript
const scheduleEvent = tool(
  async ({ request }, config) => {
    // ... access parent state ...
    
    // ✅ Forward config to subagent
    const result = await calendarAgent.invoke(
      { messages: [{ role: "user", content: prompt }] },
      config  // Add this line
    );
    
    return result.messages[result.messages.length - 1].text;
  },
  // ... tool definition ...
);
```

### 3.2 State Access in Tools

From `libs/langchain/src/agents/tests/reactAgent.test.ts`:

```typescript
const stateCheckTool = tool(
  async (_, config) => {
    // Access full task input (state) via config
    const taskInput = await getCurrentTaskInput(config);
    return JSON.stringify(taskInput);
  },
  {
    name: "state_check_tool",
    description: "A tool that checks the current task input",
    schema: z.object({
      query: z.string(),
    }),
  }
);

const agent = createAgent({
  model,
  tools: [stateCheckTool],
  stateSchema: z.object({
    customField: z.string().optional(),
  }),
});

// Tool can access the full state including customField
const result = await agent.invoke({
  messages: [{ role: "user", content: "test" }],
  customField: "custom value",
});
```

---

## 4. Best Practices

### 4.1 Always Accept Config in Subagent Tools

```typescript
// ✅ Good: Tool accepts config
const subagentTool = tool(
  async ({ task }, config) => {
    return await subagent.invoke({ messages: [...] }, config);
  },
  { /* ... */ }
);

// ❌ Bad: Tool doesn't accept config
const subagentTool = tool(
  async ({ task }) => {
    return await subagent.invoke({ messages: [...] });
    // Context is lost!
  },
  { /* ... */ }
);
```

### 4.2 Define Context Schema in Subagents

```typescript
// ✅ Good: Subagent declares what context it needs
const subagent = createAgent({
  model: "openai:gpt-4o",
  tools: [],
  middleware: [
    createMiddleware({
      name: "contextAware",
      contextSchema: z.object({
        userId: z.string(),
        tenantId: z.string(),
      }),
      beforeModel: (state, runtime) => {
        // TypeScript knows about userId and tenantId
        console.log("User:", runtime.context.userId);
      },
    }),
  ],
});

// ❌ Bad: No context schema declared
const subagent = createAgent({
  model: "openai:gpt-4o",
  tools: [],
  // No middleware with contextSchema - unclear what context is needed
});
```

### 4.3 Document Context Requirements

```typescript
/**
 * Specialized subagent for handling calendar operations.
 * 
 * Required context:
 * - userId: string - The user making the request
 * - tenantId: string - The tenant scope
 * - permissions: string[] - List of allowed operations
 */
const calendarAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [createCalendarEvent, getAvailableTimeSlots],
  middleware: [
    createMiddleware({
      name: "calendarAuth",
      contextSchema: z.object({
        userId: z.string(),
        tenantId: z.string(),
        permissions: z.array(z.string()),
      }),
      // ... middleware implementation
    }),
  ],
});
```

### 4.4 Use Consistent Context Structure

Define a shared context schema for all agents in your system:

```typescript
// shared/context.ts
export const SharedContextSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  permissions: z.array(z.string()),
  requestId: z.string().optional(),
});

export type SharedContext = z.infer<typeof SharedContextSchema>;

// agents/calendar.ts
const calendarAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [],
  middleware: [
    createMiddleware({
      name: "auth",
      contextSchema: SharedContextSchema,  // ✅ Use shared schema
      // ...
    }),
  ],
});

// agents/email.ts
const emailAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [],
  middleware: [
    createMiddleware({
      name: "auth",
      contextSchema: SharedContextSchema,  // ✅ Use shared schema
      // ...
    }),
  ],
});
```

### 4.5 Enriching Context for Subagents

You can add additional context when invoking subagents:

```typescript
const subagentTool = tool(
  async ({ task }, config) => {
    // Extract parent context
    const parentContext = config?.context || {};
    
    // Add subagent-specific context
    const enrichedConfig = {
      ...config,
      context: {
        ...parentContext,
        subagentName: "calendarAgent",
        taskType: "scheduling",
      },
    };
    
    // Invoke with enriched context
    const result = await subagent.invoke(
      { messages: [{ role: "user", content: task }] },
      enrichedConfig
    );
    
    return result.messages.at(-1)?.content;
  },
  { /* ... */ }
);
```

---

## 5. Limitations and Workarounds

### 5.1 Limitation: Manual Config Forwarding Required

**Problem:** There's no automatic config propagation. You must explicitly pass `config` to every subagent invocation.

**Workaround:** Create a wrapper function that always forwards config:

```typescript
/**
 * Helper to invoke a subagent with automatic config forwarding
 */
function invokeSubagent<T extends Record<string, any>>(
  agent: ReactAgent<any, any, any, any>,
  input: { messages: any[] } & T,
  config?: any
) {
  return agent.invoke(input, config);
}

// Use the wrapper
const subagentTool = tool(
  async ({ task }, config) => {
    // ✅ Config automatically forwarded
    const result = await invokeSubagent(
      subagent,
      { messages: [{ role: "user", content: task }] },
      config
    );
    return result.messages.at(-1)?.content;
  },
  { /* ... */ }
);
```

### 5.2 Limitation: `configurable` Thread Isolation

**Problem:** If you forward `configurable.thread_id` from parent to subagent, they'll share the same thread, which may not be desired.

**Workaround:** Create separate thread IDs for subagents:

```typescript
const subagentTool = tool(
  async ({ task }, config) => {
    // Extract context (keep) and configurable (modify)
    const { context, configurable, ...restConfig } = config || {};
    
    // Create subagent-specific thread ID
    const subagentConfig = {
      ...restConfig,
      context,  // ✅ Forward context
      configurable: {
        ...configurable,
        thread_id: `${configurable?.thread_id || "default"}_calendar_subagent`,
      },
    };
    
    const result = await subagent.invoke(
      { messages: [{ role: "user", content: task }] },
      subagentConfig
    );
    
    return result.messages.at(-1)?.content;
  },
  { /* ... */ }
);
```

### 5.3 Limitation: No Built-in Context Merging

**Problem:** If parent and subagent have different context schemas, there's no automatic merging.

**Workaround:** Manually merge contexts:

```typescript
const parentAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [subagentTool],
  middleware: [
    createMiddleware({
      name: "parentContext",
      contextSchema: z.object({
        userId: z.string(),
        role: z.string(),
      }),
      // ...
    }),
  ],
});

const subagent = createAgent({
  model: "openai:gpt-4o",
  tools: [],
  middleware: [
    createMiddleware({
      name: "subagentContext",
      contextSchema: z.object({
        userId: z.string(),  // Shared
        role: z.string(),    // Shared
        department: z.string(),  // Subagent-specific
      }),
      // ...
    }),
  ],
});

const subagentTool = tool(
  async ({ task }, config) => {
    // Merge parent context with subagent-specific context
    const mergedConfig = {
      ...config,
      context: {
        ...config?.context,  // Parent context
        department: "engineering",  // Subagent-specific
      },
    };
    
    const result = await subagent.invoke(
      { messages: [{ role: "user", content: task }] },
      mergedConfig
    );
    
    return result.messages.at(-1)?.content;
  },
  { /* ... */ }
);
```

### 5.4 Limitation: No Type Safety Across Agent Boundaries

**Problem:** TypeScript doesn't enforce that parent context matches subagent context schema.

**Workaround:** Use shared types and runtime validation:

```typescript
// shared/types.ts
export const BaseContextSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
});

export const CalendarContextSchema = BaseContextSchema.extend({
  calendarId: z.string(),
});

// In subagent tool
const subagentTool = tool(
  async ({ task }, config) => {
    // Runtime validation
    const calendarContext = CalendarContextSchema.parse({
      ...config?.context,
      calendarId: config?.context?.calendarId || "default",
    });
    
    const result = await subagent.invoke(
      { messages: [{ role: "user", content: task }] },
      { ...config, context: calendarContext }
    );
    
    return result.messages.at(-1)?.content;
  },
  { /* ... */ }
);
```

---

## 6. Summary

### Key Takeaways

1. **Context does NOT auto-propagate** - You must explicitly forward `config` to subagent invocations

2. **Tools receive config** - Use the second parameter: `async (input, config) => { ... }`

3. **Forward config to subagents** - Call `subagent.invoke(state, config)` with the config

4. **Access parent state** - Use `getCurrentTaskInput(config)` in tools

5. **Define context schemas** - Use middleware `contextSchema` to declare what context is needed

6. **Thread isolation** - Modify `configurable.thread_id` to isolate subagent threads

7. **Type safety** - Use shared context schemas and runtime validation

### Quick Reference

```typescript
// ✅ Complete pattern for context propagation
const subagentTool = tool(
  async ({ task }, config) => {
    // 1. Access parent state (optional)
    const parentState = getCurrentTaskInput<BuiltInState>(config);
    
    // 2. Forward config to subagent
    const result = await subagent.invoke(
      { messages: [{ role: "user", content: task }] },
      config  // This is the key!
    );
    
    return result.messages.at(-1)?.content;
  },
  {
    name: "delegate_task",
    description: "Delegate to subagent",
    schema: z.object({ task: z.string() }),
  }
);
```

### Code References

**Key Files:**
- `examples/src/createAgent/supervisor.ts` - Multi-agent example with subagents
- `libs/langchain/src/agents/tests/reactAgent.test.ts` - Tests showing `getCurrentTaskInput` usage
- `libs/langchain/src/agents/ReactAgent.ts` - Agent invoke signature and config handling

**LangGraph Utilities:**
- `getCurrentTaskInput(config)` - Access parent agent state from tool
- `config.context` - Runtime context from parent
- `config.configurable` - LangGraph configuration (thread_id, etc.)

---

## Conclusion

Context propagation in nested agents requires **manual forwarding** of the `config` parameter. While this adds a bit of boilerplate, it provides:
- **Explicit control** over what context is passed
- **Flexibility** to modify or enrich context per subagent
- **Clear separation** between parent and subagent execution

The pattern is straightforward: always accept `config` in tools that invoke subagents, and always pass it to the subagent's `invoke` method.

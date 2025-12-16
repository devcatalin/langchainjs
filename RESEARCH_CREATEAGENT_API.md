# Research Report: LangChain createAgent API and Runtime Configuration

**Date:** December 16, 2024  
**Repository:** langchain-ai/langchainjs  
**Main Package:** `langchain` v1.2.1  
**Focus:** `createAgent` function, middleware capabilities, and runtime configuration patterns

---

## Table of Contents

1. [createAgent Function Overview](#1-createagent-function-overview)
2. [Middleware Capabilities](#2-middleware-capabilities)
3. [Runtime Configuration Patterns](#3-runtime-configuration-patterns)
4. [Graph Creation Patterns](#4-graph-creation-patterns)
5. [Dynamic Injection Examples](#5-dynamic-injection-examples)
6. [Recent Changes and Proposals](#6-recent-changes-and-proposals)
7. [Key Findings Summary](#7-key-findings-summary)

---

## 1. createAgent Function Overview

### 1.1 Location and Definition

**File:** `libs/langchain/src/agents/index.ts`  
**Exports from:** `langchain` package

The `createAgent` function is the primary entry point for creating production-ready ReAct agents in LangChain v1.0+.

### 1.2 Full TypeScript Signature

```typescript
export function createAgent<
  StructuredResponseFormat extends Record<string, any> = Record<string, any>,
  StateSchema extends AnyAnnotationRoot | InteropZodObject | undefined = undefined,
  ContextSchema extends AnyAnnotationRoot | InteropZodObject = AnyAnnotationRoot,
  TMiddleware extends readonly AgentMiddleware[] = readonly AgentMiddleware[]
>(
  params: CreateAgentParams<
    StructuredResponseFormat,
    StateSchema,
    ContextSchema,
    ResponseFormatType
  >
): ReactAgent<StructuredResponseFormat, StateSchema, ContextSchema, TMiddleware>
```

### 1.3 Key Parameters

From `CreateAgentParams` (located in `libs/langchain/src/agents/types.ts`):

```typescript
type CreateAgentParams<
  StructuredResponseType extends Record<string, any>,
  StateSchema extends AnyAnnotationRoot | InteropZodObject | undefined,
  ContextSchema extends AnyAnnotationRoot | InteropZodObject,
  ResponseFormatType
> = {
  /**
   * The language model - can be a string identifier or model instance
   * Examples: "openai:gpt-4o", "anthropic:claude-3-7-sonnet-latest"
   */
  model: string | LanguageModelLike;

  /**
   * Array of tools or a configured ToolNode
   */
  tools?: (ServerTool | ClientTool)[];

  /**
   * System instructions - can be string, SystemMessage, or function
   * String is most common; SystemMessage for advanced features like cache control
   */
  systemPrompt?: string | SystemMessage | ((state: any) => string | SystemMessage);

  /**
   * Zod schema or JSON schema for structured output
   */
  responseFormat?: ResponseFormatType;

  /**
   * Custom state schema for memory/persistence
   */
  stateSchema?: StateSchema;

  /**
   * Context schema for read-only runtime data
   */
  contextSchema?: ContextSchema;

  /**
   * Array of middleware for extending agent behavior
   */
  middleware?: readonly AgentMiddleware[];

  /**
   * Checkpointer for persistence
   */
  checkpointSaver?: BaseCheckpointSaver;

  /**
   * Store for long-term memory
   */
  store?: BaseStore;

  /**
   * Agent name (for multi-agent systems)
   */
  name?: string;

  /**
   * Include agent name in messages
   */
  includeAgentName?: boolean;

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal;

  /**
   * Tool behavior version
   */
  version?: "v1" | "v2";
};
```

### 1.4 Return Type

Returns a `ReactAgent` instance with:
- `invoke(state, config?)` - Execute the agent synchronously
- `stream(state, config?)` - Stream agent execution
- `drawMermaidPng()` - Visualize the agent graph
- `getGraph()` - Get the compiled LangGraph StateGraph

### 1.5 Implementation Details

**Located in:** `libs/langchain/src/agents/ReactAgent.ts`

The `createAgent` function instantiates a `ReactAgent` class which:
1. **Validates** the model parameter (required)
2. **Compiles** middleware tools with user-provided tools
3. **Creates** a LangGraph StateGraph with nodes:
   - `model_request` (AgentNode) - Makes LLM calls
   - `tools` (ToolNode) - Executes tool calls
   - Middleware nodes (`<name>.before_agent`, `<name>.before_model`, `<name>.after_model`, `<name>.after_agent`)
4. **Compiles** the graph once at creation time
5. **Returns** the agent instance ready for invocation

```typescript
export class ReactAgent<...> {
  #graph: CompiledStateGraph<...>;
  
  constructor(public options: CreateAgentParams<...>) {
    // Validate model
    if (!options.model) {
      throw new Error("`model` option is required to create an agent.");
    }

    // Merge middleware tools with provided tools
    const middlewareTools = this.options.middleware
      ?.filter((m) => m.tools)
      .flatMap((m) => m.tools) ?? [];
    const toolClasses = [...(options.tools ?? []), ...middlewareTools];

    // Create state graph with merged schemas
    const { state, input, output } = createAgentAnnotationConditional(...);
    const workflow = new StateGraph({ state, input, output }, contextSchema);

    // Add nodes for agent, tools, and middleware hooks
    // ... add nodes ...

    // Compile the graph once
    this.#graph = workflow.compile({
      checkpointSaver: options.checkpointSaver,
      store: options.store,
      interruptBefore,
      interruptAfter,
    });
  }
}
```

**Key Insight:** The graph is compiled once at agent creation time, not per-request.

---

## 2. Middleware Capabilities

### 2.1 What Middleware Can Do

Middleware in `createAgent` provides powerful hooks to extend agent behavior. Located in `libs/langchain/src/agents/middleware/types.ts`.

### 2.2 Core Middleware Interface

```typescript
interface AgentMiddleware<
  TSchema extends InteropZodObject | undefined = any,
  TContextSchema extends InteropZodObject | undefined = any,
  TFullContext = any
> {
  /**
   * Brand property to distinguish from plain objects/functions
   */
  readonly [MIDDLEWARE_BRAND]: true;

  /**
   * Unique name for the middleware
   */
  name: string;

  /**
   * State schema - persisted across invocations
   */
  stateSchema?: TSchema;

  /**
   * Context schema - read-only, not persisted
   */
  contextSchema?: TContextSchema;

  /**
   * Additional tools provided by middleware
   */
  tools?: (ClientTool | ServerTool)[];

  /**
   * Hook functions (see below)
   */
  wrapToolCall?: WrapToolCallHook<TSchema, TFullContext>;
  wrapModelCall?: WrapModelCallHook<TSchema, TFullContext>;
  beforeAgent?: BeforeAgentHook<TSchema, TFullContext>;
  beforeModel?: BeforeModelHook<TSchema, TFullContext>;
  afterModel?: AfterModelHook<TSchema, TFullContext>;
  afterAgent?: AfterAgentHook<TSchema, TFullContext>;
}
```

### 2.3 Available Hooks

#### 2.3.1 beforeAgent Hook

**When:** Called once at the start of agent invocation (before any model calls)

```typescript
type BeforeAgentHook<TSchema, TContext> = 
  | ((state: TSchema, runtime: Runtime<TContext>) => 
      PromiseOrValue<MiddlewareResult<Partial<TSchema>>>)
  | {
      hook: (state, runtime) => ...;
      canJumpTo?: JumpToTarget[]; // ["model_request", "tools"]
    };
```

**Can:**
- Modify initial state
- Add/inject messages
- Set up middleware-specific state
- Jump to different nodes (with `canJumpTo`)

**Cannot:**
- Modify the model
- Modify tools

#### 2.3.2 beforeModel Hook

**When:** Called before each model invocation (before wrapModelCall)

```typescript
type BeforeModelHook<TSchema, TContext> = 
  | ((state: TSchema, runtime: Runtime<TContext>) => 
      PromiseOrValue<MiddlewareResult<Partial<TSchema>>>)
  | {
      hook: (state, runtime) => ...;
      canJumpTo?: JumpToTarget[];
    };
```

**Can:**
- Modify state before model call
- Inject context into messages
- Set routing signals
- Access current messages

**Cannot:**
- Directly modify model or tools (use wrapModelCall for that)

#### 2.3.3 wrapModelCall Hook

**When:** Wraps the actual model invocation

```typescript
type WrapModelCallHook<TSchema, TContext> = (
  request: ModelRequest<TSchema, TContext>,
  handler: WrapModelCallHandler<TSchema, TContext>
) => PromiseOrValue<AIMessage>;

// ModelRequest contains:
interface ModelRequest<TState, TContext> {
  model: LanguageModelLike;           // The model instance
  messages: BaseMessage[];            // Messages to send
  systemPrompt?: string;              // System prompt
  systemMessage?: SystemMessage;      // Or SystemMessage
  tools: (ClientTool | ServerTool)[]; // Available tools
  state: TState;                      // Full agent state
  runtime: Runtime<TContext>;         // Runtime info
}
```

**Can:**
- **Modify the model at runtime** ✅
- **Change/filter tools at runtime** ✅
- Modify system prompt
- Modify messages
- Handle errors and retry
- Implement fallbacks
- Add caching, logging, monitoring
- Post-process the response

**Example - Dynamic Model Selection:**
```typescript
wrapModelCall: async (request, handler) => {
  // Choose model based on context
  const modelId = request.runtime.context?.model || "gpt-4o-mini";
  
  return handler({
    ...request,
    model: new ChatOpenAI({ model: modelId }),
  });
}
```

**Example - Dynamic Tool Filtering:**
```typescript
wrapModelCall: async (request, handler) => {
  // Filter tools based on user permissions
  const allowedTools = request.tools.filter(tool =>
    request.runtime.context.permissions.includes(tool.name)
  );
  
  return handler({ ...request, tools: allowedTools });
}
```

#### 2.3.4 afterModel Hook

**When:** Called after model invocation (before tools execute)

```typescript
type AfterModelHook<TSchema, TContext> = 
  | ((state: TSchema, runtime: Runtime<TContext>) => 
      PromiseOrValue<MiddlewareResult<Partial<TSchema>>>)
  | {
      hook: (state, runtime) => ...;
      canJumpTo?: JumpToTarget[];
    };
```

**Can:**
- Modify tool call parameters
- Validate model output
- Add/remove tool calls
- Control routing with `jumpTo`
- Access the model's response

**Cannot:**
- Modify the model (too late)

#### 2.3.5 wrapToolCall Hook

**When:** Wraps each individual tool execution

```typescript
type WrapToolCallHook<TSchema, TContext> = (
  request: ToolCallRequest<TSchema, TContext>,
  handler: ToolCallHandler<TSchema, TContext>
) => PromiseOrValue<ToolMessage | Command>;

// ToolCallRequest contains:
interface ToolCallRequest<TState, TContext> {
  toolCall: ToolCall;               // The tool call to execute
  tool: ClientTool | ServerTool;    // The tool instance
  state: TState;                    // Full agent state
  runtime: Runtime<TContext>;       // Runtime info
}
```

**Can:**
- Intercept tool calls
- Modify tool arguments
- Handle tool errors
- Add retry logic
- Implement caching
- Add authentication/authorization
- Return custom results without calling the tool

**Example - Tool Authentication:**
```typescript
wrapToolCall: async (request, handler) => {
  if (!request.runtime.context.isAuthorized(request.tool.name)) {
    return new ToolMessage({
      content: "Unauthorized",
      tool_call_id: request.toolCall.id,
    });
  }
  return handler(request);
}
```

#### 2.3.6 afterAgent Hook

**When:** Called once at the end of agent invocation (after all work is complete)

```typescript
type AfterAgentHook<TSchema, TContext> = 
  | ((state: TSchema, runtime: Runtime<TContext>) => 
      PromiseOrValue<MiddlewareResult<Partial<TSchema>>>)
  | {
      hook: (state, runtime) => ...;
      canJumpTo?: JumpToTarget[];
    };
```

**Can:**
- Final state modifications
- Cleanup operations
- Logging/metrics
- Final validation

### 2.4 Middleware State Management

Middleware can define **two types of schemas**:

1. **stateSchema** - Persisted across invocations (stored in checkpointer)
   ```typescript
   stateSchema: z.object({
     callCount: z.number().default(0),
     lastModel: z.string().optional(),
   })
   ```

2. **contextSchema** - Read-only per-invocation (not persisted)
   ```typescript
   contextSchema: z.object({
     userId: z.string(),
     permissions: z.array(z.string()),
   })
   ```

### 2.5 Creating Middleware

Use the `createMiddleware` helper (located in `libs/langchain/src/agents/middleware.ts`):

```typescript
import { createMiddleware } from "langchain";

const myMiddleware = createMiddleware({
  name: "MyMiddleware",
  stateSchema: z.object({ /* ... */ }),
  contextSchema: z.object({ /* ... */ }),
  beforeModel: async (state, runtime) => { /* ... */ },
  wrapModelCall: async (request, handler) => { /* ... */ },
  // ... other hooks
});
```

### 2.6 Built-in Middleware Examples

The repository includes several built-in middleware (in `libs/langchain/src/agents/middleware/`):

- **modelFallback** - Fallback to alternative models on failure
- **modelRetry** - Retry failed model calls
- **toolRetry** - Retry failed tool calls
- **modelCallLimit** - Limit number of model calls
- **toolCallLimit** - Limit number of tool calls
- **summarization** - Summarize long conversations
- **contextEditing** - Edit conversation context
- **piiRedaction** - Redact PII data
- **hitl** (human-in-the-loop) - Request human approval
- **llmToolSelector** - Use LLM to select tools
- **dynamicSystemPrompt** - Dynamic system prompt generation
- **promptCaching** (Anthropic) - Anthropic prompt caching
- **moderation** (OpenAI) - OpenAI content moderation

---

## 3. Runtime Configuration Patterns

### 3.1 RunnableConfig and Configurable

`createAgent` returns a `ReactAgent` which has `invoke` and `stream` methods accepting a config parameter:

```typescript
type InvokeConfiguration<TContext> = {
  /**
   * Runtime context (read-only)
   */
  context?: TContext;

  /**
   * Configurable values (for LangGraph)
   */
  configurable?: {
    thread_id?: string;
    [key: string]: unknown;
  };

  /**
   * Stream mode
   */
  streamMode?: StreamMode;

  /**
   * Recursion limit
   */
  recursionLimit?: number;

  // ... other LangGraph PregelOptions
};
```

### 3.2 Dynamic Model Injection via Context

**Pattern:** Use middleware with `contextSchema` to pass model preferences at runtime.

```typescript
// Define agent with context schema
const contextSchema = z.object({
  model: z.enum(["gpt-4o", "gpt-4o-mini"]).optional(),
});

const agent = createAgent({
  model: "openai:gpt-4o-mini", // Default
  tools: [],
  middleware: [
    createMiddleware({
      name: "dynamicModel",
      contextSchema,
      wrapModelCall: (request, handler) => {
        if (request.runtime.context?.model) {
          return handler({
            ...request,
            model: new ChatOpenAI({ model: request.runtime.context.model }),
          });
        }
        return handler(request);
      },
    }),
  ],
});

// Runtime: specify model via context
const result = await agent.invoke(
  { messages: [{ role: "user", content: "Hello" }] },
  { context: { model: "gpt-4o" } } // ✅ Dynamic model selection
);
```

**Key Insight:** The `context` is read-only and passed to all middleware hooks via `runtime.context`.

### 3.3 Dynamic Tool Injection via Context

**Pattern:** Use middleware to filter/select tools based on runtime context.

```typescript
const allTools = [githubTool, gitlabTool, slackTool];

const agent = createAgent({
  model: "openai:gpt-4o",
  tools: allTools, // Register all tools
  middleware: [
    createMiddleware({
      name: "toolFilter",
      contextSchema: z.object({
        vcsProvider: z.enum(["github", "gitlab"]),
      }),
      wrapModelCall: (request, handler) => {
        // Filter tools based on context
        const provider = request.runtime.context.vcsProvider;
        const tools = request.tools.filter(tool =>
          tool.name.startsWith(provider)
        );
        return handler({ ...request, tools });
      },
    }),
  ],
});

// Runtime: specify provider
await agent.invoke(
  { messages: [...] },
  { context: { vcsProvider: "github" } } // ✅ Only GitHub tools available
);
```

### 3.4 Lazy Model Initialization

**Pattern:** Use a string model identifier; the agent lazily initializes it via `initChatModel`.

```typescript
// Option 1: String identifier (lazy)
const agent = createAgent({
  model: "openai:gpt-4o", // Initialized on first use
  tools: [],
});

// Option 2: Pre-initialized instance
const agent = createAgent({
  model: new ChatOpenAI({ model: "gpt-4o", temperature: 0.7 }),
  tools: [],
});
```

**Note:** No "factory" pattern is provided; use middleware for dynamic selection.

### 3.5 Multi-Tenant Patterns

**Pattern:** Use context to isolate tenant data and permissions.

```typescript
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: allTools,
  middleware: [
    createMiddleware({
      name: "tenantIsolation",
      contextSchema: z.object({
        tenantId: z.string(),
        permissions: z.array(z.string()),
      }),
      wrapToolCall: (request, handler) => {
        // Check permissions
        const { permissions } = request.runtime.context;
        if (!permissions.includes(request.tool.name)) {
          return new ToolMessage({
            content: "Unauthorized",
            tool_call_id: request.toolCall.id,
          });
        }
        return handler(request);
      },
      wrapModelCall: (request, handler) => {
        // Filter tools by tenant permissions
        const { permissions } = request.runtime.context;
        const tools = request.tools.filter(t => permissions.includes(t.name));
        return handler({ ...request, tools });
      },
    }),
  ],
});

// Per-tenant invocation
await agent.invoke(
  { messages: [...] },
  { 
    context: { 
      tenantId: "tenant-123",
      permissions: ["github_create_issue", "slack_send_message"],
    } 
  }
);
```

### 3.6 Thread-Level State vs Context

**State (persisted):**
- Stored in checkpointer
- Survives across invocations
- Use for conversation history, counters, etc.
- Pass via `stateSchema` in middleware

**Context (not persisted):**
- Read-only
- Per-invocation only
- Use for request-scoped data (user ID, permissions, etc.)
- Pass via `contextSchema` in middleware and `context` in config

```typescript
// State example
const agent = createAgent({
  stateSchema: z.object({
    conversationCount: z.number().default(0),
  }),
  middleware: [
    createMiddleware({
      name: "counter",
      stateSchema: z.object({
        conversationCount: z.number().default(0),
      }),
      beforeAgent: (state) => ({
        conversationCount: state.conversationCount + 1,
      }),
    }),
  ],
});

// Context example
await agent.invoke(
  { messages: [...] },
  { 
    context: { userId: "user-123" }, // ✅ Request-scoped
    configurable: { thread_id: "thread-456" }, // ✅ For persistence
  }
);
```

---

## 4. Graph Creation Patterns

### 4.1 Agent Creation: Singleton vs Per-Request

**Recommendation from codebase:** Create agents as **singletons** (once at application startup).

**Rationale:**
1. **Graph compilation is expensive** - Done once in the constructor
2. **Middleware setup is expensive** - Node creation happens once
3. **Schema validation** - Happens once at creation
4. **No runtime cost** - Invocations are stateless (except for checkpointed state)

**Evidence from code:**
```typescript
// In ReactAgent constructor (libs/langchain/src/agents/ReactAgent.ts):
constructor(public options: CreateAgentParams<...>) {
  // ... expensive operations:
  // 1. Create state schema with middleware
  const { state, input, output } = createAgentAnnotationConditional(...);
  
  // 2. Create StateGraph
  const workflow = new StateGraph({ state, input, output }, contextSchema);
  
  // 3. Add all nodes (agent, tools, middleware hooks)
  workflow.addNode(AGENT_NODE_NAME, agentNode);
  workflow.addNode(TOOLS_NODE_NAME, toolNode);
  // ... add middleware nodes
  
  // 4. Add edges
  workflow.addEdge(START, beforeAgentNodes[0]?.name ?? AGENT_NODE_NAME);
  // ... add all edges
  
  // 5. Compile graph (expensive!)
  this.#graph = workflow.compile({
    checkpointSaver: options.checkpointSaver,
    store: options.store,
  });
}
```

**Best Practice:**
```typescript
// ✅ Good: Create once at startup
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [tool1, tool2],
  checkpointSaver: new PostgresSaver(...),
});

// Use for all requests
app.post("/chat", async (req, res) => {
  const result = await agent.invoke(
    { messages: req.body.messages },
    { 
      configurable: { thread_id: req.body.threadId },
      context: { userId: req.user.id },
    }
  );
  res.json(result);
});

// ❌ Bad: Create per-request
app.post("/chat", async (req, res) => {
  const agent = createAgent({ /* ... */ }); // Expensive!
  const result = await agent.invoke(...);
  res.json(result);
});
```

### 4.2 Performance Implications

From `libs/langchain/src/agents/tests/agent.bench.test.ts`:

**Benchmark results** (simple tool calling agent):
- Expected latency: ≤ 60ms per invocation
- Agent with 10 tools: ≤ 60ms per invocation
- Agent with 50 tools: Still reasonable performance

**Key findings:**
- Agent invocation is fast (no graph compilation)
- Tool count doesn't significantly impact performance
- Middleware adds minimal overhead per invocation

### 4.3 Graph Caching Mechanisms

**No built-in graph caching beyond compilation.**

The compiled graph is stored in the `ReactAgent` instance:
```typescript
class ReactAgent<...> {
  #graph: CompiledStateGraph<...>; // Compiled once
  
  async invoke(state, config?) {
    return this.#graph.invoke(state, config); // Reused
  }
}
```

**Recommendation:** 
- Keep agent instances alive (singleton pattern)
- Don't recreate agents unless configuration changes
- Use middleware for dynamic behavior instead of recreating agents

### 4.4 Dynamic Agent Configuration

**Question:** How to handle different configurations per request?

**Answer:** Use middleware with context, not multiple agent instances.

```typescript
// ✅ Good: One agent with dynamic middleware
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: allTools,
  middleware: [
    createMiddleware({
      name: "dynamic",
      contextSchema: z.object({
        modelPreference: z.string().optional(),
        toolFilter: z.array(z.string()).optional(),
      }),
      wrapModelCall: (request, handler) => {
        const { modelPreference, toolFilter } = request.runtime.context;
        
        // Dynamic model
        const model = modelPreference
          ? new ChatOpenAI({ model: modelPreference })
          : request.model;
        
        // Dynamic tools
        const tools = toolFilter
          ? request.tools.filter(t => toolFilter.includes(t.name))
          : request.tools;
        
        return handler({ ...request, model, tools });
      },
    }),
  ],
});

// Different configurations per request
await agent.invoke({ messages: [...] }, {
  context: { modelPreference: "gpt-4o-mini", toolFilter: ["tool1"] },
});

await agent.invoke({ messages: [...] }, {
  context: { modelPreference: "gpt-4o", toolFilter: ["tool1", "tool2"] },
});

// ❌ Bad: Multiple agents
const agent1 = createAgent({ model: "gpt-4o-mini", tools: [tool1] });
const agent2 = createAgent({ model: "gpt-4o", tools: [tool1, tool2] });
```

---

## 5. Dynamic Injection Examples

### 5.1 Dynamic Model Injection

**Example 1: Simple Runtime Selection**

From `examples/src/createAgent/updateModelBeforeCall.ts`:

```typescript
const agent = createAgent({
  model: "openai:gpt-4o-mini",
  tools: [],
  middleware: [
    createMiddleware({
      name: "dynamicModelSelection",
      contextSchema: z.object({
        model: z.enum(["gpt-4o", "gpt-4o-mini"]).optional(),
      }),
      wrapModelCall: (request, handler) => {
        // Use context model if provided
        if (request.runtime.context?.model) {
          return handler({
            ...request,
            model: new ChatOpenAI({ model: request.runtime.context.model }),
          });
        }

        // Or infer from message content
        const last = request.messages[request.state.messages.length - 1];
        const content = typeof last.content === "string" ? last.content : "";
        const isComplex = /algorithm|architecture|optimize|system design/.test(
          content.toLowerCase()
        );
        const modelId = isComplex ? "gpt-4o" : "gpt-4o-mini";
        
        return handler({
          ...request,
          model: new ChatOpenAI({ model: modelId }),
        });
      },
    }),
  ],
});
```

**Example 2: Model Fallback**

From `libs/langchain/src/agents/middleware/modelFallback.ts`:

```typescript
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [],
  middleware: [
    createMiddleware({
      name: "modelFallback",
      wrapModelCall: async (request, handler) => {
        try {
          return await handler(request);
        } catch (error) {
          // Fallback to alternative model
          console.warn("Primary model failed, using fallback");
          return handler({
            ...request,
            model: new ChatOpenAI({ model: "gpt-4o-mini" }),
          });
        }
      },
    }),
  ],
});
```

### 5.2 Dynamic Tool Injection

**Example 1: Context-Based Tool Filtering**

From `examples/src/createAgent/dynamicTools/simple.ts`:

```typescript
const allTools = [githubCreateIssue, gitlabCreateIssue];

const agent = createAgent({
  model: "openai:gpt-4o",
  tools: allTools, // Register all
  middleware: [
    createMiddleware({
      name: "VcsToolGate",
      contextSchema: z.object({ vcsProvider: z.string() }),
      wrapModelCall: (request, handler) => {
        const provider = request.runtime.context.vcsProvider.toLowerCase();
        const tools = provider === "gitlab" 
          ? [gitlabCreateIssue] 
          : [githubCreateIssue];
        return handler({ ...request, tools });
      },
    }),
  ],
});

// Use different tools per invocation
await agent.invoke({ messages: [...] }, {
  context: { vcsProvider: "github" },
});

await agent.invoke({ messages: [...] }, {
  context: { vcsProvider: "gitlab" },
});
```

**Example 2: Semantic Tool Selection**

From `examples/src/createAgent/dynamicTools/advanced.ts`:

```typescript
// Use embeddings to select most relevant tools
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: fullCatalog, // All tools for validation
  middleware: [
    createMiddleware({
      name: "SelectToolsMiddleware",
      wrapModelCall: async (request, handler) => {
        const last = request.messages.at(-1);
        const tools = last?.content
          ? await selectTopKBySimilarity(last.content as string, 3)
          : fullCatalog.slice(0, 5);
        return handler({ ...request, tools });
      },
    }),
  ],
});
```

**Example 3: Stateful Tool Availability**

From `examples/src/createAgent/updateToolsBeforeModelCall.ts`:

```typescript
// Change available tools based on conversation state
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [listFilesTool, readFileTool],
  middleware: [
    createMiddleware({
      name: "updateToolAvailability",
      stateSchema: z.object({
        callCount: z.number().default(0),
      }),
      beforeModel: (state) => {
        const callCount = state.callCount + 1;
        
        // Turn 1: only list_files
        // Turns 2-3: list_files + read_file
        // Turn 4+: only list_files again
        
        let guidance: string;
        if (callCount === 1) {
          guidance = "Only list_files is enabled.";
        } else if (callCount <= 3) {
          guidance = "Both list_files and read_file are enabled.";
        } else {
          guidance = "Only list_files is enabled.";
        }
        
        return {
          callCount,
          messages: [
            { role: "system", content: guidance },
            ...state.messages,
          ],
        };
      },
    }),
  ],
});
```

### 5.3 Multi-Tenant Patterns

**Example: Complete Multi-Tenant Setup**

```typescript
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [
    salesforceTool,
    slackTool,
    githubTool,
    internalDbTool,
  ],
  middleware: [
    createMiddleware({
      name: "tenantAuth",
      contextSchema: z.object({
        tenantId: z.string(),
        permissions: z.array(z.string()),
        modelTier: z.enum(["basic", "premium"]),
      }),
      wrapModelCall: (request, handler) => {
        const { modelTier, permissions } = request.runtime.context;
        
        // Choose model based on tier
        const model = modelTier === "premium"
          ? new ChatOpenAI({ model: "gpt-4o" })
          : new ChatOpenAI({ model: "gpt-4o-mini" });
        
        // Filter tools by permissions
        const tools = request.tools.filter(t =>
          permissions.includes(t.name)
        );
        
        return handler({ ...request, model, tools });
      },
      wrapToolCall: (request, handler) => {
        // Add tenant context to tool calls
        const modifiedArgs = {
          ...request.toolCall.args,
          tenantId: request.runtime.context.tenantId,
        };
        
        return handler({
          ...request,
          toolCall: { ...request.toolCall, args: modifiedArgs },
        });
      },
    }),
  ],
  checkpointSaver: new PostgresSaver(...), // Thread isolation
});

// Per-tenant invocation
async function handleTenantRequest(tenantId: string, messages: BaseMessage[]) {
  const tenant = await getTenantConfig(tenantId);
  
  return agent.invoke(
    { messages },
    {
      context: {
        tenantId,
        permissions: tenant.permissions,
        modelTier: tenant.modelTier,
      },
      configurable: {
        thread_id: `${tenantId}-${threadId}`, // Tenant-scoped thread
      },
    }
  );
}
```

---

## 6. Recent Changes and Proposals

### 6.1 LangChain v1.0 Release (Major)

**Released:** December 2024

**Key Changes:**
1. **`createAgent` introduced** as the new standard (replacing `createReactAgent` from LangGraph)
2. **Middleware-first design** - Highly composable and customizable
3. **Built on LangGraph** - Persistence, streaming, HITL out of the box
4. **Improved structured output** - No additional LLM calls needed

### 6.2 Recent Middleware Additions

From `libs/langchain/CHANGELOG.md`:

- **v1.1.5** (Recent):
  - `modelRetryMiddleware` - Automatic retry on model failures
  - `SystemMessage` support for `systemPrompt` - Advanced cache control
  - OpenAI content moderation middleware

- **v1.0.5**:
  - Improvements to `toolEmulator` middleware
  - `profile.maxInputTokens` support in summarization middleware
  - Context editing alignment with summarization interface

- **v1.0.3**:
  - Model strings in summarization middleware
  - Better state schema typing
  - Tool runtime support

### 6.3 Active Development Areas

Based on recent commits and issues:

1. **Model Configuration:**
   - No "model factory" pattern yet
   - Current approach: Use middleware `wrapModelCall` for dynamic selection
   - Proposal: Could add first-class model factory support

2. **Tool Configuration:**
   - No "tool factory" pattern yet
   - Current approach: Use middleware `wrapModelCall` to filter/select tools
   - Works well for most use cases

3. **Context Schema:**
   - Read-only by design (enforced at runtime)
   - Recent improvements to type safety
   - Optional and default context schemas now properly handled

4. **Performance:**
   - Benchmark tests added (v1.0+)
   - Target: ≤60ms per invocation
   - No caching beyond compiled graph

### 6.4 Known Limitations

From code analysis:

1. **No runtime graph recompilation** - By design (performance)
2. **Model/tool changes require middleware** - No first-class factory pattern
3. **Context is read-only** - Cannot be modified during execution
4. **No built-in graph caching** - Use singleton pattern instead

### 6.5 Community Patterns

From examples and tests:

1. **Dynamic model selection** - Common pattern via `wrapModelCall`
2. **Tool gating** - Common pattern for multi-tenant/permissions
3. **Semantic tool selection** - Emerging pattern with embeddings
4. **State-based tool availability** - Time-based or count-based gating

---

## 7. Key Findings Summary

### 7.1 createAgent Function

- **Location:** `libs/langchain/src/agents/index.ts`
- **Returns:** `ReactAgent` instance with `invoke` and `stream` methods
- **Core Parameters:** `model`, `tools`, `systemPrompt`, `middleware`, `responseFormat`, `stateSchema`, `contextSchema`
- **Compilation:** Graph compiled once at creation time (not per-request)

### 7.2 Middleware Capabilities

**Yes, middleware can:**
- ✅ Modify the model at runtime (via `wrapModelCall`)
- ✅ Add/filter tools at runtime (via `wrapModelCall`)
- ✅ Intercept and modify tool calls (via `wrapToolCall`)
- ✅ Access and modify state at any hook
- ✅ Implement fallbacks, retries, caching, auth, monitoring

**Available hooks:**
- `beforeAgent` - Once at start
- `beforeModel` - Before each model call
- `wrapModelCall` - Wrap model invocation (can modify model/tools)
- `afterModel` - After model call (can modify tool calls)
- `wrapToolCall` - Wrap each tool execution
- `afterAgent` - Once at end

### 7.3 Runtime Configuration

**Context (read-only, per-request):**
- Pass via `context` parameter in `invoke`/`stream`
- Defined via `contextSchema` in middleware
- Use for: user ID, permissions, preferences, model selection

**State (persisted, mutable):**
- Defined via `stateSchema` in middleware or agent
- Stored in checkpointer
- Use for: conversation history, counters, long-term data

**Configurable (LangGraph):**
- `thread_id` - Thread isolation
- `checkpoint_ns` - Checkpoint namespace
- Other LangGraph options

### 7.4 Graph Creation Patterns

**Recommendation:** **Singleton pattern**
- Create agent once at startup
- Reuse for all requests
- Use middleware + context for dynamic behavior
- Don't recreate agents per-request (expensive)

**Performance:**
- Graph compilation: One-time cost at creation
- Invocation: Fast (≤60ms target)
- No caching needed beyond singleton

### 7.5 Dynamic Model/Tool Injection

**Model Injection:**
- Use middleware `wrapModelCall` hook
- Pass model preference via `context`
- Examples: model routing, fallback, tenant-based selection

**Tool Injection:**
- Use middleware `wrapModelCall` hook to filter tools
- Pass tool preferences/permissions via `context`
- Examples: permission-based filtering, semantic selection, state-based availability

**Multi-Tenant:**
- One agent instance
- Use context for tenant ID, permissions, tier
- Use configurable for thread isolation
- Filter model/tools per tenant in middleware

### 7.6 No Built-in Factories

**Current state:**
- No first-class model factory
- No first-class tool factory
- **Workaround:** Use middleware (works well)

**Proposal (community):**
- Could add `modelFactory?: (context) => LanguageModelLike` parameter
- Could add `toolsFactory?: (context) => Tool[]` parameter
- **Not needed** - middleware pattern is flexible and sufficient

---

## 8. Code References

### Key Files

1. **Agent Creation:**
   - `libs/langchain/src/agents/index.ts` - `createAgent` export
   - `libs/langchain/src/agents/ReactAgent.ts` - Implementation

2. **Types:**
   - `libs/langchain/src/agents/types.ts` - `CreateAgentParams`, `UserInput`, etc.
   - `libs/langchain/src/agents/middleware/types.ts` - Middleware interfaces and hooks

3. **Middleware:**
   - `libs/langchain/src/agents/middleware.ts` - `createMiddleware` helper
   - `libs/langchain/src/agents/middleware/` - Built-in middleware implementations

4. **Runtime:**
   - `libs/langchain/src/agents/runtime.ts` - Runtime types
   - `libs/langchain/src/agents/state.ts` - State management

5. **Examples:**
   - `examples/src/createAgent/updateModelBeforeCall.ts` - Dynamic model selection
   - `examples/src/createAgent/updateToolsBeforeModelCall.ts` - Dynamic tool availability
   - `examples/src/createAgent/dynamicTools/` - Advanced tool patterns

6. **Tests:**
   - `libs/langchain/src/agents/tests/middleware.test.ts` - Middleware behavior tests
   - `libs/langchain/src/agents/tests/runtime.test.ts` - Runtime configuration tests
   - `libs/langchain/src/agents/tests/agent.bench.test.ts` - Performance benchmarks

---

## 9. Recommendations

### For Application Developers

1. **Use singleton pattern** for agent creation
2. **Use middleware** for dynamic behavior instead of creating multiple agents
3. **Use context** for per-request data (user ID, permissions, preferences)
4. **Use state** for persistent data (conversation history, counters)
5. **Use `wrapModelCall`** for dynamic model/tool selection

### For Framework Contributors

1. **Consider adding** first-class factory parameters (optional, for convenience)
2. **Document** singleton pattern more prominently
3. **Add more examples** of multi-tenant patterns
4. **Consider** middleware composition helpers (e.g., `combineMiddleware`)

### For Multi-Tenant Applications

1. **One agent instance** per application
2. **Tenant isolation** via:
   - `context.tenantId` for tenant identification
   - `configurable.thread_id` for thread isolation (e.g., `${tenantId}-${threadId}`)
   - Middleware filtering for model/tool access control
3. **Performance:** No per-tenant overhead with this pattern

---

## Conclusion

The `createAgent` API in LangChain v1.0+ provides a powerful, middleware-driven approach to building production-ready agents. While there are no built-in model or tool factories, the middleware pattern with `wrapModelCall` provides equivalent functionality with more flexibility. The singleton pattern for agent instances combined with context-based runtime configuration enables efficient multi-tenant and dynamic agent applications.

The key insight is: **Create agents once, configure behavior at runtime via middleware and context.**

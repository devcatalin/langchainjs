# Multi-Tenant Tool Injection Patterns in LangChain Agents

## Executive Summary

This document provides a comprehensive analysis of dynamic tool injection patterns in LangChain's `createAgent` API, specifically addressing multi-tenant scenarios where different users/requests require different tool sets.

## Key Findings

### 1. Can `wrapModelCall` middleware add NEW tools?

**Answer: No, middleware cannot add tools with names that weren't in the original `createAgent({ tools })` list.**

The validation logic in `AgentNode.ts` (lines 459-473) checks:

```typescript
const newTools = modifiedTools.filter(
  (tool) =>
    isClientTool(tool) &&
    !this.#options.toolClasses.some((t) => t.name === tool.name)
);
if (newTools.length > 0) {
  throw new Error(
    `You have added a new tool in "wrapModelCall" hook of middleware "${
      currentMiddleware.name
    }": ${newTools.map((tool) => tool.name).join(", ")}. This is not supported.`
  );
}
```

**Key insight:** The check is **by tool name** (not instance). This means:
- ✅ You can filter/subset existing tools
- ✅ Tools with the same name as those in the original list are allowed
- ❌ You cannot add tools with completely new names

The subsequent check (lines 479-492) validates that tool instances match:

```typescript
const invalidTools = modifiedTools.filter(
  (tool) =>
    isClientTool(tool) &&
    this.#options.toolClasses.every((t) => t !== tool)
);
if (invalidTools.length > 0) {
  throw new Error(
    `You have modified a tool in "wrapModelCall" hook of middleware "${
      currentMiddleware.name
    }": ${invalidTools.map((tool) => tool.name).join(", ")}. This is not supported.`
  );
}
```

This ensures middleware cannot replace a tool with a different implementation having the same name.

### 2. Recommended Pattern for Multi-Tenant Tool Injection

**Pattern 1: Superset Approach (Recommended)**

Define all possible tools at agent creation time, then filter them per request:

```typescript
import { createAgent, createMiddleware } from "langchain";

// Define all possible tools upfront
const githubTools = [githubCreateIssue, githubListRepos];
const gitlabTools = [gitlabCreateIssue, gitlabListProjects];
const allTools = [...githubTools, ...gitlabTools];

// Create middleware to filter based on context
const tenantToolFilter = createMiddleware({
  name: "TenantToolFilter",
  contextSchema: z.object({ 
    provider: z.enum(["github", "gitlab"]) 
  }),
  wrapModelCall: (request, handler) => {
    const { provider } = request.runtime.context;
    
    // Filter to only relevant tools
    const tools = request.tools?.filter(tool => {
      if (provider === "github") {
        return tool.name.startsWith("github_");
      }
      return tool.name.startsWith("gitlab_");
    });
    
    return handler({ ...request, tools });
  },
});

// Create agent with ALL possible tools
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: allTools, // Complete superset
  middleware: [tenantToolFilter],
});

// Invoke with tenant context
const result = await agent.invoke(
  { messages: [userMessage] },
  { context: { provider: "github" } }
);
```

**Pattern 2: Dynamic Agent Creation (Alternative)**

If tools truly cannot be known at startup, create agents per request:

```typescript
// Tool registry
class ToolRegistry {
  async getToolsForTenant(tenantId: string) {
    // Load tenant-specific tools (e.g., MCP tools)
    return await loadMCPToolsForTenant(tenantId);
  }
}

// Request handler
async function handleRequest(tenantId: string, message: string) {
  const tools = await toolRegistry.getToolsForTenant(tenantId);
  
  // Create agent per request
  const agent = createAgent({
    model: "openai:gpt-4o",
    tools,
  });
  
  return agent.invoke({ messages: [message] });
}
```

**Trade-offs:**

| Approach | Pros | Cons |
|----------|------|------|
| Superset + Filtering | • Single agent instance<br>• Fast per-request overhead<br>• Consistent behavior | • All tools must be known upfront<br>• Higher memory if many tools |
| Dynamic Agent Creation | • True runtime flexibility<br>• Each tenant isolated<br>• Unlimited tool variety | • Agent creation overhead per request<br>• Cannot reuse stateful components |

### 3. Is the Singleton Agent Pattern Supported?

**Answer: Yes, but with limitations.**

✅ **Supported scenarios:**
- Single agent instance invoked multiple times
- Different tool subsets per invocation (via middleware filtering)
- Same tools with different configurations (via context)

❌ **Not supported:**
- Adding completely new tool names after agent creation
- Dynamically loading unknown tools per request
- Modifying tool implementations at runtime

**Example of supported singleton pattern:**

```typescript
// Create once
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [allPossibleTools],
  middleware: [filterMiddleware],
});

// Reuse many times with different contexts
await agent.invoke(state1, { context: { tenant: "A" } });
await agent.invoke(state2, { context: { tenant: "B" } });
await agent.invoke(state3, { context: { tenant: "C" } });
```

### 4. How Does `llmToolSelectorMiddleware` Work?

The `llmToolSelectorMiddleware` **filters** existing tools, it does not add new ones.

From `llmToolSelector.ts`:

```typescript
wrapModelCall: async (request, handler) => {
  // ... selection logic using LLM ...
  
  // Filter to only selected tools
  const selectedTools = availableTools.filter((tool) =>
    selectedToolNames.includes(tool.name)
  );
  
  // Return filtered list (subset of original)
  return handler({
    ...request,
    tools: [...selectedTools, ...alwaysIncludedTools],
  });
}
```

**Why it doesn't trigger validation errors:**
1. It only returns tools that were in `request.tools` originally
2. All returned tools exist in `this.#options.toolClasses`
3. The name check passes: each tool's name is in the original set
4. The instance check passes: each tool instance is unchanged

### 5. Relationship Between `createAgent` Tools and `wrapModelCall` Tools

**Two-tier tool system:**

```
┌─────────────────────────────────────────────┐
│  createAgent({ tools: [...] })              │
│  ↓                                           │
│  this.#options.toolClasses (immutable)      │
│  - Defines the UNIVERSE of possible tools   │
│  - Used by ToolNode for execution           │
│  - Validation baseline                      │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  wrapModelCall(request, handler)            │
│  ↓                                           │
│  request.tools (mutable)                    │
│  - Subset for THIS model call only          │
│  - Only affects LLM prompt                  │
│  - Must be subset of toolClasses            │
└─────────────────────────────────────────────┘
```

**Key principles:**

1. **ToolNode uses original tools**: The ToolNode always uses `this.#options.toolClasses` for execution, not `request.tools`

2. **Middleware affects LLM prompt only**: Modifying `request.tools` in middleware only changes which tools appear in the LLM's system prompt/tool definitions

3. **Validation enforces subset relationship**: The validation ensures `request.tools ⊆ toolClasses`

**Code evidence from `AgentNode.ts` (lines 821-824):**

```typescript
const allTools = [
  ...(preparedOptions?.tools ?? this.#options.toolClasses),
  ...structuredTools.map((toolStrategy) => toolStrategy.tool),
];
```

The middleware-modified tools (`preparedOptions?.tools`) are used for binding to the model, while `this.#options.toolClasses` is the fallback and is what ToolNode uses.

## Complete Multi-Tenant Example

Here's a full example demonstrating the recommended pattern:

```typescript
import { createAgent, createMiddleware, tool } from "langchain";
import { z } from "zod";

// Define all tenant tools upfront
const tenantATools = [
  tool(async () => "Tenant A data", {
    name: "get_tenant_a_data",
    description: "Get data for tenant A",
    schema: z.object({}),
  }),
];

const tenantBTools = [
  tool(async () => "Tenant B data", {
    name: "get_tenant_b_data",
    description: "Get data for tenant B",
    schema: z.object({}),
  }),
];

const sharedTools = [
  tool(async ({ query }) => `Search: ${query}`, {
    name: "search",
    description: "Search the database",
    schema: z.object({ query: z.string() }),
  }),
];

// Combine all possible tools
const allTools = [...tenantATools, ...tenantBTools, ...sharedTools];

// Multi-tenant middleware
const tenantMiddleware = createMiddleware({
  name: "TenantMiddleware",
  contextSchema: z.object({ 
    tenantId: z.string() 
  }),
  wrapModelCall: (request, handler) => {
    const { tenantId } = request.runtime.context;
    
    // Filter tools based on tenant
    const tools = request.tools?.filter(tool => {
      // Always include shared tools
      if (tool.name === "search") return true;
      
      // Include tenant-specific tools
      if (tenantId === "A") {
        return tool.name.includes("tenant_a");
      } else if (tenantId === "B") {
        return tool.name.includes("tenant_b");
      }
      
      return false;
    });
    
    return handler({ ...request, tools });
  },
});

// Create singleton agent
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: allTools,
  middleware: [tenantMiddleware],
});

// Use with different tenants
const resultA = await agent.invoke(
  { messages: [{ role: "user", content: "Get my data" }] },
  { context: { tenantId: "A" } }
);

const resultB = await agent.invoke(
  { messages: [{ role: "user", content: "Get my data" }] },
  { context: { tenantId: "B" } }
);
```

## MCP Tools Specific Guidance

For MCP (Model Context Protocol) tools in multi-tenant scenarios:

```typescript
import { MCPClient } from "@langchain/mcp";

// Load all MCP servers at startup
const mcpClients = {
  "org-a": new MCPClient("org-a-server-url"),
  "org-b": new MCPClient("org-b-server-url"),
};

// Get all tools from all MCP servers
const allMCPTools = [];
for (const [org, client] of Object.entries(mcpClients)) {
  const tools = await client.getTools();
  // Prefix tool names with org for filtering
  allMCPTools.push(
    ...tools.map(tool => ({
      ...tool,
      name: `${org}_${tool.name}`,
    }))
  );
}

// Create agent with all MCP tools
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: allMCPTools,
  middleware: [
    createMiddleware({
      name: "MCPOrgFilter",
      contextSchema: z.object({ org: z.string() }),
      wrapModelCall: (request, handler) => {
        const { org } = request.runtime.context;
        const tools = request.tools?.filter(
          t => t.name.startsWith(`${org}_`)
        );
        return handler({ ...request, tools });
      },
    }),
  ],
});
```

## Version Considerations

- **Current behavior** (as of this analysis): Tool validation enforces strict subset relationship
- **No version-specific changes detected**: This pattern has been consistent across recent versions
- **Future considerations**: If true dynamic tool loading is needed, consider feature request to LangChain team

## Recommendations

1. **For predictable tool sets**: Use superset approach with middleware filtering
2. **For unpredictable tool sets**: Use per-request agent creation
3. **For MCP tools**: Load all servers at startup, filter per request
4. **For scaling**: Consider agent pooling if creation overhead is significant
5. **For security**: Use middleware context to enforce tenant isolation

## Common Pitfalls

❌ **Don't do this:**
```typescript
// This will fail - adding new tool names
wrapModelCall: (request, handler) => {
  const newTool = tool(...); // New tool not in original list
  return handler({ 
    ...request, 
    tools: [...request.tools, newTool] // ERROR!
  });
}
```

✅ **Do this instead:**
```typescript
// Pre-define all tools, filter per request
const agent = createAgent({
  tools: [allPossibleTools],
  middleware: [filterMiddleware],
});
```

## Conclusion

The LangChain agent architecture is designed for **filtering and configuration** of a pre-defined tool set, not **dynamic tool discovery** at runtime. For multi-tenant scenarios:

- **Best practice**: Define complete tool superset at agent creation, use middleware to filter per tenant
- **Alternative**: Create agents per request if tools are truly unpredictable
- **Key constraint**: Middleware cannot add tools with new names after agent creation

This design ensures type safety, consistent behavior, and predictable tool execution across the agent's lifecycle.

# Tool Injection Architecture Diagram

## Tool Validation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Startup                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  createAgent({                                               │
│    tools: [allPossibleTools],  ◄─── DEFINES UNIVERSE        │
│    middleware: [filterMiddleware]                            │
│  })                                                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  AgentNode Constructor                                       │
│  this.#options.toolClasses = [allPossibleTools]             │
│  ↑                                                           │
│  └─── IMMUTABLE - Used for validation & execution           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Per-Request Flow                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  agent.invoke(state, { context: { tenantId } })             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  wrapModelCall Middleware                                    │
│  ┌─────────────────────────────────────────────┐            │
│  │ request.tools = filter(allTools, tenantId)  │            │
│  │                                             │            │
│  │ ALLOWED:                                    │            │
│  │ ✓ Filter tools                              │            │
│  │ ✓ Reorder tools                             │            │
│  │ ✓ Return subset                             │            │
│  │                                             │            │
│  │ NOT ALLOWED:                                │            │
│  │ ✗ Add new tool names                        │            │
│  │ ✗ Modify tool instances                     │            │
│  │ ✗ Replace implementations                   │            │
│  └─────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Validation (AgentNode.ts:459-492)                          │
│                                                              │
│  Check 1: New tool names?                                   │
│  ┌────────────────────────────────────────────┐             │
│  │ newTools = request.tools.filter(tool =>   │             │
│  │   !toolClasses.some(t => t.name === tool.name)         │
│  │ )                                          │             │
│  │ if (newTools.length > 0) → ERROR          │             │
│  └────────────────────────────────────────────┘             │
│                                                              │
│  Check 2: Modified instances?                               │
│  ┌────────────────────────────────────────────┐             │
│  │ invalidTools = request.tools.filter(tool =>│             │
│  │   toolClasses.every(t => t !== tool)      │             │
│  │ )                                          │             │
│  │ if (invalidTools.length > 0) → ERROR      │             │
│  └────────────────────────────────────────────┘             │
│                                                              │
│  ✓ Validation passed                                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  LLM Invocation                                              │
│  ┌────────────────────────────────────────────┐             │
│  │ bindTools(model, request.tools)           │             │
│  │   ↑                                        │             │
│  │   └─── Filtered tools in prompt           │             │
│  └────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Tool Execution (ToolNode)                                   │
│  ┌────────────────────────────────────────────┐             │
│  │ Uses: this.#options.toolClasses           │             │
│  │   ↑                                        │             │
│  │   └─── Original tools, NOT filtered       │             │
│  └────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

## Two-Tier Tool System

```
┌──────────────────────────────────────────────────────────────┐
│                         TIER 1                                │
│                   Tool Universe Layer                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ createAgent({ tools })                                 │  │
│  │ ↓                                                      │  │
│  │ this.#options.toolClasses                             │  │
│  │                                                        │  │
│  │ Purpose:                                               │  │
│  │ • Define ALL possible tools                            │  │
│  │ • Used by ToolNode for execution                       │  │
│  │ • Validation baseline                                  │  │
│  │ • Immutable after creation                             │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                             │
                             │ Subset relationship
                             │ (enforced by validation)
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                         TIER 2                                │
│                   Prompt Filter Layer                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ wrapModelCall(request, handler)                        │  │
│  │ ↓                                                      │  │
│  │ request.tools                                          │  │
│  │                                                        │  │
│  │ Purpose:                                               │  │
│  │ • Subset for THIS invocation                           │  │
│  │ • Only affects LLM prompt                              │  │
│  │ • Can change per request                               │  │
│  │ • Must be subset of toolClasses                        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Multi-Tenant Filtering Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                      All Tools                               │
│  [GitHub Tools] + [GitLab Tools] + [Shared Tools]           │
│         │                │               │                   │
│         └────────────────┴───────────────┘                   │
│                          │                                   │
│                   createAgent({                              │
│                     tools: allTools                          │
│                   })                                         │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Tenant A   │    │  Tenant B   │    │  Tenant C   │
│  (GitHub)   │    │  (GitLab)   │    │  (Shared)   │
└─────────────┘    └─────────────┘    └─────────────┘
        │                   │                   │
        │                   │                   │
   Filter by          Filter by          Filter by
   context            context            context
        │                   │                   │
        ▼                   ▼                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ GitHub +    │    │ GitLab +    │    │ Shared      │
│ Shared      │    │ Shared      │    │ Only        │
└─────────────┘    └─────────────┘    └─────────────┘
```

## Middleware Pattern Implementation

```typescript
const tenantFilter = createMiddleware({
  name: "TenantFilter",
  contextSchema: z.object({ 
    tenantId: z.string() 
  }),
  
  wrapModelCall: (request, handler) => {
    // 1. Get tenant context
    const { tenantId } = request.runtime.context;
    
    // 2. Filter tools based on tenant
    //    ✓ This is ALLOWED - filtering subset
    const tools = request.tools?.filter(tool => 
      tool.name.includes(tenantId)
    );
    
    // 3. Pass filtered tools to handler
    //    ✓ Passes validation because:
    //      - All tool names exist in original
    //      - All tool instances unchanged
    return handler({ ...request, tools });
  }
});
```

## What Validation Prevents

```typescript
// ❌ FAILS - Adding new tool name
wrapModelCall: (request, handler) => {
  const newTool = tool(...); // Not in original list
  return handler({ 
    ...request, 
    tools: [...request.tools, newTool] // ERROR!
  });
}

// ❌ FAILS - Modifying tool instance
wrapModelCall: (request, handler) => {
  const modifiedTool = tool(...); // Same name, different impl
  return handler({ 
    ...request, 
    tools: [modifiedTool] // ERROR!
  });
}

// ✓ SUCCEEDS - Filtering
wrapModelCall: (request, handler) => {
  const filtered = request.tools?.slice(0, 2); // Subset
  return handler({ 
    ...request, 
    tools: filtered // OK!
  });
}

// ✓ SUCCEEDS - Reordering
wrapModelCall: (request, handler) => {
  const reordered = [...request.tools].reverse(); // Same tools
  return handler({ 
    ...request, 
    tools: reordered // OK!
  });
}
```

## Decision Tree: Which Pattern To Use?

```
Start: Need multi-tenant tool support
           │
           ▼
     ┌─────────────────┐
     │ Known at startup? │
     └─────────────────┘
           │
    ┌──────┴──────┐
    │             │
   YES           NO
    │             │
    ▼             ▼
┌────────────┐  ┌────────────────┐
│ Use        │  │ Per-Request    │
│ Superset + │  │ Agent Creation │
│ Filtering  │  │                │
│            │  │ Trade-offs:    │
│ Benefits:  │  │ + Flexible     │
│ + Fast     │  │ + Isolated     │
│ + Shared   │  │ - Slower       │
│ + Simple   │  │ - More memory  │
└────────────┘  └────────────────┘
```

## Security & Isolation

```
┌──────────────────────────────────────────────────────────────┐
│                   Security Boundaries                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Validation Layer                                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Prevents:                                              │  │
│  │ • Tool injection attacks                               │  │
│  │ • Unauthorized tool access                             │  │
│  │ • Tool implementation tampering                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Middleware Context                                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Enforces:                                              │  │
│  │ • Tenant-specific tool filtering                       │  │
│  │ • Permission-based access control                      │  │
│  │ • Audit logging per tenant                             │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

This architecture ensures:
- **Type Safety**: Tools are known at compile time
- **Security**: Validation prevents unauthorized tool access
- **Performance**: Single agent instance with fast filtering
- **Flexibility**: Context-based tool selection per request
- **Predictability**: Consistent tool execution behavior

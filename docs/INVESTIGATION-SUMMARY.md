# Multi-Tenant Tool Injection Investigation - Summary

## Investigation Completed

This document summarizes the investigation into multi-tenant tool injection patterns for LangChain's `createAgent` API.

## Questions Asked

The investigation addressed 5 specific questions about dynamic tool injection in multi-tenant scenarios:

1. **Can `wrapModelCall` middleware actually add NEW tools that weren't in the original `createAgent({ tools })` list?**
2. **What is the recommended pattern for multi-tenant tool injection?**
3. **Is the singleton agent pattern supported?**
4. **How does `llmToolSelectorMiddleware` work?**
5. **What is the relationship between `tools` passed to `createAgent()` and `tools` modified in `wrapModelCall`?**

## Answers Provided

### 1. Can middleware add new tools?

**No.** The validation logic in `AgentNode.ts` (lines 459-492) prevents this:

```typescript
// Check by name
const newTools = modifiedTools.filter(
  (tool) =>
    isClientTool(tool) &&
    !this.#options.toolClasses.some((t) => t.name === tool.name)
);
if (newTools.length > 0) {
  throw new Error(`You have added a new tool...`);
}

// Check by instance
const invalidTools = modifiedTools.filter(
  (tool) =>
    isClientTool(tool) &&
    this.#options.toolClasses.every((t) => t !== tool)
);
if (invalidTools.length > 0) {
  throw new Error(`You have modified a tool...`);
}
```

**Key insight:** Both the tool NAME and INSTANCE must match the original tools.

### 2. Recommended Pattern

**Superset Approach (Recommended):**
- Define all possible tools at `createAgent()`
- Use middleware to filter based on tenant context
- Reuse single agent instance

**Alternative: Per-Request Agent Creation:**
- Create agent instances per request
- Load tools dynamically
- Complete tenant isolation
- Higher overhead

See: `examples/src/createAgent/multiTenant/superset-filtering.ts`

### 3. Singleton Agent Pattern

**Yes, it is supported**, with these constraints:

✅ Supported:
- Single agent instance invoked multiple times
- Different tool subsets per invocation (via middleware filtering)
- Same tools with different configurations (via context)

❌ Not supported:
- Adding new tool names after agent creation
- Modifying tool implementations at runtime
- Truly unpredictable tool sets

### 4. How llmToolSelectorMiddleware Works

It **filters** existing tools, not adds new ones:

```typescript
wrapModelCall: async (request, handler) => {
  // ... selection logic using LLM ...
  
  // Filter to only selected tools (subset of original)
  const selectedTools = availableTools.filter((tool) =>
    selectedToolNames.includes(tool.name)
  );
  
  return handler({
    ...request,
    tools: [...selectedTools, ...alwaysIncludedTools],
  });
}
```

This passes validation because:
- All returned tools exist in `request.tools` originally
- Tool names are in the original set
- Tool instances are unchanged

### 5. Tools Relationship

**Two-tier system:**

```
createAgent({ tools: [...] })
  ↓
this.#options.toolClasses (immutable)
  - Defines universe of possible tools
  - Used by ToolNode for execution
  - Validation baseline
  
wrapModelCall(request, handler)
  ↓
request.tools (mutable)
  - Subset for THIS model call only
  - Only affects LLM prompt
  - Must be subset of toolClasses
```

**Key principles:**
1. ToolNode uses original tools for execution
2. Middleware affects LLM prompt only
3. Validation enforces subset relationship: `request.tools ⊆ toolClasses`

## Deliverables

### 1. Comprehensive Documentation
- **File:** `docs/multi-tenant-tool-injection-patterns.md`
- **Size:** 12,620 bytes
- **Content:**
  - Detailed answers to all 5 questions
  - Code examples and diagrams
  - Best practices and recommendations
  - Common pitfalls to avoid
  - MCP tools guidance

### 2. Working Examples
**Directory:** `examples/src/createAgent/multiTenant/`

- **superset-filtering.ts** (6,816 bytes)
  - Recommended pattern
  - GitHub vs GitLab tenant filtering
  - Demonstrates singleton agent with context-based filtering

- **per-request-agent.ts** (7,100 bytes)
  - Alternative dynamic pattern
  - Simulated tool registry
  - Per-tenant agent creation with caching

- **mcp-tools-example.ts** (7,924 bytes)
  - MCP server integration
  - Both startup and per-request patterns
  - Organization-specific tool loading

### 3. Test Suite
- **File:** `libs/langchain/src/agents/tests/multiTenantTools.test.ts`
- **Tests:** 5 passing tests
  - ✓ Tool filtering in wrapModelCall
  - ✓ Error when adding new tools
  - ✓ Error when modifying tool instances
  - ✓ Singleton pattern with different contexts
  - ✓ Empty tool filter

### 4. README
- **File:** `examples/src/createAgent/multiTenant/README.md`
- **Content:** Usage guide for all examples

## Code Quality

✅ **Code Review:** Passed with no issues  
✅ **Security Scan:** Not applicable (documentation/examples only)  
✅ **Tests:** All 5 tests passing  
✅ **Linting:** No issues detected

## Recommendations

### For Predictable Tool Sets
Use the **superset approach**:
```typescript
const agent = createAgent({
  tools: [allPossibleTools],
  middleware: [filterMiddleware],
});
```

### For Unpredictable Tool Sets
Use **per-request agent creation**:
```typescript
const tools = await loadToolsForTenant(tenantId);
const agent = createAgent({ tools });
```

### For MCP Tools
- Load all MCP servers at startup if possible
- Filter per request using middleware
- Cache MCP connections for performance

## Architecture Implications

The current design is optimized for:
- **Filtering and configuration** of pre-defined tool sets
- **Type safety** and predictable behavior
- **Performance** with singleton agents

It is NOT designed for:
- **True dynamic tool discovery** at runtime
- **Plugin systems** with unknown tools
- **Runtime tool replacement** with same names

For such use cases, per-request agent creation is the supported pattern.

## Version Notes

- Analyzed as of commit: `25eecef`
- LangChain version: `1.2.1`
- No version-specific changes detected in recent history
- Pattern has been consistent across recent versions

## Conclusion

The investigation successfully answered all 5 questions and provided:
- Clear understanding of tool validation logic
- Recommended patterns for multi-tenant scenarios
- Working examples demonstrating both approaches
- Test suite validating the patterns
- Comprehensive documentation for developers

The LangChain agent architecture supports multi-tenant scenarios through **filtering** of a pre-defined tool superset, not through dynamic tool addition at runtime. This design ensures type safety, predictable behavior, and consistent tool execution across the agent's lifecycle.

For scenarios requiring true dynamic tool loading, the alternative pattern of per-request agent creation is available, though it comes with performance trade-offs.

# Multi-Tenant Tool Injection Examples

This directory contains examples demonstrating how to handle multi-tenant scenarios where different users or organizations need access to different tool sets.

## Examples

### 1. `superset-filtering.ts` - Recommended Pattern
Demonstrates the superset approach where all possible tools are defined at agent creation, then filtered per request based on tenant context.

**Best for:**
- Predictable set of tools
- Low-latency requirements
- Shared agent instance across requests

### 2. `per-request-agent.ts` - Dynamic Pattern
Shows how to create agent instances per request when tools cannot be known at startup.

**Best for:**
- Truly dynamic tool sets (e.g., plugin systems)
- Complete isolation between tenants
- Tools loaded from external sources

### 3. `mcp-tools-example.ts` - MCP Integration
Demonstrates how to handle Model Context Protocol (MCP) tools in multi-tenant scenarios.

**Best for:**
- MCP server integration
- External tool loading
- Organization-specific tool sets

## Key Principles

1. **Middleware filters, doesn't add**: The `wrapModelCall` middleware can only filter existing tools, not add new ones with different names.

2. **Tools defined at creation**: All tools that might be used must be included in `createAgent({ tools })`.

3. **Context-based filtering**: Use runtime context to determine which tools are available for each request.

## Running the Examples

```bash
# Install dependencies
pnpm install

# Run individual examples
npx tsx examples/src/createAgent/multiTenant/superset-filtering.ts
npx tsx examples/src/createAgent/multiTenant/per-request-agent.ts
npx tsx examples/src/createAgent/multiTenant/mcp-tools-example.ts
```

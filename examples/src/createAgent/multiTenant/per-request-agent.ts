/**
 * Multi-Tenant Tool Injection: Per-Request Agent Pattern
 *
 * This example demonstrates the ALTERNATIVE approach when:
 * - Tools cannot be known at application startup
 * - Tools are loaded dynamically per tenant
 * - Complete isolation between tenants is required
 *
 * Trade-offs:
 * + True dynamic tool loading
 * + Complete tenant isolation
 * - Agent creation overhead per request
 * - Cannot share stateful components
 */

import { z } from "zod";
import { createAgent, tool, HumanMessage } from "langchain";

// ============================================================================
// Simulated Tool Registry
// ============================================================================

/**
 * Simulates a registry that loads tools dynamically per tenant.
 * In production, this might:
 * - Load MCP tools from tenant-specific servers
 * - Query a database for tenant configurations
 * - Load plugins from external sources
 */
class TenantToolRegistry {
  private toolCache: Map<string, any[]> = new Map();

  /**
   * Load tools for a specific tenant.
   * This simulates loading from an external source (database, API, etc.)
   */
  async loadToolsForTenant(tenantId: string) {
    // Check cache first
    if (this.toolCache.has(tenantId)) {
      console.log(`  ♻️  Using cached tools for tenant ${tenantId}`);
      return this.toolCache.get(tenantId)!;
    }

    console.log(`  📦 Loading tools for tenant ${tenantId}...`);

    // Simulate async loading (e.g., from database or external service)
    await new Promise((resolve) => setTimeout(resolve, 100));

    let tools;
    if (tenantId === "acme-corp") {
      tools = [
        tool(
          async ({ query }) => {
            return `ACME Corp CRM results for: ${query}`;
          },
          {
            name: "search_acme_crm",
            description: "Search ACME Corp CRM system",
            schema: z.object({
              query: z.string(),
            }),
          }
        ),
        tool(
          async ({ leadId }) => {
            return JSON.stringify({
              id: leadId,
              name: "John Doe",
              status: "qualified",
            });
          },
          {
            name: "get_acme_lead",
            description: "Get lead details from ACME CRM",
            schema: z.object({
              leadId: z.string(),
            }),
          }
        ),
      ];
    } else if (tenantId === "globex-inc") {
      tools = [
        tool(
          async ({ orderId }) => {
            return JSON.stringify({
              orderId,
              status: "shipped",
              trackingNumber: "GLOB-123456",
            });
          },
          {
            name: "track_globex_order",
            description: "Track order status in Globex system",
            schema: z.object({
              orderId: z.string(),
            }),
          }
        ),
        tool(
          async () => {
            return JSON.stringify({
              totalOrders: 1247,
              pendingOrders: 23,
            });
          },
          {
            name: "get_globex_stats",
            description: "Get Globex order statistics",
            schema: z.object({}),
          }
        ),
      ];
    } else {
      // Default tools for unknown tenants
      tools = [
        tool(
          async () => {
            return "General help information";
          },
          {
            name: "get_help",
            description: "Get general help",
            schema: z.object({}),
          }
        ),
      ];
    }

    // Cache for future requests
    this.toolCache.set(tenantId, tools);
    console.log(
      `  ✓ Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`
    );

    return tools;
  }

  /**
   * Clear cache (useful for updates)
   */
  invalidateCache(tenantId: string) {
    this.toolCache.delete(tenantId);
  }
}

// ============================================================================
// Request Handler
// ============================================================================

const toolRegistry = new TenantToolRegistry();

/**
 * Handle a request by creating a fresh agent with tenant-specific tools
 */
async function handleTenantRequest(tenantId: string, message: string) {
  console.log(`\n📍 Processing request for tenant: ${tenantId}`);

  // Load tenant-specific tools
  const tools = await toolRegistry.loadToolsForTenant(tenantId);

  // Create agent with tenant-specific tools
  console.log(`  🤖 Creating agent for tenant ${tenantId}`);
  const agent = createAgent({
    model: "openai:gpt-4o",
    tools,
    systemPrompt: `You are a helpful assistant for ${tenantId}. Use the available tools to help the user.`,
  });

  // Invoke the agent
  const result = await agent.invoke({
    messages: [new HumanMessage(message)],
  });

  return result;
}

// ============================================================================
// Usage Examples
// ============================================================================

console.log("=== Multi-Tenant Tool Injection: Per-Request Agent ===\n");

// Request 1: ACME Corp tenant
console.log("📧 Request 1: ACME Corp user");
const result1 = await handleTenantRequest(
  "acme-corp",
  "Search our CRM for contacts named Smith"
);
console.log("✅ Response:", result1.messages.at(-1)?.content);

// Request 2: Globex Inc tenant
console.log("\n📧 Request 2: Globex Inc user");
const result2 = await handleTenantRequest(
  "globex-inc",
  "What's the status of order 12345?"
);
console.log("✅ Response:", result2.messages.at(-1)?.content);

// Request 3: Unknown tenant (gets default tools)
console.log("\n📧 Request 3: Unknown tenant");
const result3 = await handleTenantRequest("unknown-tenant", "I need help");
console.log("✅ Response:", result3.messages.at(-1)?.content);

// Request 4: ACME Corp again (should use cached tools)
console.log("\n📧 Request 4: ACME Corp user (cached)");
const result4 = await handleTenantRequest(
  "acme-corp",
  "Get details for lead 789"
);
console.log("✅ Response:", result4.messages.at(-1)?.content);

// ============================================================================
// Key Takeaways
// ============================================================================

console.log("\n" + "=".repeat(60));
console.log("KEY TAKEAWAYS:");
console.log("=".repeat(60));
console.log("1. ✓ Tools loaded dynamically per tenant");
console.log("2. ✓ Each tenant gets a fresh agent instance");
console.log("3. ✓ Complete isolation between tenants");
console.log("4. ✓ Suitable for plugin systems or MCP tools");
console.log("5. ⚠ Agent creation overhead per request");
console.log("6. ⚠ Cannot reuse stateful components across requests");
console.log("=".repeat(60));
console.log("\nWHEN TO USE THIS PATTERN:");
console.log("- Tools are loaded from external sources (MCP, plugins)");
console.log("- Tool set varies significantly per tenant");
console.log("- Complete tenant isolation is required");
console.log("- Agent creation overhead is acceptable");
console.log("=".repeat(60));

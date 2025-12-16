/**
 * Multi-Tenant Tool Injection: MCP Tools Example
 *
 * This example demonstrates how to handle Model Context Protocol (MCP) tools
 * in a multi-tenant scenario. MCP tools are external tools loaded from MCP servers.
 *
 * Two approaches are shown:
 * 1. Load all MCP servers at startup (superset approach)
 * 2. Load MCP servers per request (dynamic approach)
 */

import { z } from "zod";
import { createAgent, createMiddleware, tool, HumanMessage } from "langchain";

// ============================================================================
// Simulated MCP Client
// ============================================================================

/**
 * Simulates an MCP client that loads tools from an MCP server.
 * In production, you would use actual MCP client libraries like:
 * - @langchain/mcp
 * - @anthropic/mcp-client
 */
class MockMCPClient {
  constructor(
    private serverUrl: string,
    private orgId: string
  ) {}

  /**
   * Load tools from the MCP server
   */
  async getTools() {
    console.log(`  📡 Connecting to MCP server: ${this.serverUrl}`);
    await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate network

    // Simulate different tools per organization
    if (this.orgId === "org-github") {
      return [
        tool(
          async ({ repo }) => {
            return JSON.stringify({
              stars: 1234,
              forks: 567,
              openIssues: 89,
            });
          },
          {
            name: `mcp_${this.orgId}_get_repo_stats`,
            description: `Get repository statistics for ${this.orgId}`,
            schema: z.object({
              repo: z.string(),
            }),
          }
        ),
        tool(
          async ({ username }) => {
            return JSON.stringify({
              name: username,
              repos: 42,
              followers: 100,
            });
          },
          {
            name: `mcp_${this.orgId}_get_user_info`,
            description: `Get user information for ${this.orgId}`,
            schema: z.object({
              username: z.string(),
            }),
          }
        ),
      ];
    } else if (this.orgId === "org-gitlab") {
      return [
        tool(
          async ({ projectId }) => {
            return JSON.stringify({
              pipelines: 234,
              successRate: 0.95,
            });
          },
          {
            name: `mcp_${this.orgId}_get_ci_stats`,
            description: `Get CI/CD statistics for ${this.orgId}`,
            schema: z.object({
              projectId: z.string(),
            }),
          }
        ),
      ];
    }

    return [];
  }
}

// ============================================================================
// Approach 1: Load All MCP Servers at Startup (Recommended)
// ============================================================================

console.log("=== Approach 1: Load All MCP Servers at Startup ===\n");

// Initialize all MCP clients at startup
const mcpClients = {
  "org-github": new MockMCPClient("mcp://github.server", "org-github"),
  "org-gitlab": new MockMCPClient("mcp://gitlab.server", "org-gitlab"),
};

// Load all tools from all MCP servers
console.log("🚀 Loading all MCP tools at startup...");
const allMCPTools: any[] = [];
for (const [orgId, client] of Object.entries(mcpClients)) {
  console.log(`\n📦 Loading tools for ${orgId}`);
  const tools = await client.getTools();
  allMCPTools.push(...tools);
  console.log(`  ✓ Loaded ${tools.length} tools from ${orgId}`);
}

console.log(`\n✅ Total MCP tools loaded: ${allMCPTools.length}`);
console.log(
  `   Tools: ${allMCPTools.map((t) => t.name).join(", ")}`
);

// Create middleware to filter MCP tools by organization
const mcpOrgFilter = createMiddleware({
  name: "MCPOrgFilter",
  contextSchema: z.object({
    orgId: z.string().describe("Organization identifier"),
  }),
  wrapModelCall: (request, handler) => {
    const { orgId } = request.runtime.context;

    console.log(`\n🔧 Filtering MCP tools for ${orgId}`);

    // Filter to only tools for this organization
    const tools = request.tools?.filter((tool) =>
      tool.name.includes(`mcp_${orgId}_`)
    );

    console.log(
      `   ✓ Available tools: ${tools?.map((t) => t.name).join(", ") || "none"}`
    );

    return handler({ ...request, tools });
  },
});

// Create agent with all MCP tools
const mcpAgent = createAgent({
  model: "openai:gpt-4o",
  tools: allMCPTools,
  middleware: [mcpOrgFilter],
  systemPrompt: "You are a helpful assistant with access to MCP tools.",
});

// Use the agent with different organizations
console.log("\n📍 Request 1: GitHub organization");
const result1 = await mcpAgent.invoke(
  {
    messages: [
      new HumanMessage("Get stats for langchain-ai/langchainjs repository"),
    ],
  },
  { context: { orgId: "org-github" } }
);
console.log("✅ Response:", result1.messages.at(-1)?.content);

console.log("\n📍 Request 2: GitLab organization");
const result2 = await mcpAgent.invoke(
  {
    messages: [new HumanMessage("Get CI stats for project 123")],
  },
  { context: { orgId: "org-gitlab" } }
);
console.log("✅ Response:", result2.messages.at(-1)?.content);

// ============================================================================
// Approach 2: Load MCP Servers Per Request (Dynamic)
// ============================================================================

console.log("\n\n=== Approach 2: Load MCP Servers Per Request ===\n");

/**
 * Load MCP tools dynamically per request
 */
async function handleMCPRequest(orgId: string, message: string) {
  console.log(`\n📍 Processing request for ${orgId}`);

  // Create MCP client for this organization
  const serverUrl = `mcp://${orgId}.server`;
  const client = new MockMCPClient(serverUrl, orgId);

  // Load tools from MCP server
  const tools = await client.getTools();
  console.log(
    `  ✓ Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`
  );

  // Create agent with MCP tools
  const agent = createAgent({
    model: "openai:gpt-4o",
    tools,
    systemPrompt: `You are a helpful assistant for ${orgId}.`,
  });

  // Invoke agent
  const result = await agent.invoke({
    messages: [new HumanMessage(message)],
  });

  return result;
}

// Use the dynamic approach
console.log("📧 Request 1: GitHub organization (dynamic)");
const result3 = await handleMCPRequest(
  "org-github",
  "Get info about user octocat"
);
console.log("✅ Response:", result3.messages.at(-1)?.content);

console.log("\n📧 Request 2: GitLab organization (dynamic)");
const result4 = await handleMCPRequest(
  "org-gitlab",
  "Get CI stats for project 456"
);
console.log("✅ Response:", result4.messages.at(-1)?.content);

// ============================================================================
// Key Takeaways
// ============================================================================

console.log("\n" + "=".repeat(60));
console.log("KEY TAKEAWAYS FOR MCP TOOLS:");
console.log("=".repeat(60));
console.log("\nAPPROACH 1: Load All MCP Servers at Startup");
console.log("  ✓ Better performance (no loading per request)");
console.log("  ✓ Single agent instance");
console.log("  ✓ Use middleware to filter by org");
console.log("  ⚠ All MCP servers must be known at startup");
console.log("  ⚠ Higher memory usage");

console.log("\nAPPROACH 2: Load MCP Servers Per Request");
console.log("  ✓ True dynamic loading");
console.log("  ✓ Lower memory (only load what's needed)");
console.log("  ✓ No need to know servers at startup");
console.log("  ⚠ Agent creation overhead");
console.log("  ⚠ MCP connection overhead per request");

console.log("\nRECOMMENDATION:");
console.log("- Use Approach 1 if you have a fixed set of MCP servers");
console.log("- Use Approach 2 if MCP servers are truly dynamic");
console.log("- Consider caching MCP connections in Approach 2");
console.log("=".repeat(60));

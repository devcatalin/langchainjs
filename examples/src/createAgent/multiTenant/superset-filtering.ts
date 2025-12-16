/**
 * Multi-Tenant Tool Injection: Superset Filtering Pattern
 *
 * This example demonstrates the RECOMMENDED approach for multi-tenant scenarios:
 * 1. Define ALL possible tools at agent creation time
 * 2. Use middleware to filter tools based on tenant context
 * 3. Reuse a single agent instance across multiple requests
 *
 * This pattern is efficient and type-safe, but requires knowing all possible tools upfront.
 */

import { z } from "zod";
import { createAgent, createMiddleware, tool, HumanMessage } from "langchain";

// ============================================================================
// Tenant-Specific Tools
// ============================================================================

// GitHub Tools (for GitHub users)
const githubCreateIssue = tool(
  async ({ repo, title }) => {
    console.log(`  📝 Creating GitHub issue in ${repo}: ${title}`);
    return JSON.stringify({
      url: `https://github.com/${repo}/issues/123`,
      title,
      status: "created",
    });
  },
  {
    name: "github_create_issue",
    description: "Create an issue in a GitHub repository",
    schema: z.object({
      repo: z.string().describe("Repository in format 'owner/repo'"),
      title: z.string().describe("Issue title"),
    }),
  }
);

const githubListRepos = tool(
  async () => {
    console.log("  📚 Listing GitHub repositories");
    return JSON.stringify([
      "langchain-ai/langchainjs",
      "langchain-ai/langgraph",
    ]);
  },
  {
    name: "github_list_repos",
    description: "List all repositories accessible to the user",
    schema: z.object({}),
  }
);

// GitLab Tools (for GitLab users)
const gitlabCreateIssue = tool(
  async ({ project, title }) => {
    console.log(`  📝 Creating GitLab issue in ${project}: ${title}`);
    return JSON.stringify({
      url: `https://gitlab.com/${project}/-/issues/456`,
      title,
      status: "created",
    });
  },
  {
    name: "gitlab_create_issue",
    description: "Create an issue in a GitLab project",
    schema: z.object({
      project: z.string().describe("Project in format 'group/project'"),
      title: z.string().describe("Issue title"),
    }),
  }
);

const gitlabListProjects = tool(
  async () => {
    console.log("  📚 Listing GitLab projects");
    return JSON.stringify([
      "langchain-ai/langchainjs",
      "langchain-ai/langgraph",
    ]);
  },
  {
    name: "gitlab_list_projects",
    description: "List all projects accessible to the user",
    schema: z.object({}),
  }
);

// Shared Tools (available to all tenants)
const searchDocs = tool(
  async ({ query }) => {
    console.log(`  🔍 Searching docs for: ${query}`);
    return `Documentation about ${query}: [relevant docs here]`;
  },
  {
    name: "search_docs",
    description: "Search documentation",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
  }
);

// ============================================================================
// Agent Setup with Superset
// ============================================================================

// CRITICAL: Include ALL possible tools here
const allTools = [
  // GitHub tools
  githubCreateIssue,
  githubListRepos,
  // GitLab tools
  gitlabCreateIssue,
  gitlabListProjects,
  // Shared tools
  searchDocs,
];

// Middleware to filter tools based on tenant context
const tenantToolFilter = createMiddleware({
  name: "TenantToolFilter",
  contextSchema: z.object({
    vcsProvider: z.enum(["github", "gitlab"]).describe("VCS provider"),
    tenantId: z.string().describe("Tenant identifier"),
  }),
  wrapModelCall: (request, handler) => {
    const { vcsProvider, tenantId } = request.runtime.context;

    console.log(
      `\n🔧 Filtering tools for tenant ${tenantId} (${vcsProvider})`
    );

    // Filter tools based on provider
    const tools = request.tools?.filter((tool) => {
      // Always include shared tools
      if (tool.name === "search_docs") {
        return true;
      }

      // Include provider-specific tools
      if (vcsProvider === "github") {
        return tool.name.startsWith("github_");
      } else if (vcsProvider === "gitlab") {
        return tool.name.startsWith("gitlab_");
      }

      return false;
    });

    console.log(
      `   ✓ Available tools: ${tools?.map((t) => t.name).join(", ") || "none"}`
    );

    return handler({ ...request, tools });
  },
});

// Create singleton agent with ALL tools
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: allTools, // Complete superset
  middleware: [tenantToolFilter],
  systemPrompt:
    "You are a helpful assistant that can manage issues and search documentation.",
});

// ============================================================================
// Usage Examples
// ============================================================================

console.log("=== Multi-Tenant Tool Injection: Superset Filtering ===\n");

// Tenant A: GitHub user
console.log("📍 Request 1: GitHub user creating an issue");
const resultGithub = await agent.invoke(
  {
    messages: [
      new HumanMessage(
        "Create an issue titled 'Bug: login fails' in langchain-ai/langchainjs"
      ),
    ],
  },
  {
    context: {
      vcsProvider: "github",
      tenantId: "tenant-a",
    },
  }
);
console.log("✅ Response:", resultGithub.messages.at(-1)?.content);

// Tenant B: GitLab user
console.log("\n📍 Request 2: GitLab user creating an issue");
const resultGitlab = await agent.invoke(
  {
    messages: [
      new HumanMessage(
        "Create an issue titled 'Feature: add dark mode' in langchain-ai/langgraph"
      ),
    ],
  },
  {
    context: {
      vcsProvider: "gitlab",
      tenantId: "tenant-b",
    },
  }
);
console.log("✅ Response:", resultGitlab.messages.at(-1)?.content);

// Tenant C: GitHub user searching docs (shared tool)
console.log("\n📍 Request 3: GitHub user searching documentation");
const resultSearch = await agent.invoke(
  {
    messages: [new HumanMessage("Search for information about middleware")],
  },
  {
    context: {
      vcsProvider: "github",
      tenantId: "tenant-c",
    },
  }
);
console.log("✅ Response:", resultSearch.messages.at(-1)?.content);

// ============================================================================
// Key Takeaways
// ============================================================================

console.log("\n" + "=".repeat(60));
console.log("KEY TAKEAWAYS:");
console.log("=".repeat(60));
console.log("1. ✓ All tools defined at agent creation (allTools array)");
console.log("2. ✓ Middleware filters tools based on runtime context");
console.log("3. ✓ Single agent instance serves multiple tenants");
console.log("4. ✓ Type-safe and efficient");
console.log("5. ✓ Tools are filtered, not added dynamically");
console.log("=".repeat(60));

/**
 * Tests for multi-tenant tool injection patterns
 */
import { describe, it, expect } from "vitest";
import { z } from "zod/v3";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";

import { createAgent, createMiddleware } from "../index.js";
import { FakeToolCallingChatModel } from "./utils.js";

describe("Multi-tenant tool injection", () => {
  it("should allow filtering tools in wrapModelCall", async () => {
    // Create tools for different tenants
    const tenantATool = tool(
      async () => "Tenant A data",
      {
        name: "tenant_a_tool",
        description: "Tool for tenant A",
        schema: z.object({}),
      }
    );

    const tenantBTool = tool(
      async () => "Tenant B data",
      {
        name: "tenant_b_tool",
        description: "Tool for tenant B",
        schema: z.object({}),
      }
    );

    const allTools = [tenantATool, tenantBTool];

    // Create middleware to filter by tenant
    const tenantFilter = createMiddleware({
      name: "TenantFilter",
      contextSchema: z.object({ tenantId: z.string() }),
      wrapModelCall: (request, handler) => {
        const { tenantId } = request.runtime.context;
        const tools = request.tools?.filter((t) =>
          t.name.includes(tenantId)
        );
        return handler({ ...request, tools });
      },
    });

    // Mock model that calls a tool
    const model = new FakeToolCallingChatModel({
      responses: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_1",
              name: "tenant_a_tool",
              args: {},
              type: "tool_call",
            },
          ],
        }),
        new AIMessage("Result from tenant A"),
      ],
    });

    const agent = createAgent({
      model,
      tools: allTools,
      middleware: [tenantFilter],
    });

    const result = await agent.invoke(
      { messages: [new HumanMessage("Get data")] },
      { context: { tenantId: "tenant_a" } }
    );

    // Should successfully call tenant A tool
    // Messages: Human message, AI with tool call, Tool result, AI final response
    expect(result.messages.length).toBeGreaterThanOrEqual(3);
    const toolMessage = result.messages.find((m) => 
      ToolMessage.isInstance(m)
    ) as ToolMessage;
    expect(toolMessage).toBeDefined();
    expect(toolMessage.name).toBe("tenant_a_tool");
  });

  it("should throw error when trying to add new tool in wrapModelCall", async () => {
    const existingTool = tool(
      async () => "existing",
      {
        name: "existing_tool",
        description: "Existing tool",
        schema: z.object({}),
      }
    );

    const newTool = tool(
      async () => "new",
      {
        name: "new_tool",
        description: "New tool",
        schema: z.object({}),
      }
    );

    const badMiddleware = createMiddleware({
      name: "BadMiddleware",
      wrapModelCall: (request, handler) => {
        // This should fail - trying to add a new tool
        return handler({
          ...request,
          tools: [...(request.tools || []), newTool],
        });
      },
    });

    const model = new FakeToolCallingChatModel({
      responses: [new AIMessage("response")],
    });

    const agent = createAgent({
      model,
      tools: [existingTool],
      middleware: [badMiddleware],
    });

    await expect(
      agent.invoke({ messages: [new HumanMessage("test")] })
    ).rejects.toThrow(/added a new tool.*new_tool/i);
  });

  it("should throw error when trying to modify tool instance in wrapModelCall", async () => {
    const originalTool = tool(
      async () => "original",
      {
        name: "my_tool",
        description: "Original tool",
        schema: z.object({}),
      }
    );

    const modifiedTool = tool(
      async () => "modified",
      {
        name: "my_tool", // Same name
        description: "Modified tool",
        schema: z.object({}),
      }
    );

    const badMiddleware = createMiddleware({
      name: "BadMiddleware",
      wrapModelCall: (request, handler) => {
        // This should fail - trying to replace tool instance
        return handler({
          ...request,
          tools: [modifiedTool],
        });
      },
    });

    const model = new FakeToolCallingChatModel({
      responses: [new AIMessage("response")],
    });

    const agent = createAgent({
      model,
      tools: [originalTool],
      middleware: [badMiddleware],
    });

    await expect(
      agent.invoke({ messages: [new HumanMessage("test")] })
    ).rejects.toThrow(/modified a tool.*my_tool/i);
  });

  it("should support singleton agent pattern with different contexts", async () => {
    const tool1 = tool(
      async () => "Tool 1 result",
      {
        name: "tool_1",
        description: "First tool",
        schema: z.object({}),
      }
    );

    const tool2 = tool(
      async () => "Tool 2 result",
      {
        name: "tool_2",
        description: "Second tool",
        schema: z.object({}),
      }
    );

    const contextFilter = createMiddleware({
      name: "ContextFilter",
      contextSchema: z.object({ enabledTools: z.array(z.string()) }),
      wrapModelCall: (request, handler) => {
        const { enabledTools } = request.runtime.context;
        const tools = request.tools?.filter((t) =>
          enabledTools.includes(t.name)
        );
        return handler({ ...request, tools });
      },
    });

    const model = new FakeToolCallingChatModel({
      responses: [
        new AIMessage({
          content: "",
          tool_calls: [
            { id: "call_1", name: "tool_1", args: {}, type: "tool_call" },
          ],
        }),
        new AIMessage("Used tool 1"),
        new AIMessage({
          content: "",
          tool_calls: [
            { id: "call_2", name: "tool_2", args: {}, type: "tool_call" },
          ],
        }),
        new AIMessage("Used tool 2"),
      ],
    });

    const agent = createAgent({
      model,
      tools: [tool1, tool2],
      middleware: [contextFilter],
    });

    // First invocation - only tool_1 enabled
    const result1 = await agent.invoke(
      { messages: [new HumanMessage("test")] },
      { context: { enabledTools: ["tool_1"] } }
    );

    expect(result1.messages).toBeDefined();
    const toolMsg1 = result1.messages.find((m) => 
      ToolMessage.isInstance(m)
    ) as ToolMessage;
    expect(toolMsg1.name).toBe("tool_1");

    // Second invocation - only tool_2 enabled
    const result2 = await agent.invoke(
      { messages: [new HumanMessage("test")] },
      { context: { enabledTools: ["tool_2"] } }
    );

    const toolMsg2 = result2.messages.find((m) => 
      ToolMessage.isInstance(m)
    ) as ToolMessage;
    expect(toolMsg2.name).toBe("tool_2");
  });

  it("should work with empty tool filter (no tools available)", async () => {
    const tool1 = tool(
      async () => "result",
      {
        name: "tool_1",
        description: "A tool",
        schema: z.object({}),
      }
    );

    const emptyFilter = createMiddleware({
      name: "EmptyFilter",
      wrapModelCall: (request, handler) => {
        // Filter out all tools
        return handler({ ...request, tools: [] });
      },
    });

    const model = new FakeToolCallingChatModel({
      responses: [new AIMessage("No tools available, so just responding")],
    });

    const agent = createAgent({
      model,
      tools: [tool1],
      middleware: [emptyFilter],
    });

    const result = await agent.invoke({
      messages: [new HumanMessage("test")],
    });

    expect(result.messages).toHaveLength(2); // Human message + AI response
    expect(AIMessage.isInstance(result.messages[1])).toBe(true);
  });
});

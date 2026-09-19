import OpenAI from "openai";
import { NextResponse } from "next/server";
import { DEN_COACH_SYSTEM_PROMPT } from "@/app/lib/denCoachPrompt";
import { getDispatcherDennyPrompt } from "@/app/lib/dispatcherDennyPrompt";
import { auth0 } from "@/lib/auth0";
import { connectServiceTitanMcp } from "@/lib/serviceTitanMcp";

export const runtime = "nodejs";
export const maxDuration = 300;

function formatMcpResult(result: unknown) {
  const text = JSON.stringify(result);

  if (text.length > 80000) {
    return `${text.slice(
      0,
      80000
    )}\n\n[Result shortened because it was very large.]`;
  }

  return text;
}

export async function POST(req: Request) {
  let mcpClient: Awaited<
    ReturnType<typeof connectServiceTitanMcp>
  > | null = null;

  try {
    const session = await auth0.getSession();

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const input =
      typeof body?.input === "string" ? body.input.trim() : "";

    if (!input) {
      return NextResponse.json(
        { error: "Missing input" },
        { status: 400 }
      );
    }

    const tokenResponse = await auth0.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing ServiceTitan MCP access token" },
        { status: 401 }
      );
    }

    mcpClient = await connectServiceTitanMcp(accessToken);

    const mcpToolList = await mcpClient.listTools();

    const openAiTools = mcpToolList.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description:
          tool.description || `ServiceTitan tool: ${tool.name}`,
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    }));

    const openai = new OpenAI({ apiKey });

    const messages: any[] = [
      {
        role: "system",
        content: `${DEN_COACH_SYSTEM_PROMPT}

${getDispatcherDennyPrompt()}

You also have access to live ServiceTitan MCP tools.

Use those tools whenever the user asks about customers, jobs, appointments,
technicians, estimates, invoices, payments, projects, scheduling,
availability, routes, or other ServiceTitan information.

For installation scheduling requests, follow the Dispatcher Denny rules,
check all qualified installers, and use live ServiceTitan information before
making a recommendation.

Never claim you checked ServiceTitan unless you actually used a tool.`,
      },
      {
        role: "user",
        content: input,
      },
    ];

    for (let round = 0; round < 8; round++) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages,
        tools: openAiTools,
        tool_choice: "auto",
      });

      const message = completion.choices?.[0]?.message;

      if (!message) {
        return NextResponse.json(
          { error: "OpenAI returned no message" },
          { status: 502 }
        );
      }

      messages.push(message);

      const toolCalls = message.tool_calls || [];

      if (toolCalls.length === 0) {
        const reply =
          message.content?.trim() || "No reply returned.";

        return NextResponse.json({ reply });
      }

      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") {
          continue;
        }

        let toolArguments: Record<string, unknown> = {};

        try {
          toolArguments = JSON.parse(
            toolCall.function.arguments || "{}"
          );
        } catch {
          toolArguments = {};
        }

        const toolResult = await mcpClient.callTool(
  {
    name: toolCall.function.name,
    arguments: toolArguments,
  },
  {
    timeout: 240_000,
  }
);

const toolResultText = formatMcpResult(toolResult);

if (
  typeof toolResult === "object" &&
  toolResult !== null &&
  "isError" in toolResult &&
  toolResult.isError
) {
  return NextResponse.json(
    {
      error: `ServiceTitan tool failed: ${toolCall.function.name}`,
      details: toolResultText,
    },
    { status: 502 }
  );
}

messages.push({
  role: "tool",
  tool_call_id: toolCall.id,
  content: toolResultText,
});
      }
    }

    return NextResponse.json(
      {
        error:
          "The request needed too many ServiceTitan tool steps. Please make the request more specific.",
      },
      { status: 500 }
    );
  } catch (err: any) {
    const status = err?.status || 500;
    const message = err?.message || String(err);

    return NextResponse.json(
      {
        error: "Server crashed in /api/chat",
        details: message,
      },
      { status }
    );
  } finally {
    if (mcpClient) {
      await mcpClient.close().catch(() => undefined);
    }
  }
}
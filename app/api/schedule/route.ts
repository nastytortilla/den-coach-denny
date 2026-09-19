import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getSalesSchedulerPrompt } from "@/app/lib/salesSchedulerPrompt";
import { auth0 } from "@/lib/auth0";
import { connectServiceTitanMcp } from "@/lib/serviceTitanMcp";

export const runtime = "nodejs";
export const maxDuration = 300;

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

function formatMcpResult(result: unknown) {
  const serialized = JSON.stringify(result);
  const text = serialized ?? String(result);

  if (text.length > 80000) {
    return `${text.slice(
      0,
      80000
    )}\n\n[Result shortened because it was very large.]`;
  }

  return text;
}

function getConversationMessages(
  body: any
): ConversationMessage[] {
  if (Array.isArray(body?.messages)) {
    return body.messages
      .filter(
        (message: any) =>
          (message?.role === "user" ||
            message?.role === "assistant") &&
          typeof message?.content === "string" &&
          message.content.trim()
      )
      .slice(-20)
      .map((message: any) => ({
        role: message.role,
        content: message.content
          .trim()
          .slice(0, 12000),
      }));
  }

  const input =
    typeof body?.input === "string"
      ? body.input.trim()
      : "";

  if (!input) {
    return [];
  }

  return [
    {
      role: "user",
      content: input.slice(0, 12000),
    },
  ];
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

    const body = await req
      .json()
      .catch(() => ({}));

    const conversation =
      getConversationMessages(body);

    if (conversation.length === 0) {
      return NextResponse.json(
        { error: "Missing conversation input" },
        { status: 400 }
      );
    }

    const tokenResponse =
      await auth0.getAccessToken();

    const accessToken = tokenResponse.token;

    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "Missing ServiceTitan MCP access token",
        },
        { status: 401 }
      );
    }

    mcpClient =
      await connectServiceTitanMcp(accessToken);

    const mcpToolList =
      await mcpClient.listTools();

    const openAiTools = mcpToolList.tools.map(
      (tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description:
            tool.description ||
            `ServiceTitan tool: ${tool.name}`,
          parameters:
            tool.inputSchema as Record<
              string,
              unknown
            >,
        },
      })
    );

    const openai = new OpenAI({ apiKey });

    const messages: any[] = [
      {
        role: "system",
        content: `${getSalesSchedulerPrompt()}

You have access to live ServiceTitan MCP tools.

Use the ServiceTitan tools for sales-consultant schedules,
appointments, non-job blocks, event blockers, availability,
customer locations, territories, and other scheduling data.

Use the routing tool for mileage and drive-time comparisons
whenever routing information is needed.

The routing tool uses the Google Routes API configured inside
the ServiceTitan MCP server.

This route is only for sales appointment placement.
Do not apply installer scheduling rules.

The conversation may contain earlier recommendations and
follow-up questions. Preserve that context.

If the user asks for three more options, exclude the options
already presented and use live ServiceTitan data to find the
next three valid choices.

Never claim that ServiceTitan or Google Routes was checked
unless the appropriate tool was actually used.`,
      },
      ...conversation,
    ];

    for (let round = 0; round < 12; round++) {
      const completion =
        await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages,
          tools: openAiTools,
          tool_choice: "auto",
        });

      const message =
        completion.choices?.[0]?.message;

      if (!message) {
        return NextResponse.json(
          {
            error:
              "OpenAI returned no message",
          },
          { status: 502 }
        );
      }

      messages.push(message);

      const toolCalls =
        message.tool_calls || [];

      if (toolCalls.length === 0) {
        const reply =
          message.content?.trim() ||
          "No reply returned.";

        return NextResponse.json({ reply });
      }

      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") {
          continue;
        }

        let toolArguments: Record<
          string,
          unknown
        > = {};

        try {
          toolArguments = JSON.parse(
            toolCall.function.arguments || "{}"
          );
        } catch {
          toolArguments = {};
        }

        const toolResult =
          await mcpClient.callTool(
            {
              name: toolCall.function.name,
              arguments: toolArguments,
            },
            {
              timeout: 240_000,
            }
          );

        const toolResultText =
          formatMcpResult(toolResult);

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
  } catch (error: any) {
    const status = error?.status || 500;
    const message =
      error?.message || String(error);

    return NextResponse.json(
      {
        error:
          "Server crashed in /api/schedule",
        details: message,
      },
      { status }
    );
  } finally {
    if (mcpClient) {
      await mcpClient
        .close()
        .catch(() => undefined);
    }
  }
}
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

type McpTool = {
  name: string;
  description?: string;
  inputSchema: unknown;
};

const MAX_CONVERSATION_CHARACTERS = 30000;
const MAX_MESSAGE_CHARACTERS = 6000;
const MAX_SINGLE_TOOL_RESULT = 30000;
const MAX_TOTAL_TOOL_RESULTS = 120000;
const MAX_OPENAI_RETRIES = 5;

function formatMcpResult(
  result: unknown,
  maximumLength = MAX_SINGLE_TOOL_RESULT
) {
  let text: string;

  try {
    const serialized = JSON.stringify(result);
    text = serialized ?? String(result);
  } catch {
    text = String(result);
  }

  if (maximumLength <= 0) {
    return "[Additional tool result omitted because the scheduling-data limit was reached.]";
  }

  if (text.length <= maximumLength) {
    return text;
  }

  const endingLength = Math.min(
    4000,
    Math.floor(maximumLength / 4)
  );

  const beginningLength =
    maximumLength - endingLength;

  return `${text.slice(0, beginningLength)}

[Middle of result removed because the ServiceTitan response was very large.]

${text.slice(-endingLength)}`;
}

function isBlockedCustomerLookupTool(
  toolName: string
) {
  const normalizedName =
    toolName.toLowerCase();

  if (
    normalizedName.includes("route") ||
    normalizedName.includes("drive_time") ||
    normalizedName.includes("distance")
  ) {
    return false;
  }

  return (
    normalizedName.includes("customer") ||
    normalizedName.includes("location_search") ||
    normalizedName.includes("search_location") ||
    normalizedName.includes("location_details")
  );
}

function isSchedulingTool(tool: McpTool) {
  const searchableText = `${
    tool.name
  } ${tool.description || ""}`.toLowerCase();

  const excludedTerms = [
    "invoice",
    "estimate",
    "payment",
    "pricebook",
    "inventory",
    "purchase order",
    "project details",
    "project history",
    "customer history",
    "customer search",
    "call recording",
    "transcript",
    "upload",
    "marketing",
    "membership",
    "equipment",
    "material",
  ];

  if (
    excludedTerms.some((term) =>
      searchableText.includes(term)
    )
  ) {
    return false;
  }

  const schedulingTerms = [
    "schedule",
    "scheduling",
    "calendar",
    "appointment",
    "availability",
    "technician",
    "employee roster",
    "sales consultant",
    "non-job",
    "non job",
    "event block",
    "blocker",
    "business time",
    "route",
    "routing",
    "drive time",
    "travel time",
    "distance",
  ];

  return schedulingTerms.some((term) =>
    searchableText.includes(term)
  );
}

function getConversationMessages(
  body: any
): ConversationMessage[] {
  if (Array.isArray(body?.messages)) {
    const sanitizedMessages: ConversationMessage[] =
      body.messages
        .filter(
          (message: any) =>
            (message?.role === "user" ||
              message?.role === "assistant") &&
            typeof message?.content === "string" &&
            message.content.trim()
        )
        .slice(-12)
        .map((message: any) => ({
          role: message.role,
          content: message.content
            .trim()
            .slice(0, MAX_MESSAGE_CHARACTERS),
        }));

    const selectedMessages: ConversationMessage[] =
      [];

    let totalCharacters = 0;

    for (
      let index =
        sanitizedMessages.length - 1;
      index >= 0;
      index--
    ) {
      const message =
        sanitizedMessages[index];

      const remainingCharacters =
        MAX_CONVERSATION_CHARACTERS -
        totalCharacters;

      if (remainingCharacters <= 0) {
        break;
      }

      const content =
        message.content.slice(
          0,
          remainingCharacters
        );

      selectedMessages.unshift({
        role: message.role,
        content,
      });

      totalCharacters += content.length;
    }

    return selectedMessages;
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
      content: input.slice(
        0,
        MAX_MESSAGE_CHARACTERS
      ),
    },
  ];
}

function getRetryDelayMilliseconds(
  error: any,
  attempt: number
) {
  const message =
    error?.message || String(error);

  const secondsMatch = message.match(
    /try again in ([\d.]+)s/i
  );

  if (secondsMatch) {
    const seconds =
      Number(secondsMatch[1]);

    if (Number.isFinite(seconds)) {
      return Math.min(
        30000,
        Math.max(
          1500,
          Math.ceil(seconds * 1000) + 1000
        )
      );
    }
  }

  const millisecondsMatch = message.match(
    /try again in ([\d.]+)ms/i
  );

  if (millisecondsMatch) {
    const milliseconds =
      Number(millisecondsMatch[1]);

    if (
      Number.isFinite(milliseconds)
    ) {
      return Math.min(
        30000,
        Math.max(
          1500,
          Math.ceil(milliseconds) + 1000
        )
      );
    }
  }

  return Math.min(
    30000,
    3000 * (attempt + 1)
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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

    const apiKey =
      process.env.OPENAI_API_KEY;

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
        {
          error:
            "Missing conversation input",
        },
        { status: 400 }
      );
    }

    const tokenResponse =
      await auth0.getAccessToken();

    const accessToken =
      tokenResponse.token;

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
      await connectServiceTitanMcp(
        accessToken
      );

    const mcpToolList =
      await mcpClient.listTools();

    const permittedTools =
      mcpToolList.tools.filter(
        (tool) =>
          !isBlockedCustomerLookupTool(
            tool.name
          ) &&
          isSchedulingTool(tool as McpTool)
      );

    const openAiTools =
      permittedTools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description:
            tool.description ||
            `ServiceTitan scheduling tool: ${tool.name}`,
          parameters:
            tool.inputSchema as Record<
              string,
              unknown
            >,
        },
      }));

    if (openAiTools.length === 0) {
      return NextResponse.json(
        {
          error:
            "No permitted ServiceTitan scheduling tools were available.",
        },
        { status: 502 }
      );
    }

    const openai =
      new OpenAI({ apiKey });

    const messages: any[] = [
      {
        role: "system",
        content: `${getSalesSchedulerPrompt()}

You have access to live ServiceTitan MCP scheduling and routing tools.

IMPORTANT TOOL RESTRICTIONS:

- Do not search for the prospective customer.
- Do not verify whether the customer exists in ServiceTitan.
- Do not search by customer name, phone number, street address, or customer record.
- The supplied city, ZIP code, or address is only the proposed appointment destination.
- A city and state are enough to perform a scheduling search.
- Use ServiceTitan only to check eligible sales consultants' schedules, appointments, jobs, non-job events, and event blockers.
- Use the routing tool for mileage and drive-time comparisons.
- The routing tool uses the Google Routes API configured inside the ServiceTitan MCP server.
- If only a city is supplied, perform a city-level routing estimate.
- Never require a complete street address before returning appointment options.

CALENDAR RESEARCH REQUIREMENTS:

- Read every returned appointment, Opportunity, DRM block, job, lunch, non-job event, and event blocker.
- Do not treat a calendar block as available time.
- Do not say a consultant has no nearby appointments unless live schedule data supports it.
- When routing a later appointment, use the preceding appointment location as the origin.
- Only use home as the origin for the first appointment of a route segment.
- A later appointment may begin a new route segment only when there is enough time to return home first.
- Eli R's consultations last exactly 1 hour.
- Do not change Eli's duration to 1 hour and 30 minutes.

This route is only for sales appointment placement.
Do not apply installer scheduling rules.

The conversation may contain earlier recommendations and follow-up questions. Preserve that context.

If the user asks for three more options, exclude options already presented and use live schedule data to find the next three valid choices.

Never claim that ServiceTitan or Google Routes was checked unless the appropriate tool was actually used.`,
      },
      ...conversation,
    ];

    let totalToolResultCharacters = 0;

    for (
      let round = 0;
      round < 12;
      round++
    ) {
      const createCompletion = () =>
        openai.chat.completions.create({
          model: "gpt-4.1-mini",
          temperature: 0.1,
          messages,
          tools: openAiTools,
          tool_choice: "auto",
          parallel_tool_calls: false,
        });

      let completion: Awaited<
        ReturnType<typeof createCompletion>
      > | null = null;

      for (
        let attempt = 0;
        attempt < MAX_OPENAI_RETRIES;
        attempt++
      ) {
        try {
          completion =
            await createCompletion();

          break;
        } catch (error: any) {
          const status =
            error?.status ||
            error?.statusCode;

          if (
            status !== 429 ||
            attempt ===
              MAX_OPENAI_RETRIES - 1
          ) {
            throw error;
          }

          const delay =
            getRetryDelayMilliseconds(
              error,
              attempt
            );

          await wait(delay);
        }
      }

      if (!completion) {
        return NextResponse.json(
          {
            error:
              "OpenAI did not complete the scheduling request after retrying.",
          },
          { status: 429 }
        );
      }

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

        return NextResponse.json({
          reply,
        });
      }

      for (const toolCall of toolCalls) {
        if (
          toolCall.type !== "function"
        ) {
          continue;
        }

        let toolArguments: Record<
          string,
          unknown
        > = {};

        try {
          toolArguments = JSON.parse(
            toolCall.function.arguments ||
              "{}"
          );
        } catch {
          toolArguments = {};
        }

        const toolResult =
          await mcpClient.callTool(
            {
              name:
                toolCall.function.name,
              arguments: toolArguments,
            },
            {
              timeout: 240_000,
            }
          );

        const errorResultText =
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
              details: errorResultText,
            },
            { status: 502 }
          );
        }

        const remainingToolCharacters =
          MAX_TOTAL_TOOL_RESULTS -
          totalToolResultCharacters;

        const allowedResultLength =
          Math.min(
            MAX_SINGLE_TOOL_RESULT,
            Math.max(
              0,
              remainingToolCharacters
            )
          );

        const toolResultText =
          formatMcpResult(
            toolResult,
            allowedResultLength
          );

        totalToolResultCharacters +=
          toolResultText.length;

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
          "The request needed too many ServiceTitan tool steps. Please narrow the requested location or date range.",
      },
      { status: 500 }
    );
  } catch (error: any) {
    const status =
      error?.status || 500;

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
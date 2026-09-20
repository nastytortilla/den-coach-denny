import OpenAI from "openai";
import { NextResponse } from "next/server";
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

const SALES_SCHEDULER_TOOL_NAME =
  "recommend_sales_schedule";

const MAX_CONVERSATION_CHARACTERS = 30000;
const MAX_MESSAGE_CHARACTERS = 6000;
const MAX_SINGLE_TOOL_RESULT = 60000;
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
    6000,
    Math.floor(maximumLength / 4)
  );

  const beginningLength =
    maximumLength - endingLength;

  return `${text.slice(0, beginningLength)}

[Middle of result removed because the ServiceTitan response was very large.]

${text.slice(-endingLength)}`;
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

    const salesSchedulerTool =
      mcpToolList.tools.find(
        (tool) =>
          tool.name ===
          SALES_SCHEDULER_TOOL_NAME
      ) as McpTool | undefined;

    if (!salesSchedulerTool) {
      return NextResponse.json(
        {
          error:
            "ServiceTitan MCP Tool #50 recommend_sales_schedule is not available. Confirm the latest ServiceTitan MCP deployment is live and reconnect the MCP session.",
        },
        { status: 502 }
      );
    }

    const openAiTools = [
      {
        type: "function" as const,
        function: {
          name: salesSchedulerTool.name,
          description:
            salesSchedulerTool.description ||
            "Return validated Den Defenders sales appointment options from live ServiceTitan schedules and Google Routes.",
          parameters:
            salesSchedulerTool.inputSchema as Record<
              string,
              unknown
            >,
        },
      },
    ];

    const openai =
      new OpenAI({ apiKey });

    const messages: any[] = [
      {
        role: "system",
        content: `You are Denny Smart Scheduler for Den Defenders.

IMPORTANT: You are NOT the scheduling engine. ServiceTitan MCP Tool #50, recommend_sales_schedule, is the scheduling authority.

For every request for sales appointment dates, times, availability, earliest options, alternate options, or more options:
- You MUST call recommend_sales_schedule before answering.
- Do not call or ask for any other ServiceTitan tool.
- Do not independently calculate calendar gaps, drive times, lunch, return-home routing, appointment duration, or whether a slot is valid. Do not override Tool #50 territory rules.
- Do not invent, round, move, improve, or substitute a time returned by the tool.
- Present only options returned as valid by recommend_sales_schedule.
- Treat the tool's date, start time, end time, consultant, routing decision, previous event, next event, and validation reason as authoritative for this response.
- If the tool returns no valid options, say that plainly rather than manufacturing an alternative.

INPUT RULES:
- The prospective customer does not need to exist in ServiceTitan.
- Never search for the prospective customer.
- A ZIP code, city/state, or complete street address is valid for appointmentLocation. Preserve exactly what the CSR supplied.
- When the CSR supplies only a ZIP code, keep that ZIP as appointmentLocation. If you are confident which fixed sales territory contains that ZIP, you may supply the matching consultantNames so Tool #50 can evaluate it; otherwise do not guess.
- If the user specifies a starting date, pass it as startDate.
- If the user does not specify a starting date, omit startDate and let Tool #50 use the current Pacific business date.
- If the user asks for a specific number of options, pass that number as maxRecommendations. Otherwise request 3.

FOLLOW-UP RULES:
- The conversation can contain options already presented earlier.
- If the user says "Next 3 Options", asks for "three more", "more dates", "next options", or otherwise wants additional choices, call recommend_sales_schedule again with maxRecommendations set to 3.
- Populate excludeOptions with EVERY appointment option already presented earlier in the conversation, using its date, local start time, and consultant when available.
- Do not repeat an earlier option when the user asked for additional choices.
- "Next 3 Options" means the customer declined the currently displayed choices. Keep the same location, consultant/territory, and date context unless the CSR explicitly changes them.

DEFAULT OUTPUT FORMAT:
- Keep the appointment list extremely short and CSR-friendly.
- For each option, output ONLY these three lines/fields:
  1. Full date and appointment start/end time.
     - Consultant: consultant name
     - Reason: appointment immediately before and appointment immediately after, using their times and city/location when available.
- Example:
  1. Tuesday, September 22, 2026, from 8:00 AM to 9:30 AM
     - Consultant: Mike Conarton
     - Reason: Previous appointment: 6:30 AM-7:30 AM in Clovis, CA. Next appointment: 10:30 AM-12:00 PM in Madera, CA.
- If there is no previous appointment, say "No earlier appointment scheduled."
- If there is no next appointment, say "No later appointment scheduled."
- The Reason line must ONLY describe the immediately preceding and following customer appointments/jobs. Do NOT put routing math, drive time, lunch, policy blockers, home-base logic, conflict checks, appointment duration validation, city-level-routing notes, or phrases such as "fits without conflicts" in the Reason line.
- Do NOT add extra validation bullet points under the option.
- Do NOT say "The 90-minute appointment fits without conflicts" or similar wording.
- Tool #50 must still perform all routing, territory, blocker, lunch, duration, travel, and policy validation internally; simply keep those details out of the default CSR-facing appointment list.
- If the CSR asks "Why?" or asks for details about a specific recommendation, then explain the relevant route, blocker, lunch, territory, home-base, duration, and validation facts in that follow-up answer.
- Do not say anything was booked; Tool #50 is advisory/read-only.

Once recommend_sales_schedule has returned successfully during the current request, answer from that result. Do not call it a second time in the same request unless the first tool result explicitly says another call is required.`,
      },
      ...conversation,
    ];

    let totalToolResultCharacters = 0;
    let schedulerToolHasRun = false;

    for (
      let round = 0;
      round < 6;
      round++
    ) {
      const createCompletion = () =>
        openai.chat.completions.create({
          model: "gpt-4.1-mini",
          temperature: 0,
          messages,
          tools: openAiTools,
          tool_choice:
            schedulerToolHasRun
              ? "auto"
              : {
                  type: "function" as const,
                  function: {
                    name:
                      SALES_SCHEDULER_TOOL_NAME,
                  },
                },
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
        if (!schedulerToolHasRun) {
          return NextResponse.json(
            {
              error:
                "Denny did not run the required sales scheduling tool.",
            },
            { status: 502 }
          );
        }

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

        if (
          toolCall.function.name !==
          SALES_SCHEDULER_TOOL_NAME
        ) {
          return NextResponse.json(
            {
              error:
                `Unexpected scheduling tool requested: ${toolCall.function.name}`,
            },
            { status: 502 }
          );
        }

        if (schedulerToolHasRun) {
          return NextResponse.json(
            {
              error:
                "Denny attempted to rerun Tool #50 during the same scheduling request. Please retry the request.",
            },
            { status: 502 }
          );
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
                SALES_SCHEDULER_TOOL_NAME,
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
              error:
                "ServiceTitan Tool #50 recommend_sales_schedule failed.",
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

        schedulerToolHasRun = true;

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
          "The scheduling request did not finish after Tool #50 returned its result.",
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

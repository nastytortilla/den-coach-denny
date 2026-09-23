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
const ZIP_RESOLUTION_CACHE_MS =
  7 * 24 * 60 * 60 * 1000;

const zipResolutionCache = new Map<
  string,
  {
    expiresAt: number;
    value: ZipResolution;
  }
>();

const MONTH_NUMBER: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

type ZipResolution = {
  zip: string;
  city: string;
  state: string;
  stateAbbreviation: string;
  latitude?: string;
  longitude?: string;
};

function addDateOnlyDays(
  dateString: string,
  days: number
) {
  const date = new Date(
    `${dateString}T12:00:00.000Z`
  );

  date.setUTCDate(
    date.getUTCDate() + days
  );

  return date.toISOString().slice(0, 10);
}

type CustomerSchedulingConstraints = {
  requestedDates: string[];
  requestedWeekdays: string[];
  earliestStartTime?: string;
  latestStartTime?: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function pacificDateString() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function normalizeRequestedClock(
  hourText: string,
  minuteText: string | undefined,
  periodText: string | undefined
) {
  let hour = Number(hourText);
  const minute = Number(minuteText || 0);
  const period = String(periodText || "")
    .replace(/\./g, "")
    .toLowerCase();
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute > 59) {
    return null;
  }
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === "pm" && hour !== 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
  } else if (hour === 12) {
    hour = 12;
  } else if (hour >= 1 && hour <= 7) {
    // Sales hours make an unqualified "after 1" naturally mean 1:00 PM.
    hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function nextRequestedWeekday(
  weekday: string,
  baseDate: string
) {
  const target = WEEKDAY_INDEX[weekday.toLowerCase()];
  const base = new Date(`${baseDate}T12:00:00.000Z`);
  const delta = (target - base.getUTCDay() + 7) % 7;
  return addDateOnlyDays(baseDate, delta);
}

function schedulingConstraintsFromText(
  text: string
): CustomerSchedulingConstraints {
  const constraints: CustomerSchedulingConstraints = {
    requestedDates: [],
    requestedWeekdays: [],
  };
  const source = String(text || "");
  const today = pacificDateString();

  const earliest = source.match(
    /\b(?:only\s+)?(?:after|at\s+or\s+after|no\s+earlier\s+than)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\b/i
  );
  if (earliest) {
    const normalized = normalizeRequestedClock(
      earliest[1],
      earliest[2],
      earliest[3]
    );
    if (normalized) constraints.earliestStartTime = normalized;
  }

  const latest = source.match(
    /\b(?:only\s+)?(?:before|at\s+or\s+before|no\s+later\s+than)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\b/i
  );
  if (latest) {
    const normalized = normalizeRequestedClock(
      latest[1],
      latest[2],
      latest[3]
    );
    if (normalized) constraints.latestStartTime = normalized;
  }

  const relativeWeekday = source.match(
    /\b(?:this|next)\s+(monday|tuesday|wednesday|thursday|friday)\b/i
  );
  if (relativeWeekday) {
    constraints.requestedDates.push(
      nextRequestedWeekday(relativeWeekday[1], today)
    );
  } else {
    const weekdayOnly = source.match(
      /\b(?:only\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday)s?|(monday|tuesday|wednesday|thursday|friday)s?\s+only)\b/i
    );
    const weekday = weekdayOnly?.[1] || weekdayOnly?.[2];
    if (weekday) {
      constraints.requestedWeekdays.push(
        weekday.charAt(0).toUpperCase() + weekday.slice(1).toLowerCase()
      );
    }
  }

  const namedDate = source.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i
  );
  if (namedDate) {
    const month = MONTH_NUMBER[namedDate[1].toLowerCase()];
    const day = namedDate[2].padStart(2, "0");
    let year = Number(namedDate[3] || today.slice(0, 4));
    let resolved = `${year}-${month}-${day}`;
    if (!namedDate[3] && resolved < today) {
      year += 1;
      resolved = `${year}-${month}-${day}`;
    }
    if (Number.isFinite(new Date(`${resolved}T12:00:00.000Z`).getTime())) {
      constraints.requestedDates = [resolved];
      constraints.requestedWeekdays = [];
    }
  }

  const numericDate = source.match(
    /\b(1[0-2]|0?[1-9])[\/-](3[01]|[12]\d|0?[1-9])(?:[\/-](\d{4}))?\b/
  );
  if (!namedDate && numericDate) {
    const month = numericDate[1].padStart(2, "0");
    const day = numericDate[2].padStart(2, "0");
    let year = Number(numericDate[3] || today.slice(0, 4));
    let resolved = `${year}-${month}-${day}`;
    if (!numericDate[3] && resolved < today) {
      year += 1;
      resolved = `${year}-${month}-${day}`;
    }
    if (Number.isFinite(new Date(`${resolved}T12:00:00.000Z`).getTime())) {
      constraints.requestedDates = [resolved];
      constraints.requestedWeekdays = [];
    }
  }

  return constraints;
}

function extractCustomerSchedulingConstraints(
  messages: ConversationMessage[]
) {
  const userMessages = messages.filter(
    (message) => message.role === "user"
  );
  const latest = userMessages[userMessages.length - 1];
  if (!latest) return schedulingConstraintsFromText("");
  if (!/^next\s*3\s*options[.!]?$/i.test(latest.content.trim())) {
    return schedulingConstraintsFromText(latest.content);
  }
  for (let index = userMessages.length - 2; index >= 0; index--) {
    const parsed = schedulingConstraintsFromText(userMessages[index].content);
    if (
      parsed.requestedDates.length ||
      parsed.requestedWeekdays.length ||
      parsed.earliestStartTime ||
      parsed.latestStartTime
    ) {
      return parsed;
    }
  }
  return schedulingConstraintsFromText("");
}

function applyCustomerSchedulingConstraints(
  args: Record<string, unknown>,
  constraints: CustomerSchedulingConstraints
) {
  if (constraints.requestedDates.length) {
    args.requestedDates = constraints.requestedDates;
    if (!args.startDate) args.startDate = constraints.requestedDates[0];
  }
  if (constraints.requestedWeekdays.length) {
    args.requestedWeekdays = constraints.requestedWeekdays;
  }
  if (constraints.earliestStartTime) {
    args.earliestStartTime = constraints.earliestStartTime;
  }
  if (constraints.latestStartTime) {
    args.latestStartTime = constraints.latestStartTime;
  }
}

function latestPresentedOptionDate(
  messages: ConversationMessage[]
) {
  let latest: string | null = null;

  const pattern =
    /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/gi;

  for (const message of messages) {
    pattern.lastIndex = 0;

    if (message.role !== "assistant") {
      continue;
    }

    let match: RegExpExecArray | null;

    while ((match = pattern.exec(message.content))) {
      const month =
        MONTH_NUMBER[match[1].toLowerCase()];
      const day = match[2].padStart(2, "0");
      const date = `${match[3]}-${month}-${day}`;

      if (!latest || date > latest) {
        latest = date;
      }
    }
  }

  return latest;
}

function isNextThreeOptionsRequest(
  messages: ConversationMessage[]
) {
  const last = messages[messages.length - 1];

  if (!last || last.role !== "user") {
    return false;
  }

  return /^next\s*3\s*options[.!]?$/i.test(
    last.content.trim()
  );
}

function latestUserMessage(
  messages: ConversationMessage[]
) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") {
      return messages[index].content;
    }
  }

  return "";
}

function latestUserMessageContainsZip(
  messages: ConversationMessage[]
) {
  return /\b\d{5}(?:-\d{4})?\b/.test(
    latestUserMessage(messages)
  );
}

function latestUserMessageIsBareZip(
  messages: ConversationMessage[]
) {
  return /^\d{5}(?:-\d{4})?$/.test(
    latestUserMessage(messages).trim()
  );
}

function isExplanationFollowUp(
  messages: ConversationMessage[]
) {
  const text = latestUserMessage(messages)
    .trim()
    .toLowerCase();

  return /^(why|explain|how|show me why|show why|details|what made|what caused|what route|routing)/.test(
    text
  );
}

function extractSchedulerPayload(
  toolResult: any
) {
  const content = Array.isArray(toolResult?.content)
    ? toolResult.content
    : [];

  for (const item of content) {
    if (item?.type !== "text" || typeof item?.text !== "string") {
      continue;
    }

    try {
      const parsed = JSON.parse(item.text);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, any>;
      }
    } catch {
      // Keep looking in case another text block contains the JSON payload.
    }
  }

  return null;
}

function formatClockTime(
  isoValue: unknown,
  timeZone: string
) {
  if (typeof isoValue !== "string" || !isoValue) {
    return null;
  }

  const date = new Date(isoValue);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatOptionDate(
  dateValue: unknown
) {
  if (typeof dateValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return String(dateValue || "Date unavailable");
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${dateValue}T12:00:00.000Z`));
}

function customerEventLocation(
  event: any
) {
  const location = event?.location;

  if (location && typeof location === "object") {
    const city = String(location.city || "").trim();
    const state = String(location.state || "").trim();

    if (city && state) {
      return `${city}, ${state}`;
    }

    if (city) {
      return city;
    }

    const address = String(location.address || "").trim();
    if (address) {
      return address;
    }
  }

  return null;
}

function summarizeCustomerAppointment(
  event: any,
  timeZone: string
) {
  if (!event) {
    return null;
  }

  const start = formatClockTime(event.start, timeZone);
  const end = formatClockTime(event.end, timeZone);
  const location = customerEventLocation(event);

  const timeText = start && end
    ? `${start}-${end}`
    : start || end || "time unavailable";

  return location
    ? `${timeText} in ${location}`
    : timeText;
}

function toolConfirmsSalesServiceArea(
  payload: any
) {
  const territoryConsultants = Array.isArray(
    payload?.territoryResolution?.consultants
  )
    ? payload.territoryResolution.consultants
    : Array.isArray(payload?.territoryConsultants)
      ? payload.territoryConsultants
      : [];

  return territoryConsultants.length > 0;
}

function getTerritoryClarificationReply(
  payload: any,
  zipResolution: ZipResolution | null
) {
  if (
    payload?.recommendationStatus !==
    "Territory clarification required"
  ) {
    return null;
  }

  const locationIntro = zipResolution
    ? `${zipResolution.zip} is ${zipResolution.city}, ${zipResolution.stateAbbreviation}, but I could not confidently match it to a sales territory.`
    : "I could not confidently match that location to a sales territory.";

  return `${locationIntro} Please enter the full street address, including city, state, and ZIP code.`;
}

function getOutsideServiceAreaReply(
  payload: any,
  zipResolution: ZipResolution | null
) {
  if (payload?.recommendationStatus !== "Outside service area") {
    return null;
  }

  const zip = String(
    payload?.zip || zipResolution?.zip || "that ZIP"
  ).trim();

  return `${zip} is outside the approved Den Defenders sales service area.`;
}

function malformedZipReply(
  messages: ConversationMessage[]
) {
  const text = latestUserMessage(messages).trim();
  const zipLabelMatch = text.match(
    /\bzip(?:\s+code)?\b\D*(\d{1,10}(?:-\d{1,6})?)\b/i
  );
  const bareNumberMatch = text.match(/^\d{1,10}(?:-\d{1,6})?$/);
  const value = zipLabelMatch?.[1] || bareNumberMatch?.[0] || "";

  if (!value || /^\d{5}(?:-\d{4})?$/.test(value)) {
    return null;
  }

  return "Please enter a valid five-digit ZIP code, such as 95207.";
}

function formatConciseSchedulerReply(
  payload: any,
  zipResolution: ZipResolution | null,
  includeZipIntro: boolean
) {
  const options = Array.isArray(payload?.options)
    ? payload.options
    : [];

  if (!options.length) {
    return null;
  }

  const lines: string[] = [];

  if (
    includeZipIntro &&
    zipResolution &&
    toolConfirmsSalesServiceArea(payload)
  ) {
    lines.push(
      `${zipResolution.zip} is ${zipResolution.city}, ${zipResolution.stateAbbreviation}, and it is in our service area.`
    );
    lines.push("");
  }

  options.forEach((option: any, index: number) => {
    const timeZone = String(
      option?.consultantTimeZone || "America/Los_Angeles"
    );
    const start = formatClockTime(option?.start, timeZone) || "start time unavailable";
    const end = formatClockTime(option?.end, timeZone) || "end time unavailable";
    const date = formatOptionDate(option?.date);
    const consultant = String(option?.consultantName || "Consultant unavailable");

    const previous = summarizeCustomerAppointment(
      option?.precedingCustomerAppointment,
      timeZone
    );
    const following = summarizeCustomerAppointment(
      option?.followingCustomerAppointment,
      timeZone
    );

    const reasonParts = [
      previous
        ? `Previous appointment: ${previous}.`
        : "No earlier appointment scheduled.",
      following
        ? `Next appointment: ${following}.`
        : "No later appointment scheduled.",
    ];

    lines.push(
      `${index + 1}. ${date}, from ${start} to ${end}`
    );
    lines.push(`   - Consultant: ${consultant}`);
    lines.push(`   - Reason: ${reasonParts.join(" ")}`);

    if (index < options.length - 1) {
      lines.push("");
    }
  });

  return lines.join("\n");
}

function formatNoOptionsReply(
  payload: any,
  zipResolution: ZipResolution | null,
  includeZipIntro: boolean
) {
  const options = Array.isArray(payload?.options)
    ? payload.options
    : [];
  if (options.length) return null;
  if (!String(payload?.recommendationStatus || "").toLowerCase().includes("no route-safe")) {
    return null;
  }

  const lines: string[] = [];
  if (
    includeZipIntro &&
    zipResolution &&
    toolConfirmsSalesServiceArea(payload)
  ) {
    lines.push(
      `${zipResolution.zip} is ${zipResolution.city}, ${zipResolution.stateAbbreviation}, and it is in our service area.`
    );
    lines.push("");
  }

  const constraints = payload?.customerRequestedConstraints || {};
  const constraintParts: string[] = [];
  if (Array.isArray(constraints.requestedDates) && constraints.requestedDates.length) {
    constraintParts.push(`the requested date ${constraints.requestedDates.join(", ")}`);
  }
  if (Array.isArray(constraints.requestedWeekdays) && constraints.requestedWeekdays.length) {
    constraintParts.push(`${constraints.requestedWeekdays.join(" or ")} only`);
  }
  if (constraints.earliestStartTime) {
    constraintParts.push(`starts at or after ${constraints.earliestStartTime}`);
  }
  if (constraints.latestStartTime) {
    constraintParts.push(`starts at or before ${constraints.latestStartTime}`);
  }

  lines.push(
    constraintParts.length
      ? `I couldn't find a valid appointment matching ${constraintParts.join(", ")}.`
      : "I couldn't find a valid appointment in the search period."
  );

  const rejected = Array.isArray(payload?.diagnostics?.sampleRejectedRouteCandidates)
    ? payload.diagnostics.sampleRejectedRouteCandidates
    : [];
  const reasons: string[] = Array.from(new Set<string>(
    rejected
      .map((item: any) => String(item?.reason || "").trim())
      .filter(Boolean)
  )).slice(0, 3);
  if (reasons.length) {
    lines.push(`Why: ${reasons.join(" ")}`);
  } else {
    lines.push("The available consultants did not have a territory-, calendar-, and route-safe opening that matched the request.");
  }
  return lines.join("\n");
}

function extractBareZipFromConversation(
  messages: ConversationMessage[]
) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];

    if (message.role !== "user") {
      continue;
    }

    const match = message.content.match(
      /\b(\d{5})(?:-\d{4})?\b/
    );

    if (match) {
      return match[1];
    }
  }

  return null;
}

async function resolveUsZip(
  zip: string
): Promise<ZipResolution | null> {
  const cached = zipResolutionCache.get(zip);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (cached) {
    zipResolutionCache.delete(zip);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    5000
  );

  try {
    const response = await fetch(
      `https://api.zippopotam.us/us/${encodeURIComponent(zip)}`,
      {
        signal: controller.signal,
        next: {
          revalidate:
            ZIP_RESOLUTION_CACHE_MS / 1000,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload: any = await response.json();
    const place = Array.isArray(payload?.places)
      ? payload.places[0]
      : null;

    const city = String(
      place?.["place name"] || ""
    ).trim();
    const state = String(
      place?.state || ""
    ).trim();
    const stateAbbreviation = String(
      place?.["state abbreviation"] || ""
    ).trim();

    if (!city || !stateAbbreviation) {
      return null;
    }

    const resolution = {
      zip,
      city,
      state,
      stateAbbreviation,
      latitude:
        place?.latitude !== undefined
          ? String(place.latitude)
          : undefined,
      longitude:
        place?.longitude !== undefined
          ? String(place.longitude)
          : undefined,
    };

    zipResolutionCache.set(zip, {
      expiresAt:
        Date.now() + ZIP_RESOLUTION_CACHE_MS,
      value: resolution,
    });

    return resolution;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

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

    const invalidZipReply =
      malformedZipReply(conversation);

    if (invalidZipReply) {
      return NextResponse.json({
        reply: invalidZipReply,
        consultantChoices: [],
      });
    }

    const nextThreeRequest =
      isNextThreeOptionsRequest(conversation);

    const latestShownDate =
      nextThreeRequest
        ? latestPresentedOptionDate(
            conversation.slice(0, -1)
          )
        : null;

    const nextThreeStartDate =
      latestShownDate
        ? addDateOnlyDays(latestShownDate, 1)
        : null;

    const bareZip =
      extractBareZipFromConversation(
        conversation
      );

    const zipResolution = bareZip
      ? await resolveUsZip(bareZip)
      : null;

    const zipWasEnteredThisTurn =
      latestUserMessageContainsZip(conversation);

    const explanationFollowUp =
      isExplanationFollowUp(conversation);

    const customerSchedulingConstraints =
      extractCustomerSchedulingConstraints(conversation);

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

    const directZipSchedulingRequest = Boolean(
      zipResolution &&
      !explanationFollowUp &&
      (
        zipWasEnteredThisTurn ||
        nextThreeRequest
      )
    );

    if (directZipSchedulingRequest && zipResolution) {
      const directArguments: Record<string, unknown> = {
        appointmentLocation:
          `${zipResolution.zip}, ${zipResolution.city}, ${zipResolution.stateAbbreviation}`,
        maxRecommendations: 3,
      };
      const resolvedLatitude = Number(
        zipResolution.latitude
      );
      const resolvedLongitude = Number(
        zipResolution.longitude
      );

      if (
        Number.isFinite(resolvedLatitude) &&
        Number.isFinite(resolvedLongitude)
      ) {
        directArguments.appointmentLatitude =
          resolvedLatitude;
        directArguments.appointmentLongitude =
          resolvedLongitude;
      }

      if (nextThreeStartDate) {
        directArguments.startDate =
          nextThreeStartDate;
      }

      applyCustomerSchedulingConstraints(
        directArguments,
        customerSchedulingConstraints
      );

      const directToolResult =
        await mcpClient.callTool(
          {
            name:
              SALES_SCHEDULER_TOOL_NAME,
            arguments: directArguments,
          },
          {
            timeout: 240_000,
          }
        );

      if (
        typeof directToolResult === "object" &&
        directToolResult !== null &&
        "isError" in directToolResult &&
        directToolResult.isError
      ) {
        return NextResponse.json(
          {
            error:
              "ServiceTitan Tool #50 recommend_sales_schedule failed.",
            details:
              formatMcpResult(directToolResult),
          },
          { status: 502 }
        );
      }

      const directPayload =
        extractSchedulerPayload(
          directToolResult
        );
      const outsideServiceAreaReply =
        directPayload
          ? getOutsideServiceAreaReply(
              directPayload,
              zipResolution
            )
          : null;

      if (outsideServiceAreaReply) {
        return NextResponse.json({
          reply: outsideServiceAreaReply,
          consultantChoices: [],
        });
      }

      const territoryClarificationReply =
        directPayload
          ? getTerritoryClarificationReply(
              directPayload,
              zipResolution
            )
          : null;

      if (territoryClarificationReply) {
        return NextResponse.json({
          reply: territoryClarificationReply,
          consultantChoices: [],
        });
      }

      const conciseReply = directPayload
        ? formatConciseSchedulerReply(
            directPayload,
            zipResolution,
            zipWasEnteredThisTurn
          )
        : null;

      if (conciseReply) {
        return NextResponse.json({
          reply: conciseReply,
        });
      }

      const noOptionsReply = directPayload
        ? formatNoOptionsReply(
            directPayload,
            zipResolution,
            zipWasEnteredThisTurn
          )
        : null;

      if (noOptionsReply) {
        return NextResponse.json({
          reply: noOptionsReply,
        });
      }

      return NextResponse.json(
        {
          error:
            "The scheduling tool returned no usable appointment options.",
        },
        { status: 502 }
      );
    }

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

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
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
- A ZIP code, city/state, or complete street address is valid for appointmentLocation.
- A bare U.S. ZIP code is resolved server-side to its city, state, latitude, and longitude before Tool #50 runs. Tool #50's canonical ZIP territory map is authoritative.
- When ZIP resolution is available, use the resolved ZIP + city + state as appointmentLocation. The server will also attach ZIP-centroid coordinates for routing. Do not invent a different city, state, latitude, or longitude, and do not override Tool #50's canonical territory result with an external ZIP service or city alias.
- Never ask the CSR to select a sales consultant and never pass consultantNames. Tool #50 automatically chooses the best qualified consultant for each recommended date.
- ZIP ownership comes from the Den Coach Zip Assignments workbook. A non-owner may qualify only from an actual same-day prior customer appointment within 40 driving minutes; Tool #50 compares qualifying routes and chooses the closest consultant for that date.
- Nick Rendon is not eligible for sales scheduling.
- Mike Conarton is the Fresno/Bakersfield primary only during a live Fresno/Bakersfield coverage week; otherwise he remains in Arizona/Las Vegas.
- Jarret Beck follows the normal weekday rotation enforced by Tool #50, but a live regional marker is an exact-date override, including Thursday. His blockers must be honored, and return-home optimization is not used between his regional appointments.
- Ross P normally requires a same-day prior Returning to Install Security Products appointment within one hour. A live WASHINGTON / OREGON marker authorizes empty-day Northwest sales: Washington Monday-Wednesday and Oregon Wednesday-Friday. Drive home remains a hard no-work day.
- When a proposed appointment would be the final customer stop and ends at or after 4:00 PM, Tool #50 rejects it if it leaves the consultant more than 10 driving minutes farther from home than the preceding appointment. Jarret and verified temporary coverage are exempt.
- If Tool #50 returns "Outside service area" for a valid ZIP, state that the ZIP is outside the approved Den Defenders sales service area. Do not ask for a street address or expose a consultant roster.
- If Tool #50 cannot confidently resolve a territory, ask for the full street address, city, state, and ZIP. Never show its internal company-wide consultant roster.
- If the user specifies a starting date, pass it as startDate.
- If the user requests a specific date, weekday, earliest time, or latest time, pass requestedDates, requestedWeekdays, earliestStartTime, and latestStartTime exactly as applicable. Never return an option outside those customer constraints.
- If the user does not specify a starting date, omit startDate and let Tool #50 use the current Pacific business date.
- If the user asks for a specific number of options, pass that number as maxRecommendations. Otherwise request 3.

FOLLOW-UP RULES:
- The conversation can contain options already presented earlier.
- If the user says "Next 3 Options", asks for "three more", "more dates", "next options", or otherwise wants additional choices, call recommend_sales_schedule again with maxRecommendations set to 3.
- Populate excludeOptions with EVERY appointment option already presented earlier in the conversation, using its date, local start time, and consultant when available.
- Do not repeat an earlier option when the user asked for additional choices.
- "Next 3 Options" means the customer declined the currently displayed choices. Keep the same location and let Tool #50 automatically reassess all qualified consultants.
- For the exact "Next 3 Options" button request, start the new search on the calendar day AFTER the latest appointment date already displayed. This intentionally returns choices on later dates instead of sliding the same day's option by 15 minutes.

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
- The Reason line must ONLY describe the immediately preceding and following customer appointments/jobs. Use ONLY Tool #50 fields precedingCustomerAppointment and followingCustomerAppointment for the displayed Reason. NEVER use precedingCalendarItem or followingCalendarItem for the displayed Reason. Lunch, meetings, training, drive blocks, policy markers, and other non-job events must never appear as the previous/next appointment in the default CSR output. Do NOT put routing math, drive time, lunch, policy blockers, home-base logic, conflict checks, appointment duration validation, city-level-routing notes, or phrases such as "fits without conflicts" in the Reason line.
- Do NOT add extra validation bullet points under the option.
- Do NOT say "The 90-minute appointment fits without conflicts" or similar wording.
- Tool #50 must still perform all routing, territory, blocker, lunch, duration, travel, and policy validation internally; simply keep those details out of the default CSR-facing appointment list.
- If the CSR asks "Why?" or asks for details about a specific recommendation, then explain the relevant route, blocker, lunch, territory, home-base, duration, and validation facts in that follow-up answer.
- Do not say anything was booked; Tool #50 is advisory/read-only.
- When the CURRENT CSR message contains a ZIP code and server ZIP resolution is available, and Tool #50 confirms the location maps to a sales territory, begin the first answer with exactly one short sentence identifying the ZIP's city/state and saying it is in our service area. Do not repeat that sentence on Next 3 Options or later follow-ups.

Once recommend_sales_schedule has returned successfully during the current request, answer from that result. Do not call it a second time in the same request unless the first tool result explicitly says another call is required.`,
      },
      ...(zipResolution
        ? [
            {
              role: "system",
              content: `SERVER ZIP RESOLUTION: ${zipResolution.zip} resolves to ${zipResolution.city}, ${zipResolution.stateAbbreviation}. For Tool #50 use appointmentLocation "${zipResolution.zip}, ${zipResolution.city}, ${zipResolution.stateAbbreviation}". Do not ask the CSR to choose a sales consultant merely because the original input was a ZIP code.`,
            },
          ]
        : []),
      ...(nextThreeStartDate
        ? [
            {
              role: "system",
              content: `NEXT 3 OPTIONS OVERRIDE: The latest appointment date already shown is ${latestShownDate}. For this button request, call Tool #50 with startDate=${nextThreeStartDate} and maxRecommendations=3. Keep the same customer location and territory/consultant context. Do not return another time on any previously displayed date.`,
            },
          ]
        : []),
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
              ? "none"
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

        // Coordinates are trusted only when this server resolved them from the
        // ZIP lookup. Discard any model-generated coordinate values.
        delete toolArguments.appointmentLatitude;
        delete toolArguments.appointmentLongitude;

        if (zipResolution) {
          const requestedLocation = String(
            toolArguments.appointmentLocation ||
              ""
          ).trim();

          if (
            !requestedLocation ||
            /^\d{5}(?:-\d{4})?$/.test(
              requestedLocation
            ) ||
            requestedLocation === zipResolution.zip
          ) {
            toolArguments.appointmentLocation =
              `${zipResolution.zip}, ${zipResolution.city}, ${zipResolution.stateAbbreviation}`;
          }

          const resolvedLatitude = Number(
            zipResolution.latitude
          );
          const resolvedLongitude = Number(
            zipResolution.longitude
          );

          if (
            Number.isFinite(resolvedLatitude) &&
            Number.isFinite(resolvedLongitude)
          ) {
            toolArguments.appointmentLatitude =
              resolvedLatitude;
            toolArguments.appointmentLongitude =
              resolvedLongitude;
          }
        }

        if (nextThreeStartDate) {
          toolArguments.startDate =
            nextThreeStartDate;
          toolArguments.maxRecommendations = 3;
          delete toolArguments.endDate;
        }

        applyCustomerSchedulingConstraints(
          toolArguments,
          customerSchedulingConstraints
        );

        delete toolArguments.consultantNames;

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

        const schedulerPayload =
          extractSchedulerPayload(toolResult);

        const outsideServiceAreaReply =
          schedulerPayload
            ? getOutsideServiceAreaReply(
                schedulerPayload,
                zipResolution
              )
            : null;

        if (outsideServiceAreaReply) {
          return NextResponse.json({
            reply: outsideServiceAreaReply,
            consultantChoices: [],
          });
        }

        const territoryClarificationReply =
          schedulerPayload
            ? getTerritoryClarificationReply(
                schedulerPayload,
                zipResolution
              )
            : null;

        if (territoryClarificationReply) {
          return NextResponse.json({
            reply: territoryClarificationReply,
            consultantChoices: [],
          });
        }

        if (!explanationFollowUp && schedulerPayload) {
          const conciseReply =
            formatConciseSchedulerReply(
              schedulerPayload,
              zipResolution,
              zipWasEnteredThisTurn
            );

          if (conciseReply) {
            return NextResponse.json({
              reply: conciseReply,
            });
          }
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

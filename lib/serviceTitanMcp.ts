import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const SERVICETITAN_MCP_URL =
  "https://servicetitan-mcp-alpha.vercel.app/mcp";

export async function connectServiceTitanMcp(
  accessToken: string
) {
  const client = new Client(
    {
      name: "den-coach-denny",
      version: "1.0.0",
    },
    {
      versionNegotiation: {
        mode: "legacy",
      },
    }
  );

  const transport = new StreamableHTTPClientTransport(
    new URL(SERVICETITAN_MCP_URL),
    {
      authProvider: {
        token: async () => accessToken,
      },
    }
  );

  await client.connect(transport);

  return client;
}
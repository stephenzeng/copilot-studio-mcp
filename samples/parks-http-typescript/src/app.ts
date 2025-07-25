import express, { Request, Response } from 'express';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from 'zod';
import { ActivitiesService } from './services/activitiesService';
import { ParksService } from './services/parksService';


const server = new McpServer({
  name: "mcp-streamable-http",
  version: "1.0.0",
});

const activitiesService = new ActivitiesService();
const parkService = new ParksService();

server.tool(
  "getActivites",
  "Get the list of activities",
  {},
  async () => {
    console.log("Received request to get activities with apiKey " + myApiKey);
    const response = await activitiesService.getActivities(myApiKey);
    return {
      content: [{ type: "text", text: JSON.stringify(response) }]
    };
  }
);

server.tool(
  "getParks",
  "Get the list of parks",
  {
    stateCode: z.string().describe("The US state to filter parks by, e.g., 'CA' for California"),
  },
  async ({stateCode}) => {
    const response = await parkService.getParks(myApiKey, { stateCode: stateCode });
    return {
      content: [{ type: "text", text: JSON.stringify(response) }]
    };
  }
);

const app = express();
app.use(express.json());

const transport: StreamableHTTPServerTransport =
  new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // set to undefined for stateless servers
  });

const setupServer = async () => {
  await server.connect(transport);
};

var myApiKey = '';

app.post("/mcp", async (req: Request, res: Response) => {
  // Print the value of the x-api-key header
  const apiKey = req.header("x-api-key");
  if (apiKey && typeof apiKey === 'string' && apiKey.trim() !== '') {
    myApiKey = apiKey;
  }
  console.log("x-api-key header:", apiKey);
  console.log("Received MCP request:", req.body);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  console.log("Received GET MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

app.delete("/mcp", async (req: Request, res: Response) => {
  console.log("Received DELETE MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});


const PORT = process.env.PORT || 3000;
setupServer()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MCP Streamable HTTP Server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to set up the server:", error);
    process.exit(1);
  });


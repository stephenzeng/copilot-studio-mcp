import express, { Request, Response } from 'express';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from 'zod';
import { EventInfrastructureService } from './services/eventInfrastructureService';

require('dotenv').config();

const connectionString = process.env.COSMOS_DB_CONNECTION_STRING || '';
const tableName = process.env.COSMOS_DB_DATABASE_ID || '';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0" // Disable TLS certificate validation for local development 

const eventInfrastructureService = new EventInfrastructureService(connectionString, tableName);


const server = new McpServer({
  name: "mcp-streamable-http",
  version: "1.0.0",
});

server.tool(
  "getAllEvents",
  "Get the list of events",
  {},
  async () => {
    const response = await eventInfrastructureService.getAllEvents();
    return {
      content: [{ type: "text", text: JSON.stringify(response) }]
    };
  }
);

server.tool(
  "getSessions",
  "Get the list of sessions, optionally for a given event",
  {
    id: z.string().describe("The id of the event")
  },
  async ({ id }) => {
    const response = await eventInfrastructureService.getSessionsByEventId(id);
    return {
      content: [{ type: "text", text: JSON.stringify(response) }]
    };
  }
);

server.tool(
  "getSpeakers",
  "Get the list of speakers, optionally for a given event",
  {
    id: z.string().describe("The id of the event")
  },
  async ({ id }) => {
    const response = await eventInfrastructureService.getSpeakersByEventId(id);
    return {
      content: [{ type: "text", text: JSON.stringify(response) }]
    };
  }
);

server.tool(
  "getSponsors",
  "Get the list of sponsors, optionally for a given event",
  {
    id: z.string().describe("The id of the event")
  },
  async ({ id }) => {
    const response = await eventInfrastructureService.getSponsorsByEventId(id);
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
  await eventInfrastructureService.createContainersIfNotExist();
};

// CLI command support
if (process.argv[2] === "importEvents") {
  const filePath = process.argv[3];
  if (!filePath) {
    console.error("Usage: npm run start:importEvent <csvFilePath>");
    process.exit(1);
  }
  (async () => {
    try {
      console.log(`Importing events from ${filePath}`);
      await eventInfrastructureService.createContainersIfNotExist();
      await eventInfrastructureService.importEventWithSponsorsFromCsv(filePath);
      console.log(`Import completed for file: ${filePath}`);
      process.exit(0);
    } catch (err) {
      console.error("Import failed:", err);
      process.exit(1);
    }
  })();
  // Prevent server from starting in this mode
  //process.exit(0);
}

if (process.argv[2] === "importSessions") {
  const filePath = process.argv[3];
  const eventId = process.argv[4];
  if (!filePath) {
    console.error("Usage: npm run start:importSessions <csvFilePath> [eventId]");
    process.exit(1);
  }
  (async () => {
    try {
      await eventInfrastructureService.createContainersIfNotExist();
      if (eventId) {
        console.log(`Importing sessions from ${filePath} for event with id ${eventId}`);
        await eventInfrastructureService.importSessionsForEvent(filePath, eventId);
      } else {
        console.log(`Importing sessions from ${filePath} using Event Id from CSV file`);
        await eventInfrastructureService.importSessionsForEvent(filePath);
      }
      console.log(`Import completed for file: ${filePath}`);
      process.exit(0);
    } catch (err) {
      console.error("Import failed:", err);
      process.exit(1);
    }
  })();
  // Prevent server from starting in this mode
  //process.exit(0);
}


app.post("/mcp", async (req: Request, res: Response) => {
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

app.get("/events", async (req: Request, res: Response) => {
  console.log("Received /events request");
  try {
    var response = await eventInfrastructureService.getAllEvents();
    res.status(200).json(response);
  } catch (error) {
    console.error("Error handling /events request:", error);
    if (!res.headersSent) {
      res.status(500).json(error);
    }
  }
});

app.get("/sessions", async (req: Request, res: Response) => {
  try {

    console.log(`Received /sessions request`);
    const sessions = await eventInfrastructureService.getSessionsByEventId();
    console.log(`Returned ${sessions.length} sessions`);
    res.status(200).json(sessions);
  } catch (error) {
    console.error("Error handling /sessions request:", error);
    if (!res.headersSent) {
      res.status(500).json(error);
    }
  }
});

app.get("/events/:eventId/sessions", async (req: Request, res: Response) => {
  const eventId = req.params.eventId;
  console.log(`Received /sessions request for eventId: ${eventId}`);
  if (!eventId) {
    res.status(400).json({ error: "Missing eventId parameter" });
    return;
  }
  try {
    const sessions = await eventInfrastructureService.getSessionsByEventId(eventId);
    console.log(`Returned ${sessions.length} sessions`);
    res.status(200).json(sessions);
  } catch (error) {
    console.error(`Error handling /sessions/${eventId}/sessions request:`, error);
    if (!res.headersSent) {
      res.status(500).json(error);
    }
  }
});

app.get("/speakers", async (req: Request, res: Response) => {
  try {
    console.log(`Received /speakers request`);
    const speakers = await eventInfrastructureService.getSpeakersByEventId();
    console.log(`Returned ${speakers.length} speakers`);
    res.status(200).json(speakers);
  } catch (error) {
    console.error("Error handling /sessions request:", error);
    if (!res.headersSent) {
      res.status(500).json(error);
    }
  }
});

app.get("/events/:eventId/speakers", async (req: Request, res: Response) => {
  const eventId = req.params.eventId;
  console.log(`Received /speakers request for eventId: ${eventId}`);
  try {
    const speakers = await eventInfrastructureService.getSpeakersByEventId(eventId);
    console.log(`Returned ${speakers.length} speakers`);
    res.status(200).json(speakers);
  } catch (error) {
    console.error("Error handling /sessions request:", error);
    if (!res.headersSent) {
      res.status(500).json(error);
    }
  }
});

app.get("/sponsors", async (req: Request, res: Response) => {
  try {
    console.log(`Received /sponsors request`);
    const sponsors = await eventInfrastructureService.getSponsorsByEventId();
    console.log(`Returned ${sponsors.length} sponsors`);
    res.status(200).json(sponsors);
  } catch (error) {
    console.error("Error handling /sessions request:", error);
    if (!res.headersSent) {
      res.status(500).json(error);
    }
  }
});

app.get("/events/:eventId/sponsors", async (req: Request, res: Response) => {
  const eventId = req.params.eventId;
  console.log(`Received /sponsors request for eventId: ${eventId}`);
  if (!eventId) {
    res.status(400).json({ error: "Missing eventId parameter" });
    return;
  }
  try {
    const sponsors = await eventInfrastructureService.getSponsorsByEventId(eventId);
    console.log(`Returned ${sponsors.length} sponsors`);
    res.status(200).json(sponsors);
  } catch (error) {
    console.error(`Error handling /events/${eventId}/sponsors request:`, error);
    if (!res.headersSent) {
      res.status(500).json(error);
    }
  }
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


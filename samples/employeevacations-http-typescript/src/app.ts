import express, { Request, Response } from 'express';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from 'zod';
import EmployeeVacationService from './services/employeeVacationService.js';

require('dotenv').config();

const connectionString = process.env.TABLE_CONNECTION_STRING || '"UseDevelopmentStorage=true"';
const tableName = process.env.TABLE_NAME || 'EmployeeVacationTable';

// Instantiate EmployeeVacationService
const employeeVacationService = new EmployeeVacationService(connectionString, tableName);

const server = new McpServer({
    name: "mcp-streamable-http",
    version: "1.0.0",
});

server.tool("getVacationDaysLeftAsync",
    "Get the vacation days left for a given employee",
    {
        name: z.string().describe("The name of the employee")
    },
    async ({ name }) => ({
        content: [{ type: "text", text: String(await employeeVacationService.getVacationDaysLeft(name)) }]
    })
);

server.tool("chargeVacationDaysAsync",
    "Charge vacation days for a given employee.",
    {
        name: z.string().describe("The name of the employee"),
        daysToCharge: z.number().describe("The number of vacation days to charge")
    },
    async ({ name, daysToCharge }) => ({
        content: [{ type: "text", text: String(await employeeVacationService.chargeVacationDays(name, daysToCharge)) }]
    })
);

server.tool(
    "getAllEmployeesAsync",
    "Get the list of employees with their number of vacation days left",
    {},
    async () => {
        const response = await employeeVacationService.getAllEmployees();
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
    await employeeVacationService.createTableIfNotExists();
    const isTableEmpty = await employeeVacationService.isTableEmpty();
    if (isTableEmpty) {
        console.log("Table is empty. Seeding data...");
        await employeeVacationService.seedFakeEmployees();
        console.log("Data seeding completed.");
    } else {
        console.log("Table already contains data.");
    }
};

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


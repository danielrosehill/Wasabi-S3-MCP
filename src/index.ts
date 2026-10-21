#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  S3Client,
  ListBucketsCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetBucketLocationCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import * as dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import { randomUUID, timingSafeEqual } from "crypto";

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  "WASABI_ACCESS_KEY_ID",
  "WASABI_SECRET_ACCESS_KEY",
  "WASABI_REGION",
  "WASABI_ENDPOINT",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Initialize S3 client for Wasabi
const s3Client = new S3Client({
  region: process.env.WASABI_REGION!,
  endpoint: `https://${process.env.WASABI_ENDPOINT}`,
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID!,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: false,
});

// Each transport needs its own Server: the SDK refuses to connect one Server to a
// second transport ("Already connected to a transport"), so every session builds one.
function createMcpServer(): Server {
  const server = new Server(
    {
      name: "wasabi-mcp-server",
      version: "2.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools (consolidated)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "bucket",
          description: "Manage Wasabi buckets: list all buckets, create, delete, or get location",
          inputSchema: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["list", "create", "delete", "location"],
                description: "Action to perform: list (all buckets), create, delete, or location (get region)",
              },
              name: {
                type: "string",
                description: "Bucket name (required for create, delete, location)",
              },
            },
            required: ["action"],
          },
        },
        {
          name: "object",
          description: "Manage objects in Wasabi buckets: list, upload, download, delete, or get metadata",
          inputSchema: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["list", "upload", "download", "delete", "metadata"],
                description: "Action to perform on objects",
              },
              bucket: {
                type: "string",
                description: "Bucket name",
              },
              key: {
                type: "string",
                description: "Object key/path (required for upload, download, delete, metadata)",
              },
              local_path: {
                type: "string",
                description: "Local file path (required for upload and download)",
              },
              prefix: {
                type: "string",
                description: "Filter prefix for list action",
              },
              max_keys: {
                type: "number",
                description: "Maximum objects to return for list action (default: 1000)",
              },
              content_type: {
                type: "string",
                description: "MIME type for upload action",
              },
            },
            required: ["action", "bucket"],
          },
        },
        {
          name: "presign",
          description: "Generate presigned URLs for temporary access to objects (GET or PUT)",
          inputSchema: {
            type: "object",
            properties: {
              bucket: {
                type: "string",
                description: "Bucket name",
              },
              key: {
                type: "string",
                description: "Object key/path",
              },
              operation: {
                type: "string",
                enum: ["get", "put"],
                description: "Operation type: get (download) or put (upload)",
                default: "get",
              },
              expires_in: {
                type: "number",
                description: "URL expiration in seconds (default: 3600)",
              },
              content_type: {
                type: "string",
                description: "Content-Type for PUT operations",
              },
            },
            required: ["bucket", "key"],
          },
        },
      ],
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "bucket": {
          const { action, name: bucketName } = args as {
            action: "list" | "create" | "delete" | "location";
            name?: string;
          };

          switch (action) {
            case "list": {
              const response = await s3Client.send(new ListBucketsCommand({}));
              return {
                content: [{ type: "text", text: JSON.stringify(response.Buckets, null, 2) }],
              };
            }
            case "create": {
              if (!bucketName) throw new McpError(ErrorCode.InvalidParams, "Bucket name required");
              await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
              return {
                content: [{ type: "text", text: `Bucket '${bucketName}' created successfully` }],
              };
            }
            case "delete": {
              if (!bucketName) throw new McpError(ErrorCode.InvalidParams, "Bucket name required");
              await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
              return {
                content: [{ type: "text", text: `Bucket '${bucketName}' deleted successfully` }],
              };
            }
            case "location": {
              if (!bucketName) throw new McpError(ErrorCode.InvalidParams, "Bucket name required");
              const response = await s3Client.send(new GetBucketLocationCommand({ Bucket: bucketName }));
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ bucket: bucketName, location: response.LocationConstraint || "us-east-1" }, null, 2),
                }],
              };
            }
            default:
              throw new McpError(ErrorCode.InvalidParams, `Unknown bucket action: ${action}`);
          }
        }

        case "object": {
          const { action, bucket, key, local_path, prefix, max_keys, content_type } = args as {
            action: "list" | "upload" | "download" | "delete" | "metadata";
            bucket: string;
            key?: string;
            local_path?: string;
            prefix?: string;
            max_keys?: number;
            content_type?: string;
          };

          switch (action) {
            case "list": {
              const response = await s3Client.send(new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                MaxKeys: max_keys || 1000,
              }));
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ bucket, count: response.KeyCount, objects: response.Contents }, null, 2),
                }],
              };
            }
            case "upload": {
              if (!key || !local_path) throw new McpError(ErrorCode.InvalidParams, "key and local_path required for upload");
              const fileStream = createReadStream(local_path);
              await s3Client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: fileStream,
                ContentType: content_type,
              }));
              return {
                content: [{ type: "text", text: `Uploaded ${local_path} to ${bucket}/${key}` }],
              };
            }
            case "download": {
              if (!key || !local_path) throw new McpError(ErrorCode.InvalidParams, "key and local_path required for download");
              const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
              if (!response.Body) throw new Error("No body in response");
              await pipeline(response.Body as any, createWriteStream(local_path));
              return {
                content: [{ type: "text", text: `Downloaded ${bucket}/${key} to ${local_path}` }],
              };
            }
            case "delete": {
              if (!key) throw new McpError(ErrorCode.InvalidParams, "key required for delete");
              await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
              return {
                content: [{ type: "text", text: `Deleted ${bucket}/${key}` }],
              };
            }
            case "metadata": {
              if (!key) throw new McpError(ErrorCode.InvalidParams, "key required for metadata");
              const response = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    bucket,
                    key,
                    size: response.ContentLength,
                    contentType: response.ContentType,
                    lastModified: response.LastModified,
                    etag: response.ETag,
                    metadata: response.Metadata,
                  }, null, 2),
                }],
              };
            }
            default:
              throw new McpError(ErrorCode.InvalidParams, `Unknown object action: ${action}`);
          }
        }

        case "presign": {
          const { bucket, key, operation = "get", expires_in, content_type } = args as {
            bucket: string;
            key: string;
            operation?: "get" | "put";
            expires_in?: number;
            content_type?: string;
          };

          const expiresIn = expires_in || 3600;
          let command;

          if (operation === "put") {
            command = new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              ContentType: content_type,
            });
          } else {
            command = new GetObjectCommand({ Bucket: bucket, Key: key });
          }

          const url = await getSignedUrl(s3Client, command, { expiresIn });
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ bucket, key, operation, url, expiresIn }, null, 2),
            }],
          };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
    }
  });

  return server;
}

// Session management for Streamable HTTP
const sessions = new Map<string, StreamableHTTPServerTransport>();

// The object tool reads and writes local files (local_path) and can delete buckets, so
// the listener binds loopback unless MCP_HOST says otherwise, and any other bind
// requires MCP_AUTH_TOKEN.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function isAuthorized(req: Request, token: string): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

// Start the server with Streamable HTTP transport
async function main() {
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.MCP_HOST || "127.0.0.1";
  const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || undefined;

  if (!LOOPBACK_HOSTS.has(HOST) && !AUTH_TOKEN) {
    console.error(
      `Refusing to listen on ${HOST} without MCP_AUTH_TOKEN. Set MCP_AUTH_TOKEN, ` +
        "or bind to loopback (MCP_HOST=127.0.0.1) and put an authenticating proxy in front."
    );
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  // Health check endpoint (never requires auth)
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "2.1.0" });
  });

  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (AUTH_TOKEN && !isAuthorized(req, AUTH_TOKEN)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // MCP endpoint. Express 4 does not catch rejected async handlers, so every path is
  // wrapped: an escaped rejection would otherwise terminate the process.
  app.all("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId) {
        const transport = sessions.get(sessionId);
        if (!transport) {
          jsonRpcError(res, 404, -32001, "Session not found");
          return;
        }
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // No session header: only an initialize POST may open a new session.
      if (req.method !== "POST" || !isInitializeRequest(req.body)) {
        jsonRpcError(res, 400, -32000, "Bad Request: no valid session ID provided");
        return;
      }

      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
          console.error(`Session initialized: ${id}`);
        },
      });
      const server = createMcpServer();
      // Only drop the map entry here. Server.connect chains this handler into the
      // transport's close path, so calling server.close() from it recurses until the stack
      // overflows; the SDK already detaches the server when the transport closes.
      transport.onclose = () => {
        if (transport.sessionId && sessions.delete(transport.sessionId)) {
          console.error(`Session closed: ${transport.sessionId}`);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed:", error);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Internal server error");
      } else {
        res.end();
      }
    }
  });

  app.listen(PORT, HOST, () => {
    console.error(`Wasabi MCP Server running on http://${HOST}:${PORT}/mcp${AUTH_TOKEN ? " (bearer auth required)" : ""}`);
    console.error(`Health check: http://${HOST}:${PORT}/health`);
  });
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

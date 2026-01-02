#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
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
import express, { Request, Response } from "express";
import { randomUUID } from "crypto";

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

// Create MCP server instance
const server = new Server(
  {
    name: "wasabi-mcp-server",
    version: "2.0.0",
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

// Session management for Streamable HTTP
const sessions = new Map<string, StreamableHTTPServerTransport>();

// Start the server with Streamable HTTP transport
async function main() {
  const app = express();
  app.use(express.json());

  const PORT = process.env.PORT || 3000;

  // MCP endpoint
  app.all("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST") {
      // Handle new session or existing session
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        // Create new transport for new session
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, transport!);
            console.error(`Session initialized: ${id}`);
          },
        });

        // Connect server to transport
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } else if (req.method === "GET") {
      // SSE stream for server-to-client messages
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      const transport = sessions.get(sessionId)!;
      await transport.handleRequest(req, res);
    } else if (req.method === "DELETE") {
      // Session termination
      if (sessionId && sessions.has(sessionId)) {
        const transport = sessions.get(sessionId)!;
        await transport.handleRequest(req, res);
        sessions.delete(sessionId);
        console.error(`Session terminated: ${sessionId}`);
      } else {
        res.status(404).json({ error: "Session not found" });
      }
    } else {
      res.status(405).json({ error: "Method not allowed" });
    }
  });

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "2.0.0" });
  });

  app.listen(PORT, () => {
    console.error(`Wasabi MCP Server running on http://localhost:${PORT}/mcp`);
    console.error(`Health check: http://localhost:${PORT}/health`);
  });
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

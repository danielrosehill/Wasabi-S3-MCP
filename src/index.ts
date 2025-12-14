#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_buckets",
        description: "List all Wasabi buckets in your account",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "create_bucket",
        description: "Create a new Wasabi bucket",
        inputSchema: {
          type: "object",
          properties: {
            bucket_name: {
              type: "string",
              description: "Name of the bucket to create",
            },
          },
          required: ["bucket_name"],
        },
      },
      {
        name: "delete_bucket",
        description: "Delete a Wasabi bucket (bucket must be empty)",
        inputSchema: {
          type: "object",
          properties: {
            bucket_name: {
              type: "string",
              description: "Name of the bucket to delete",
            },
          },
          required: ["bucket_name"],
        },
      },
      {
        name: "get_bucket_location",
        description: "Get the region/location of a bucket",
        inputSchema: {
          type: "object",
          properties: {
            bucket_name: {
              type: "string",
              description: "Name of the bucket",
            },
          },
          required: ["bucket_name"],
        },
      },
      {
        name: "list_objects",
        description: "List objects in a Wasabi bucket",
        inputSchema: {
          type: "object",
          properties: {
            bucket_name: {
              type: "string",
              description: "Name of the bucket",
            },
            prefix: {
              type: "string",
              description: "Optional prefix to filter objects",
            },
            max_keys: {
              type: "number",
              description: "Maximum number of objects to return (default: 1000)",
            },
          },
          required: ["bucket_name"],
        },
      },
      {
        name: "upload_object",
        description: "Upload a file to a Wasabi bucket",
        inputSchema: {
          type: "object",
          properties: {
            bucket_name: {
              type: "string",
              description: "Name of the bucket",
            },
            key: {
              type: "string",
              description: "Object key (path) in the bucket",
            },
            file_path: {
              type: "string",
              description: "Local file path to upload",
            },
            content_type: {
              type: "string",
              description: "Optional content type (MIME type)",
            },
          },
          required: ["bucket_name", "key", "file_path"],
        },
      },
      {
        name: "download_object",
        description: "Download an object from a Wasabi bucket",
        inputSchema: {
          type: "object",
          properties: {
            bucket_name: {
              type: "string",
              description: "Name of the bucket",
            },
            key: {
              type: "string",
              description: "Object key (path) in the bucket",
            },
            local_path: {
              type: "string",
              description: "Local file path to save the downloaded object",
            },
          },
          required: ["bucket_name", "key", "local_path"],
        },
      },
      {
        name: "delete_object",
        description: "Delete an object from a Wasabi bucket",
        inputSchema: {
          type: "object",
          properties: {
            bucket_name: {
              type: "string",
              description: "Name of the bucket",
            },
            key: {
              type: "string",
              description: "Object key (path) to delete",
            },
          },
          required: ["bucket_name", "key"],
        },
      },
      {
        name: "get_object_metadata",
        description: "Get metadata for an object in a Wasabi bucket",
        inputSchema: {
          type: "object",
          properties: {
            bucket_name: {
              type: "string",
              description: "Name of the bucket",
            },
            key: {
              type: "string",
              description: "Object key (path)",
            },
          },
          required: ["bucket_name", "key"],
        },
      },
      {
        name: "generate_presigned_url",
        description:
          "Generate a presigned URL for temporary access to an object",
        inputSchema: {
          type: "object",
          properties: {
            bucket_name: {
              type: "string",
              description: "Name of the bucket",
            },
            key: {
              type: "string",
              description: "Object key (path)",
            },
            expires_in: {
              type: "number",
              description: "URL expiration time in seconds (default: 3600)",
            },
          },
          required: ["bucket_name", "key"],
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
      case "list_buckets": {
        const command = new ListBucketsCommand({});
        const response = await s3Client.send(command);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.Buckets, null, 2),
            },
          ],
        };
      }

      case "create_bucket": {
        const { bucket_name } = args as { bucket_name: string };
        const command = new CreateBucketCommand({
          Bucket: bucket_name,
        });
        await s3Client.send(command);
        return {
          content: [
            {
              type: "text",
              text: `Bucket '${bucket_name}' created successfully`,
            },
          ],
        };
      }

      case "delete_bucket": {
        const { bucket_name } = args as { bucket_name: string };
        const command = new DeleteBucketCommand({
          Bucket: bucket_name,
        });
        await s3Client.send(command);
        return {
          content: [
            {
              type: "text",
              text: `Bucket '${bucket_name}' deleted successfully`,
            },
          ],
        };
      }

      case "get_bucket_location": {
        const { bucket_name } = args as { bucket_name: string };
        const command = new GetBucketLocationCommand({
          Bucket: bucket_name,
        });
        const response = await s3Client.send(command);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  bucket: bucket_name,
                  location: response.LocationConstraint || "us-east-1",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "list_objects": {
        const { bucket_name, prefix, max_keys } = args as {
          bucket_name: string;
          prefix?: string;
          max_keys?: number;
        };
        const command = new ListObjectsV2Command({
          Bucket: bucket_name,
          Prefix: prefix,
          MaxKeys: max_keys || 1000,
        });
        const response = await s3Client.send(command);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  bucket: bucket_name,
                  count: response.KeyCount,
                  objects: response.Contents,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "upload_object": {
        const { bucket_name, key, file_path, content_type } = args as {
          bucket_name: string;
          key: string;
          file_path: string;
          content_type?: string;
        };
        const fileStream = createReadStream(file_path);
        const command = new PutObjectCommand({
          Bucket: bucket_name,
          Key: key,
          Body: fileStream,
          ContentType: content_type,
        });
        await s3Client.send(command);
        return {
          content: [
            {
              type: "text",
              text: `File uploaded successfully to ${bucket_name}/${key}`,
            },
          ],
        };
      }

      case "download_object": {
        const { bucket_name, key, local_path } = args as {
          bucket_name: string;
          key: string;
          local_path: string;
        };
        const command = new GetObjectCommand({
          Bucket: bucket_name,
          Key: key,
        });
        const response = await s3Client.send(command);
        if (response.Body) {
          const writeStream = createWriteStream(local_path);
          await pipeline(response.Body as any, writeStream);
          return {
            content: [
              {
                type: "text",
                text: `Object downloaded successfully to ${local_path}`,
              },
            ],
          };
        }
        throw new Error("No body in response");
      }

      case "delete_object": {
        const { bucket_name, key } = args as {
          bucket_name: string;
          key: string;
        };
        const command = new DeleteObjectCommand({
          Bucket: bucket_name,
          Key: key,
        });
        await s3Client.send(command);
        return {
          content: [
            {
              type: "text",
              text: `Object ${bucket_name}/${key} deleted successfully`,
            },
          ],
        };
      }

      case "get_object_metadata": {
        const { bucket_name, key } = args as {
          bucket_name: string;
          key: string;
        };
        const command = new HeadObjectCommand({
          Bucket: bucket_name,
          Key: key,
        });
        const response = await s3Client.send(command);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  bucket: bucket_name,
                  key: key,
                  size: response.ContentLength,
                  contentType: response.ContentType,
                  lastModified: response.LastModified,
                  etag: response.ETag,
                  metadata: response.Metadata,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "generate_presigned_url": {
        const { bucket_name, key, expires_in } = args as {
          bucket_name: string;
          key: string;
          expires_in?: number;
        };
        const command = new GetObjectCommand({
          Bucket: bucket_name,
          Key: key,
        });
        const url = await getSignedUrl(s3Client, command, {
          expiresIn: expires_in || 3600,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  bucket: bucket_name,
                  key: key,
                  url: url,
                  expiresIn: expires_in || 3600,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Wasabi MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

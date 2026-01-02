# Wasabi MCP Server

[![npm version](https://img.shields.io/npm/v/wasabi-mcp.svg)](https://www.npmjs.com/package/wasabi-mcp)

A Model Context Protocol (MCP) server for interacting with [Wasabi](https://wasabi.com/) cloud storage. This server provides tools for managing Wasabi buckets and objects through the MCP interface, enabling integration with Claude Code and other MCP-compatible applications.

## v2.0 - Streamable HTTP Transport

This version uses the modern **Streamable HTTP transport** instead of stdio, making it suitable for:
- Running as a standalone HTTP server
- Connecting via MCP aggregators
- Integration with tools that support HTTP-based MCP servers

## Features

### Consolidated Tools (3 tools instead of 10)

| Tool | Actions | Description |
|------|---------|-------------|
| `bucket` | list, create, delete, location | Manage Wasabi buckets |
| `object` | list, upload, download, delete, metadata | Manage objects in buckets |
| `presign` | get, put | Generate presigned URLs for temporary access |

## Installation

### From NPM

```bash
npm install -g wasabi-mcp
```

### From Source

```bash
git clone https://github.com/danielrosehill/Wasabi-S3-MCP.git
cd Wasabi-S3-MCP
npm install
npm run build
```

## Configuration

### Environment Variables

The server requires the following environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `WASABI_ACCESS_KEY_ID` | Your Wasabi access key | `AKIAIOSFODNN7EXAMPLE` |
| `WASABI_SECRET_ACCESS_KEY` | Your Wasabi secret key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `WASABI_REGION` | Wasabi region | `eu-central-2` |
| `WASABI_ENDPOINT` | Wasabi endpoint URL | `s3.eu-central-2.wasabisys.com` |
| `PORT` | Server port (optional) | `3000` (default) |

### Wasabi Regions

Common Wasabi regions and their endpoints:

| Region | Endpoint |
|--------|----------|
| `us-east-1` | `s3.us-east-1.wasabisys.com` |
| `us-east-2` | `s3.us-east-2.wasabisys.com` |
| `us-central-1` | `s3.us-central-1.wasabisys.com` |
| `us-west-1` | `s3.us-west-1.wasabisys.com` |
| `eu-central-1` | `s3.eu-central-1.wasabisys.com` |
| `eu-central-2` | `s3.eu-central-2.wasabisys.com` |
| `eu-west-1` | `s3.eu-west-1.wasabisys.com` |
| `eu-west-2` | `s3.eu-west-2.wasabisys.com` |
| `ap-northeast-1` | `s3.ap-northeast-1.wasabisys.com` |
| `ap-northeast-2` | `s3.ap-northeast-2.wasabisys.com` |
| `ap-southeast-1` | `s3.ap-southeast-1.wasabisys.com` |
| `ap-southeast-2` | `s3.ap-southeast-2.wasabisys.com` |

## Running the Server

### Start the Server

```bash
# Set environment variables first, then:
npm start

# Or run directly:
PORT=3000 node dist/index.js
```

The server will start on `http://localhost:3000/mcp` with a health check at `http://localhost:3000/health`.

## Usage with Claude Code

### JSON Configuration

Add to your Claude Code MCP settings (`~/.config/claude-code/settings.json` or project-level):

```json
{
  "mcpServers": {
    "wasabi": {
      "url": "http://localhost:3000/mcp",
      "transport": "streamable-http"
    }
  }
}
```

**Note:** You must start the server separately before using with Claude Code.

### Alternative: Run Server with Environment Variables

Create a `.env` file:

```bash
WASABI_ACCESS_KEY_ID=your_access_key
WASABI_SECRET_ACCESS_KEY=your_secret_key
WASABI_REGION=eu-central-2
WASABI_ENDPOINT=s3.eu-central-2.wasabisys.com
PORT=3000
```

Then start the server:

```bash
npm start
```

## API Reference

### bucket

Manage Wasabi buckets.

**Parameters:**
- `action` (string, required): One of `list`, `create`, `delete`, `location`
- `name` (string): Bucket name (required for create, delete, location)

**Examples:**
```json
// List all buckets
{ "action": "list" }

// Create a bucket
{ "action": "create", "name": "my-new-bucket" }

// Delete a bucket
{ "action": "delete", "name": "my-bucket" }

// Get bucket location
{ "action": "location", "name": "my-bucket" }
```

---

### object

Manage objects in Wasabi buckets.

**Parameters:**
- `action` (string, required): One of `list`, `upload`, `download`, `delete`, `metadata`
- `bucket` (string, required): Bucket name
- `key` (string): Object key/path (required for upload, download, delete, metadata)
- `local_path` (string): Local file path (required for upload and download)
- `prefix` (string): Filter prefix for list action
- `max_keys` (number): Maximum objects to return (default: 1000)
- `content_type` (string): MIME type for upload

**Examples:**
```json
// List objects
{ "action": "list", "bucket": "my-bucket" }

// List with prefix
{ "action": "list", "bucket": "my-bucket", "prefix": "reports/", "max_keys": 100 }

// Upload a file
{ "action": "upload", "bucket": "my-bucket", "key": "docs/report.pdf", "local_path": "/home/user/report.pdf" }

// Download a file
{ "action": "download", "bucket": "my-bucket", "key": "docs/report.pdf", "local_path": "/home/user/downloads/report.pdf" }

// Delete an object
{ "action": "delete", "bucket": "my-bucket", "key": "docs/old-report.pdf" }

// Get metadata
{ "action": "metadata", "bucket": "my-bucket", "key": "docs/report.pdf" }
```

---

### presign

Generate presigned URLs for temporary access.

**Parameters:**
- `bucket` (string, required): Bucket name
- `key` (string, required): Object key/path
- `operation` (string): `get` (download) or `put` (upload). Default: `get`
- `expires_in` (number): URL expiration in seconds (default: 3600)
- `content_type` (string): Content-Type for PUT operations

**Examples:**
```json
// Generate download URL
{ "bucket": "my-bucket", "key": "docs/report.pdf" }

// Generate download URL with custom expiration
{ "bucket": "my-bucket", "key": "docs/report.pdf", "expires_in": 7200 }

// Generate upload URL
{ "bucket": "my-bucket", "key": "uploads/new-file.pdf", "operation": "put", "content_type": "application/pdf" }
```

## Usage Examples with Claude

Once configured, use natural language with Claude Code:

### List Buckets
```
List all my Wasabi buckets
```

### Create a Bucket
```
Create a new Wasabi bucket called "my-backup"
```

### Upload a File
```
Upload ~/documents/report.pdf to bucket "my-backup" with key "reports/2025/report.pdf"
```

### Download a File
```
Download "reports/2025/report.pdf" from bucket "my-backup" to ~/Downloads/
```

### Generate Presigned URL
```
Generate a presigned URL for "reports/2025/report.pdf" in "my-backup" that expires in 2 hours
```

### List Objects with Prefix
```
List all objects in "my-backup" bucket that start with "reports/"
```

## Security Notes

- Never commit credentials to version control
- Use environment variables or secure credential management
- Presigned URLs provide temporary access - treat them as sensitive
- Consider using IAM policies to restrict bucket/object access

## Troubleshooting

### Server doesn't start
- Verify all environment variables are set
- Check that your Wasabi credentials are valid
- Ensure the endpoint matches your region

### Connection errors
- Verify the endpoint URL is correct for your region
- Check network connectivity to Wasabi
- Confirm your credentials have appropriate permissions

### Upload/Download fails
- Verify the file path exists and is accessible
- Check bucket permissions
- Ensure the bucket exists

## License

MIT

## Author

Daniel Rosehill (public@danielrosehill.com)

## Contributing

Issues and pull requests welcome at [GitHub](https://github.com/danielrosehill/Wasabi-S3-MCP).

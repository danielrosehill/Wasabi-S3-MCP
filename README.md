# Wasabi MCP Server

[![npm version](https://img.shields.io/npm/v/wasabi-mcp.svg)](https://www.npmjs.com/package/wasabi-mcp)

A Model Context Protocol (MCP) server for interacting with [Wasabi](https://wasabi.com/) cloud storage. This server provides tools for managing Wasabi buckets and objects through the MCP interface, enabling integration with Claude Code and other MCP-compatible applications.

## Features

### Bucket Operations
- **list_buckets** - List all buckets in your Wasabi account
- **create_bucket** - Create a new bucket
- **delete_bucket** - Delete a bucket (must be empty)
- **get_bucket_location** - Get the region/location of a bucket

### Object Operations
- **list_objects** - List objects in a bucket with optional prefix filtering
- **upload_object** - Upload files to a bucket
- **download_object** - Download objects from a bucket
- **delete_object** - Delete objects from a bucket
- **get_object_metadata** - Get metadata for an object (size, content type, last modified, etc.)
- **generate_presigned_url** - Generate temporary signed URLs for object access

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

## Usage with Claude Code

Add the server to Claude Code using the `claude mcp add` command:

```bash
claude mcp add wasabi -s user -- npx wasabi-mcp
```

Then set your environment variables. You can either:

1. **Set in your shell profile** (e.g., `~/.bashrc`, `~/.zshrc`):
   ```bash
   export WASABI_ACCESS_KEY_ID=your_access_key
   export WASABI_SECRET_ACCESS_KEY=your_secret_key
   export WASABI_REGION=eu-central-2
   export WASABI_ENDPOINT=s3.eu-central-2.wasabisys.com
   ```

2. **Pass environment variables directly**:
   ```bash
   claude mcp add wasabi -s user \
     -e WASABI_ACCESS_KEY_ID=your_access_key \
     -e WASABI_SECRET_ACCESS_KEY=your_secret_key \
     -e WASABI_REGION=eu-central-2 \
     -e WASABI_ENDPOINT=s3.eu-central-2.wasabisys.com \
     -- npx wasabi-mcp
   ```

### Verify Installation

```bash
claude mcp list
```

You should see `wasabi` listed with a connected status.

## Usage Examples

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

## API Reference

### list_buckets
Lists all Wasabi buckets in your account.

**Parameters:** None

**Returns:** Array of bucket objects with names and creation dates

---

### create_bucket
Creates a new Wasabi bucket.

**Parameters:**
- `bucket_name` (string, required): Name of the bucket to create

---

### delete_bucket
Deletes a Wasabi bucket (bucket must be empty).

**Parameters:**
- `bucket_name` (string, required): Name of the bucket to delete

---

### get_bucket_location
Gets the region/location of a bucket.

**Parameters:**
- `bucket_name` (string, required): Name of the bucket

---

### list_objects
Lists objects in a Wasabi bucket.

**Parameters:**
- `bucket_name` (string, required): Name of the bucket
- `prefix` (string, optional): Prefix to filter objects
- `max_keys` (number, optional): Maximum objects to return (default: 1000)

---

### upload_object
Uploads a file to a Wasabi bucket.

**Parameters:**
- `bucket_name` (string, required): Name of the bucket
- `key` (string, required): Object key (path) in the bucket
- `file_path` (string, required): Local file path to upload
- `content_type` (string, optional): MIME type

---

### download_object
Downloads an object from a Wasabi bucket.

**Parameters:**
- `bucket_name` (string, required): Name of the bucket
- `key` (string, required): Object key (path) in the bucket
- `local_path` (string, required): Local path to save the file

---

### delete_object
Deletes an object from a Wasabi bucket.

**Parameters:**
- `bucket_name` (string, required): Name of the bucket
- `key` (string, required): Object key (path) to delete

---

### get_object_metadata
Gets metadata for an object.

**Parameters:**
- `bucket_name` (string, required): Name of the bucket
- `key` (string, required): Object key (path)

**Returns:** Object metadata (size, content type, last modified, ETag, custom metadata)

---

### generate_presigned_url
Generates a presigned URL for temporary object access.

**Parameters:**
- `bucket_name` (string, required): Name of the bucket
- `key` (string, required): Object key (path)
- `expires_in` (number, optional): Expiration time in seconds (default: 3600)

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

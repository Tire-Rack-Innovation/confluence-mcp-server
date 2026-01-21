# Confluence MCP Server

Model Context Protocol (MCP) server for Confluence Cloud search and management. Enables Claude Code to connect to your Confluence instance for searching, reading, and managing documentation with built-in best-practice linting.

## Features

### Phase 1: Connection Proof ✅
- `confluence_ping` - Test connection and verify authentication
- `confluence_whoami` - Get authenticated user information
- `confluence_list_spaces` - List accessible Confluence spaces

### Phase 2: Read & Search ✅
- `confluence_search` - Search using CQL (Confluence Query Language)
- `confluence_get_page_by_title` - Find pages by exact title
- `confluence_list_pages` - List pages in a space
- `confluence_get_page` - Get full page content and metadata
- `confluence_get_page_metadata` - Get metadata without body
- `confluence_get_children` - Get child pages

### Phase 3: Safe Write Operations ✅
- `confluence_create_page` - Create new pages (with dry-run)
- `confluence_update_page` - Update existing pages (with dry-run)
- `confluence_add_labels` - Add labels to pages
- `confluence_remove_labels` - Remove labels from pages
- `confluence_archive_page` - Archive pages (with dry-run)

All write operations support `dryRun: true` for previewing changes.

### Phase 4: Best Practices ✅
- `confluence_lint_page` - Check pages for best practice violations
- `confluence_suggest_improvements` - Get actionable improvement suggestions

Checks for:
- Title conventions (length, formatting, generic terms)
- Missing metadata (owner, last reviewed date)
- Content structure (headings, paragraphs, code blocks)
- Labels (missing or non-standard)
- Staleness (pages not updated in 6+ months)
- Excessive nesting depth (4+ levels)

## Setup

### 1. Install Dependencies

```bash
cd ~/repos/confluence-mcp-server
npm install
```

### 2. Configure Environment

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Edit `.env` with your Confluence details:

```bash
# Your Confluence Cloud instance
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net

# Your Atlassian account email
CONFLUENCE_EMAIL=your-email@example.com

# API token (generate at https://id.atlassian.com/manage-profile/security/api-tokens)
CONFLUENCE_API_TOKEN=your-api-token-here

# Enable write operations (default: false)
CONFLUENCE_WRITE_ENABLED=false

# Optional: Restrict write operations to specific spaces
# CONFLUENCE_ALLOWED_SPACES=TEAM,DOCS,WIKI

# Optional: Enable audit logging (default: true)
CONFLUENCE_AUDIT_LOG=true
```

### 3. Generate Confluence API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give it a name (e.g., "Claude Code MCP")
4. Copy the token and paste it into your `.env` file

### 4. Add to Claude Code Configuration

Edit `~/.claude.json` and add to the **global** `mcpServers` section:

```json
{
  "mcpServers": {
    "confluence": {
      "type": "stdio",
      "command": "/Users/joshuamullet/repos/confluence-mcp-server/start-mcp-server.sh",
      "args": [],
      "env": {}
    }
  }
}
```

**Important:**
- Use the ABSOLUTE path to `start-mcp-server.sh`
- Add to global `mcpServers`, NOT inside a project's `mcpServers`
- Must include `"type": "stdio"` field

### 5. Restart Claude Code

Fully restart Claude Code to load the new MCP server:

```bash
# Exit current session
/exit

# Start new session
claude-code
```

### 6. Verify Connection

In Claude Code, check that the server is loaded:

```
/mcp
```

You should see `confluence` listed with connection status.

## Usage

### Connection Test

Test your Confluence connection:

```
Can you ping the Confluence server and show me the current user?
```

Claude will call `confluence_ping` and `confluence_whoami` to verify connectivity.

### Search Examples

**Search all spaces:**
```
Search Confluence for pages about "API documentation"
```

**Search specific space:**
```
Search for pages in the TEAM space that contain "deployment"
```

**Advanced CQL:**
```
Search Confluence using this CQL: type=page AND space=DOCS AND lastModified >= "2025-01-01"
```

### Read Examples

**Get page by title:**
```
Get the page titled "Getting Started" from the TEAM space
```

**Get page by ID:**
```
Show me the content of Confluence page 123456
```

**List pages:**
```
List all pages in the DOCS space
```

**Get page tree:**
```
Show me all child pages of page 123456
```

### Best Practices Linting

**Lint a page:**
```
Lint Confluence page 123456 for best practice issues
```

**Get improvement suggestions:**
```
Suggest improvements for Confluence page 123456
```

Example output:
```json
{
  "pageId": "123456",
  "pageTitle": "API Documentation",
  "totalFindings": 3,
  "findings": [
    {
      "severity": "warning",
      "category": "metadata",
      "message": "Missing owner or contact information",
      "recommendation": "Add an 'Owner' or 'Contact' section"
    },
    {
      "severity": "info",
      "category": "labels",
      "message": "Page has no labels",
      "recommendation": "Add labels to improve discoverability"
    }
  ]
}
```

### Write Operations (when enabled)

**Important:** Write operations require `CONFLUENCE_WRITE_ENABLED=true` in your `.env` file.

**Create a page:**
```
Create a new page in the TEAM space titled "New Feature" with this content:
<h1>Overview</h1>
<p>This is a new feature.</p>
```

**Update a page (dry-run first):**
```
Update page 123456 with a new title "Updated Title" - show me what will change first
```

**Add labels:**
```
Add labels "documentation" and "api" to page 123456
```

## Security

### Authentication
- Uses Confluence Cloud API tokens (not passwords)
- API tokens are stored in `.env` (gitignored, never committed)
- Authentication via HTTP Basic Auth (email + API token)

### Write Protection
- Write operations disabled by default
- Requires explicit `CONFLUENCE_WRITE_ENABLED=true`
- All write operations support dry-run mode
- Optional space allowlist restricts modifications

### Audit Logging
- All tool calls are logged to stderr
- Logs include: timestamp, tool name, parameters, success/error
- Sensitive data (API tokens) never logged
- View logs: `tail -f ~/.claude/logs/*.log`

### Rate Limiting
- Automatically detects 429 responses
- Returns clear error with retry-after information
- Implements basic retry logic with backoff

## Troubleshooting

### Server not appearing in `/mcp`

1. Check `~/.claude.json` configuration:
   - Is the server in the global `mcpServers` section?
   - Is the path to `start-mcp-server.sh` absolute and correct?
   - Is `"type": "stdio"` present?

2. Check server starts manually:
   ```bash
   cd ~/repos/confluence-mcp-server
   node mcp-server.js
   ```
   Should output: `Confluence MCP Server running on stdio`

3. Check Claude Code logs:
   ```bash
   tail -f ~/.claude/logs/*.log
   ```

### Authentication errors

- Verify `CONFLUENCE_BASE_URL` is correct (should be `https://your-domain.atlassian.net`)
- Verify `CONFLUENCE_EMAIL` matches your Atlassian account
- Regenerate API token if needed
- Test credentials manually:
  ```bash
  curl -u "your-email:your-token" "https://your-domain.atlassian.net/wiki/rest/api/space"
  ```

### Write operations disabled

- Check `CONFLUENCE_WRITE_ENABLED=true` in `.env`
- Restart Claude Code after changing `.env`
- Verify the setting loaded: server logs show "Write operations: ENABLED"

### Missing environment variables

Error: `Missing required environment variables`

Solution:
1. Ensure `.env` file exists in the server directory
2. Verify all required variables are set
3. Check dotenv is loading (see server startup logs)

## API Reference

### Search with CQL

CQL (Confluence Query Language) examples:

```
type=page AND space=TEAM
type=page AND title~"API"
type=page AND space=DOCS AND lastModified >= "2025-01-01"
type=page AND label="documentation"
creator=currentUser()
```

See [Confluence CQL documentation](https://developer.atlassian.com/server/confluence/advanced-searching-using-cql/) for more.

### Pagination

Most list operations support pagination:

```javascript
{
  "limit": 25,    // Results per page (max 100)
  "start": 0      // Offset (0 = first page, 25 = second page, etc.)
}
```

### Dry Run Mode

All write operations support dry-run:

```javascript
{
  "pageId": "123456",
  "title": "New Title",
  "dryRun": true  // Preview changes without applying
}
```

Returns what would be changed without making actual modifications.

## Development

### Project Structure

```
confluence-mcp-server/
├── mcp-server.js              # Main MCP server (loads dotenv first)
├── start-mcp-server.sh        # Shell wrapper for Claude Code
├── tools/
│   ├── confluence-client.js   # Confluence REST API client
│   └── best-practices.js      # Linting and suggestions
├── package.json
├── .env                       # Your credentials (gitignored)
├── .env.example               # Template
├── .gitignore
└── README.md
```

### Testing Manually

Test individual API calls:

```bash
cd ~/repos/confluence-mcp-server
node -e "
import('./tools/confluence-client.js').then(async ({ ConfluenceClient }) => {
  const client = new ConfluenceClient(
    process.env.CONFLUENCE_BASE_URL,
    process.env.CONFLUENCE_EMAIL,
    process.env.CONFLUENCE_API_TOKEN
  );
  const result = await client.ping();
  console.log(result);
});
"
```

## Resources

- [Confluence Cloud REST API](https://developer.atlassian.com/cloud/confluence/rest/v1/intro/)
- [Advanced searching using CQL](https://developer.atlassian.com/server/confluence/advanced-searching-using-cql/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Confluence API Authentication](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/)

## License

ISC

#!/usr/bin/env node

/**
 * Confluence MCP Server
 * Model Context Protocol server for Confluence search and management
 */

// CRITICAL: Load environment variables BEFORE importing other modules
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

// Now import other modules
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { ConfluenceClient } from './tools/confluence-client.js';
import { lintPage, suggestImprovements } from './tools/best-practices.js';

// ========== Configuration ==========

const CONFIG = {
  baseUrl: process.env.CONFLUENCE_BASE_URL,
  email: process.env.CONFLUENCE_EMAIL,
  apiToken: process.env.CONFLUENCE_API_TOKEN,
  writeEnabled: process.env.CONFLUENCE_WRITE_ENABLED === 'true',
  allowedSpaces: process.env.CONFLUENCE_ALLOWED_SPACES?.split(',').map(s => s.trim()) || null,
  auditLog: process.env.CONFLUENCE_AUDIT_LOG !== 'false' // Default true
};

// Validate required config
if (!CONFIG.baseUrl || !CONFIG.email || !CONFIG.apiToken) {
  console.error('ERROR: Missing required environment variables.');
  console.error('Required: CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN');
  console.error('See .env.example for configuration template.');
  process.exit(1);
}

// Initialize Confluence client
const confluenceClient = new ConfluenceClient(
  CONFIG.baseUrl,
  CONFIG.email,
  CONFIG.apiToken
);

// ========== Audit Logging ==========

function auditLog(toolName, params, result, error = null) {
  if (!CONFIG.auditLog) return;

  const logEntry = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    params: {
      ...params,
      // Never log sensitive data
      apiToken: undefined,
      password: undefined
    },
    success: !error,
    error: error?.message
  };

  console.error('[AUDIT]', JSON.stringify(logEntry));
}

// ========== MCP Server Setup ==========

const server = new Server(
  {
    name: 'confluence-mcp-server',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// ========== Tool Definitions ==========

const TOOLS = [
  // Connection / Diagnostics
  {
    name: 'confluence_ping',
    description: 'Test connection to Confluence server and verify authentication',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'confluence_whoami',
    description: 'Get information about the authenticated user',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'confluence_list_spaces',
    description: 'List Confluence spaces accessible to the authenticated user',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of results to return (default: 25, max: 100)',
          default: 25
        },
        start: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
          default: 0
        }
      }
    }
  },

  // Search / Discovery
  {
    name: 'confluence_search',
    description: 'Search for content using CQL (Confluence Query Language)',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'CQL query string (e.g., "type=page AND space=TEAM AND title~\\"API\\"")'
        },
        limit: {
          type: 'number',
          description: 'Number of results (default: 25, max: 100)',
          default: 25
        },
        start: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
          default: 0
        }
      },
      required: ['query']
    }
  },
  {
    name: 'confluence_get_page_by_title',
    description: 'Find a page by exact title in a specific space',
    inputSchema: {
      type: 'object',
      properties: {
        spaceKey: {
          type: 'string',
          description: 'Space key (e.g., "TEAM", "DOCS")'
        },
        title: {
          type: 'string',
          description: 'Exact page title'
        }
      },
      required: ['spaceKey', 'title']
    }
  },
  {
    name: 'confluence_list_pages',
    description: 'List pages in a specific space',
    inputSchema: {
      type: 'object',
      properties: {
        spaceKey: {
          type: 'string',
          description: 'Space key (e.g., "TEAM", "DOCS")'
        },
        limit: {
          type: 'number',
          description: 'Number of results (default: 25)',
          default: 25
        },
        start: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
          default: 0
        }
      },
      required: ['spaceKey']
    }
  },

  // Read
  {
    name: 'confluence_get_page',
    description: 'Get full page content and metadata by page ID',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Confluence page ID'
        },
        includeBody: {
          type: 'boolean',
          description: 'Include page body content (default: true)',
          default: true
        }
      },
      required: ['pageId']
    }
  },
  {
    name: 'confluence_get_page_metadata',
    description: 'Get page metadata without body content',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Confluence page ID'
        }
      },
      required: ['pageId']
    }
  },
  {
    name: 'confluence_get_children',
    description: 'Get child pages of a page',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Parent page ID'
        },
        limit: {
          type: 'number',
          description: 'Number of results (default: 25)',
          default: 25
        },
        start: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
          default: 0
        }
      },
      required: ['pageId']
    }
  },

  // Write / Manage (only if enabled)
  ...(CONFIG.writeEnabled ? [
    {
      name: 'confluence_create_page',
      description: 'Create a new Confluence page',
      inputSchema: {
        type: 'object',
        properties: {
          spaceKey: {
            type: 'string',
            description: 'Space key where page will be created'
          },
          title: {
            type: 'string',
            description: 'Page title'
          },
          body: {
            type: 'string',
            description: 'Page content in Confluence storage format (HTML)'
          },
          parentId: {
            type: 'string',
            description: 'Optional parent page ID'
          },
          dryRun: {
            type: 'boolean',
            description: 'Preview changes without creating (default: false)',
            default: false
          }
        },
        required: ['spaceKey', 'title', 'body']
      }
    },
    {
      name: 'confluence_update_page',
      description: 'Update an existing Confluence page',
      inputSchema: {
        type: 'object',
        properties: {
          pageId: {
            type: 'string',
            description: 'Page ID to update'
          },
          title: {
            type: 'string',
            description: 'New title (optional)'
          },
          body: {
            type: 'string',
            description: 'New body content (optional)'
          },
          dryRun: {
            type: 'boolean',
            description: 'Preview changes without updating (default: false)',
            default: false
          }
        },
        required: ['pageId']
      }
    },
    {
      name: 'confluence_add_labels',
      description: 'Add labels to a page',
      inputSchema: {
        type: 'object',
        properties: {
          pageId: {
            type: 'string',
            description: 'Page ID'
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of label names to add'
          },
          dryRun: {
            type: 'boolean',
            description: 'Preview changes without adding (default: false)',
            default: false
          }
        },
        required: ['pageId', 'labels']
      }
    },
    {
      name: 'confluence_remove_labels',
      description: 'Remove labels from a page',
      inputSchema: {
        type: 'object',
        properties: {
          pageId: {
            type: 'string',
            description: 'Page ID'
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of label names to remove'
          },
          dryRun: {
            type: 'boolean',
            description: 'Preview changes without removing (default: false)',
            default: false
          }
        },
        required: ['pageId', 'labels']
      }
    },
    {
      name: 'confluence_archive_page',
      description: 'Archive a Confluence page',
      inputSchema: {
        type: 'object',
        properties: {
          pageId: {
            type: 'string',
            description: 'Page ID to archive'
          },
          dryRun: {
            type: 'boolean',
            description: 'Preview changes without archiving (default: false)',
            default: false
          }
        },
        required: ['pageId']
      }
    }
  ] : []),

  // Best Practices
  {
    name: 'confluence_lint_page',
    description: 'Check a page for best practice violations',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Page ID to lint'
        }
      },
      required: ['pageId']
    }
  },
  {
    name: 'confluence_suggest_improvements',
    description: 'Get actionable improvement suggestions for a page',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Page ID to analyze'
        }
      },
      required: ['pageId']
    }
  }
];

// ========== Tool Handlers ==========

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    // Check space allowlist for write operations
    if (CONFIG.allowedSpaces && name.startsWith('confluence_create') || name.startsWith('confluence_update')) {
      const spaceKey = args.spaceKey;
      if (spaceKey && !CONFIG.allowedSpaces.includes(spaceKey)) {
        throw new Error(`Space "${spaceKey}" is not in the allowed spaces list`);
      }
    }

    // Execute tool
    switch (name) {
      // Connection / Diagnostics
      case 'confluence_ping':
        result = await confluenceClient.ping();
        break;

      case 'confluence_whoami':
        result = await confluenceClient.whoami();
        break;

      case 'confluence_list_spaces':
        result = await confluenceClient.listSpaces(args.limit, args.start);
        break;

      // Search / Discovery
      case 'confluence_search':
        result = await confluenceClient.search(args.query, args.limit, args.start);
        break;

      case 'confluence_get_page_by_title':
        result = await confluenceClient.getPageByTitle(args.spaceKey, args.title);
        break;

      case 'confluence_list_pages':
        result = await confluenceClient.listPages(args.spaceKey, args.limit, args.start);
        break;

      // Read
      case 'confluence_get_page':
        const expand = args.includeBody !== false
          ? 'body.storage,version,space,history,metadata.labels'
          : 'version,space,history,metadata.labels';
        result = await confluenceClient.getPage(args.pageId, expand);
        break;

      case 'confluence_get_page_metadata':
        result = await confluenceClient.getPageMetadata(args.pageId);
        break;

      case 'confluence_get_children':
        result = await confluenceClient.getChildren(args.pageId, args.limit, args.start);
        break;

      // Write / Manage
      case 'confluence_create_page':
        if (!CONFIG.writeEnabled) {
          throw new Error('Write operations are disabled. Set CONFLUENCE_WRITE_ENABLED=true to enable.');
        }
        result = await confluenceClient.createPage(
          args.spaceKey,
          args.title,
          args.body,
          args.parentId,
          args.dryRun
        );
        break;

      case 'confluence_update_page':
        if (!CONFIG.writeEnabled) {
          throw new Error('Write operations are disabled. Set CONFLUENCE_WRITE_ENABLED=true to enable.');
        }
        result = await confluenceClient.updatePage(
          args.pageId,
          { title: args.title, body: args.body },
          args.dryRun
        );
        break;

      case 'confluence_add_labels':
        if (!CONFIG.writeEnabled) {
          throw new Error('Write operations are disabled. Set CONFLUENCE_WRITE_ENABLED=true to enable.');
        }
        result = await confluenceClient.addLabels(args.pageId, args.labels, args.dryRun);
        break;

      case 'confluence_remove_labels':
        if (!CONFIG.writeEnabled) {
          throw new Error('Write operations are disabled. Set CONFLUENCE_WRITE_ENABLED=true to enable.');
        }
        result = await confluenceClient.removeLabels(args.pageId, args.labels, args.dryRun);
        break;

      case 'confluence_archive_page':
        if (!CONFIG.writeEnabled) {
          throw new Error('Write operations are disabled. Set CONFLUENCE_WRITE_ENABLED=true to enable.');
        }
        result = await confluenceClient.archivePage(args.pageId, args.dryRun);
        break;

      // Best Practices
      case 'confluence_lint_page':
        result = await lintPage(confluenceClient, args.pageId);
        break;

      case 'confluence_suggest_improvements':
        result = await suggestImprovements(confluenceClient, args.pageId);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Audit log success
    auditLog(name, args, result);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    // Audit log error
    auditLog(name, args, null, error);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            tool: name,
            params: args
          }, null, 2)
        }
      ],
      isError: true
    };
  }
});

// ========== Start Server ==========

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Confluence MCP Server running on stdio');
  console.error(`Connected to: ${CONFIG.baseUrl}`);
  console.error(`Write operations: ${CONFIG.writeEnabled ? 'ENABLED' : 'DISABLED'}`);
  if (CONFIG.allowedSpaces) {
    console.error(`Allowed spaces: ${CONFIG.allowedSpaces.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

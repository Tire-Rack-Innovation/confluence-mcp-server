/**
 * Confluence REST API Client for Confluence Cloud
 * Handles all API interactions with proper authentication and error handling
 */

import fetch from 'node-fetch';

export class ConfluenceClient {
  constructor(baseUrl, email, apiToken) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.email = email;
    this.apiToken = apiToken;

    // Create base64 encoded auth string
    this.authHeader = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
  }

  /**
   * Make an authenticated API request
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/wiki/rest/api${endpoint}`;

    const headers = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers
    };

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(url, config);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || '5';
        throw new Error(`Rate limited. Retry after ${retryAfter} seconds`);
      }

      // Parse response
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        data = { raw: text };
      }

      if (!response.ok) {
        throw new Error(
          `Confluence API error (${response.status}): ${data.message || response.statusText}`
        );
      }

      return data;
    } catch (error) {
      if (error.code === 'ENOTFOUND') {
        throw new Error(`Cannot reach Confluence at ${this.baseUrl}. Check your CONFLUENCE_BASE_URL.`);
      }
      throw error;
    }
  }

  // ========== Connection / Diagnostics ==========

  /**
   * Ping the server and return basic info
   */
  async ping() {
    try {
      const user = await this.whoami();
      return {
        ok: true,
        baseUrl: this.baseUrl,
        authenticated: true,
        user: user.displayName
      };
    } catch (error) {
      return {
        ok: false,
        baseUrl: this.baseUrl,
        authenticated: false,
        error: error.message
      };
    }
  }

  /**
   * Get current user info
   */
  async whoami() {
    const data = await this.request('/user/current');
    return {
      accountId: data.accountId,
      email: data.email,
      displayName: data.displayName,
      profilePicture: data.profilePicture?.path
    };
  }

  /**
   * List spaces the user has access to
   */
  async listSpaces(limit = 25, start = 0) {
    const data = await this.request(`/space?limit=${limit}&start=${start}`);
    return {
      results: data.results.map(space => ({
        id: space.id,
        key: space.key,
        name: space.name,
        type: space.type,
        status: space.status
      })),
      size: data.size,
      start: data.start,
      limit: data.limit,
      hasMore: data._links?.next != null
    };
  }

  // ========== Search / Discovery ==========

  /**
   * Search using CQL (Confluence Query Language)
   */
  async search(cql, limit = 25, start = 0, expand = '') {
    const params = new URLSearchParams({
      cql,
      limit: limit.toString(),
      start: start.toString()
    });

    if (expand) {
      params.append('expand', expand);
    }

    const data = await this.request(`/content/search?${params}`);
    return {
      results: data.results.map(item => ({
        id: item.id,
        type: item.type,
        status: item.status,
        title: item.title,
        spaceKey: item.space?.key,
        spaceName: item.space?.name,
        url: `${this.baseUrl}/wiki${item._links.webui}`,
        lastModified: item.history?.lastUpdated?.when,
        lastModifiedBy: item.history?.lastUpdated?.by?.displayName
      })),
      size: data.size,
      start: data.start,
      limit: data.limit,
      totalSize: data.totalSize
    };
  }

  /**
   * Get page by title in a specific space
   */
  async getPageByTitle(spaceKey, title, expand = 'body.storage,version,space') {
    const cql = `type=page AND space="${spaceKey}" AND title="${title}"`;
    const results = await this.search(cql, 1, 0, expand);

    if (results.results.length === 0) {
      throw new Error(`Page not found: "${title}" in space ${spaceKey}`);
    }

    // Get full page details
    return this.getPage(results.results[0].id, expand);
  }

  /**
   * List pages in a space
   */
  async listPages(spaceKey, limit = 25, start = 0, expand = '') {
    const params = new URLSearchParams({
      spaceKey,
      limit: limit.toString(),
      start: start.toString(),
      type: 'page'
    });

    if (expand) {
      params.append('expand', expand);
    }

    const data = await this.request(`/content?${params}`);
    return {
      results: data.results.map(page => ({
        id: page.id,
        title: page.title,
        type: page.type,
        status: page.status,
        spaceKey: page.space?.key,
        url: `${this.baseUrl}/wiki${page._links.webui}`
      })),
      size: data.size,
      start: data.start,
      limit: data.limit,
      hasMore: data._links?.next != null
    };
  }

  // ========== Read ==========

  /**
   * Get a page by ID
   */
  async getPage(pageId, expand = 'body.storage,version,space,history,metadata.labels') {
    const params = new URLSearchParams({ expand });
    const data = await this.request(`/content/${pageId}?${params}`);

    return {
      id: data.id,
      type: data.type,
      status: data.status,
      title: data.title,
      spaceKey: data.space?.key,
      spaceName: data.space?.name,
      version: data.version?.number,
      versionMessage: data.version?.message,
      body: data.body?.storage?.value,
      bodyFormat: data.body?.storage?.representation,
      url: `${this.baseUrl}/wiki${data._links.webui}`,
      createdBy: data.history?.createdBy?.displayName,
      createdDate: data.history?.createdDate,
      lastModified: data.history?.lastUpdated?.when,
      lastModifiedBy: data.history?.lastUpdated?.by?.displayName,
      labels: data.metadata?.labels?.results?.map(l => l.name) || [],
      ancestorIds: data.ancestors?.map(a => a.id) || []
    };
  }

  /**
   * Get page metadata only
   */
  async getPageMetadata(pageId) {
    const data = await this.request(
      `/content/${pageId}?expand=version,space,history,metadata.labels,ancestors`
    );

    return {
      id: data.id,
      type: data.type,
      status: data.status,
      title: data.title,
      spaceKey: data.space?.key,
      spaceName: data.space?.name,
      version: data.version?.number,
      createdBy: data.history?.createdBy?.displayName,
      createdDate: data.history?.createdDate,
      lastModified: data.history?.lastUpdated?.when,
      lastModifiedBy: data.history?.lastUpdated?.by?.displayName,
      labels: data.metadata?.labels?.results?.map(l => l.name) || [],
      ancestorIds: data.ancestors?.map(a => a.id) || [],
      url: `${this.baseUrl}/wiki${data._links.webui}`
    };
  }

  /**
   * Get child pages
   */
  async getChildren(pageId, limit = 25, start = 0) {
    const params = new URLSearchParams({
      limit: limit.toString(),
      start: start.toString(),
      expand: 'page'
    });

    const data = await this.request(`/content/${pageId}/child/page?${params}`);
    return {
      results: data.page?.results?.map(page => ({
        id: page.id,
        title: page.title,
        type: page.type,
        status: page.status,
        url: `${this.baseUrl}/wiki${page._links.webui}`
      })) || [],
      size: data.page?.size || 0,
      start: data.page?.start || 0,
      limit: data.page?.limit || limit,
      hasMore: data.page?._links?.next != null
    };
  }

  // ========== Write / Manage ==========

  /**
   * Create a new page
   */
  async createPage(spaceKey, title, body, parentId = null, dryRun = false) {
    const payload = {
      type: 'page',
      title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: body,
          representation: 'storage'
        }
      }
    };

    if (parentId) {
      payload.ancestors = [{ id: parentId }];
    }

    if (dryRun) {
      return {
        dryRun: true,
        action: 'create',
        payload
      };
    }

    const data = await this.request('/content', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return {
      id: data.id,
      title: data.title,
      version: data.version.number,
      url: `${this.baseUrl}/wiki${data._links.webui}`
    };
  }

  /**
   * Update a page
   */
  async updatePage(pageId, updates = {}, dryRun = false) {
    // Get current version first
    const current = await this.getPage(pageId, 'version');
    const nextVersion = current.version + 1;

    const payload = {
      version: { number: nextVersion },
      type: 'page'
    };

    if (updates.title) payload.title = updates.title;
    if (updates.body) {
      payload.body = {
        storage: {
          value: updates.body,
          representation: 'storage'
        }
      };
    }

    if (dryRun) {
      return {
        dryRun: true,
        action: 'update',
        pageId,
        currentVersion: current.version,
        nextVersion,
        payload
      };
    }

    const data = await this.request(`/content/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    return {
      id: data.id,
      title: data.title,
      version: data.version.number,
      url: `${this.baseUrl}/wiki${data._links.webui}`
    };
  }

  /**
   * Add labels to a page
   */
  async addLabels(pageId, labels, dryRun = false) {
    const payload = labels.map(name => ({
      prefix: 'global',
      name
    }));

    if (dryRun) {
      return {
        dryRun: true,
        action: 'addLabels',
        pageId,
        labels
      };
    }

    await this.request(`/content/${pageId}/label`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return {
      pageId,
      added: labels,
      success: true
    };
  }

  /**
   * Remove labels from a page
   */
  async removeLabels(pageId, labels, dryRun = false) {
    if (dryRun) {
      return {
        dryRun: true,
        action: 'removeLabels',
        pageId,
        labels
      };
    }

    const results = [];
    for (const label of labels) {
      try {
        await this.request(`/content/${pageId}/label/${label}`, {
          method: 'DELETE'
        });
        results.push({ label, success: true });
      } catch (error) {
        results.push({ label, success: false, error: error.message });
      }
    }

    return {
      pageId,
      results
    };
  }

  /**
   * Archive a page (Confluence Cloud specific)
   */
  async archivePage(pageId, dryRun = false) {
    if (dryRun) {
      return {
        dryRun: true,
        action: 'archive',
        pageId
      };
    }

    // Note: Archive API may vary by Confluence version
    // This uses the status update approach
    const current = await this.getPage(pageId, 'version');

    const payload = {
      version: { number: current.version + 1 },
      type: 'page',
      title: current.title,
      status: 'archived'
    };

    const data = await this.request(`/content/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    return {
      id: data.id,
      title: data.title,
      status: data.status,
      success: true
    };
  }
}

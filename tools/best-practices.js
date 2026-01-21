/**
 * Best Practices Linting and Suggestions for Confluence Pages
 * Checks for common issues and provides recommendations
 */

/**
 * Lint a Confluence page for best practices
 */
export async function lintPage(confluenceClient, pageId) {
  const page = await confluenceClient.getPage(pageId);
  const findings = [];

  // Check 1: Title conventions
  const titleIssues = checkTitleConventions(page.title);
  if (titleIssues.length > 0) {
    findings.push(...titleIssues.map(issue => ({
      severity: 'warning',
      category: 'title',
      message: issue,
      recommendation: 'Use clear, descriptive titles with proper formatting'
    })));
  }

  // Check 2: Missing metadata
  const metadataIssues = checkMetadata(page);
  findings.push(...metadataIssues);

  // Check 3: Content structure
  const structureIssues = checkContentStructure(page.body);
  findings.push(...structureIssues);

  // Check 4: Labels
  const labelIssues = checkLabels(page.labels);
  findings.push(...labelIssues);

  // Check 5: Staleness
  const stalenessIssue = checkStaleness(page.lastModified);
  if (stalenessIssue) findings.push(stalenessIssue);

  // Check 6: Nesting depth
  const nestingIssue = await checkNestingDepth(confluenceClient, pageId, page.ancestorIds);
  if (nestingIssue) findings.push(nestingIssue);

  return {
    pageId,
    pageTitle: page.title,
    url: page.url,
    totalFindings: findings.length,
    findings,
    summary: generateSummary(findings)
  };
}

/**
 * Generate improvement suggestions
 */
export async function suggestImprovements(confluenceClient, pageId) {
  const lintResults = await lintPage(confluenceClient, pageId);
  const suggestions = [];

  for (const finding of lintResults.findings) {
    const suggestion = {
      finding: finding.message,
      severity: finding.severity,
      category: finding.category,
      actions: []
    };

    // Generate actionable suggestions based on category
    switch (finding.category) {
      case 'metadata':
        if (finding.message.includes('owner')) {
          suggestion.actions.push({
            type: 'add_content',
            description: 'Add an "Owner" or "Contact" section at the top',
            example: '<h2>Owner</h2><p>Team: [Your Team Name]<br/>Contact: [email or Slack]</p>'
          });
        }
        if (finding.message.includes('reviewed')) {
          suggestion.actions.push({
            type: 'add_content',
            description: 'Add a "Last Reviewed" section',
            example: '<p><em>Last Reviewed: [Date]</em></p>'
          });
        }
        break;

      case 'labels':
        suggestion.actions.push({
          type: 'add_labels',
          description: 'Add relevant labels from common categories',
          examples: ['documentation', 'runbook', 'process', 'tutorial', 'reference']
        });
        break;

      case 'staleness':
        suggestion.actions.push({
          type: 'review',
          description: 'Review page content for accuracy and relevance',
          details: 'Consider archiving if no longer needed'
        });
        break;

      case 'structure':
        if (finding.message.includes('headings')) {
          suggestion.actions.push({
            type: 'restructure',
            description: 'Add section headings to organize content',
            example: 'Use <h2> for main sections, <h3> for subsections'
          });
        }
        break;

      case 'nesting':
        suggestion.actions.push({
          type: 'reorganize',
          description: 'Consider moving this page higher in the hierarchy',
          details: 'Deep nesting makes pages hard to find'
        });
        break;
    }

    suggestions.push(suggestion);
  }

  return {
    pageId,
    pageTitle: lintResults.pageTitle,
    url: lintResults.url,
    totalSuggestions: suggestions.length,
    suggestions,
    priorityActions: suggestions
      .filter(s => s.severity === 'error' || s.severity === 'warning')
      .map(s => s.finding)
  };
}

// ========== Helper Functions ==========

function checkTitleConventions(title) {
  const issues = [];

  // Too short
  if (title.length < 5) {
    issues.push('Title is too short (less than 5 characters)');
  }

  // Too long
  if (title.length > 100) {
    issues.push('Title is too long (over 100 characters)');
  }

  // All caps
  if (title === title.toUpperCase() && title.length > 5) {
    issues.push('Title is in ALL CAPS (use sentence case instead)');
  }

  // Ends with punctuation (usually bad)
  if (/[.!?]$/.test(title)) {
    issues.push('Title ends with punctuation (usually unnecessary)');
  }

  // Generic titles
  const genericTerms = ['untitled', 'new page', 'draft', 'test', 'temp'];
  if (genericTerms.some(term => title.toLowerCase().includes(term))) {
    issues.push(`Title contains generic term (${title})`);
  }

  return issues;
}

function checkMetadata(page) {
  const issues = [];

  // Check for owner/contact info
  const hasOwnerSection = page.body && (
    /owner/i.test(page.body) ||
    /contact/i.test(page.body) ||
    /maintainer/i.test(page.body)
  );

  if (!hasOwnerSection) {
    issues.push({
      severity: 'warning',
      category: 'metadata',
      message: 'Missing owner or contact information',
      recommendation: 'Add an "Owner" or "Contact" section to identify page maintainers'
    });
  }

  // Check for last reviewed date
  const hasReviewedDate = page.body && /last.{0,10}reviewed/i.test(page.body);

  if (!hasReviewedDate) {
    issues.push({
      severity: 'info',
      category: 'metadata',
      message: 'Missing "Last Reviewed" date',
      recommendation: 'Add a "Last Reviewed" section to track content freshness'
    });
  }

  return issues;
}

function checkContentStructure(body) {
  const issues = [];

  if (!body) {
    issues.push({
      severity: 'error',
      category: 'structure',
      message: 'Page has no content',
      recommendation: 'Add content to the page or consider archiving'
    });
    return issues;
  }

  // Check for headings
  const hasHeadings = /<h[2-4]>/i.test(body);
  if (!hasHeadings && body.length > 500) {
    issues.push({
      severity: 'warning',
      category: 'structure',
      message: 'Long page without section headings',
      recommendation: 'Break content into sections with headings for better readability'
    });
  }

  // Check for very long paragraphs
  const paragraphs = body.split(/<\/p>/i);
  const longParagraphs = paragraphs.filter(p => p.length > 1000);
  if (longParagraphs.length > 0) {
    issues.push({
      severity: 'info',
      category: 'structure',
      message: `${longParagraphs.length} very long paragraph(s) found`,
      recommendation: 'Break long paragraphs into smaller chunks for readability'
    });
  }

  // Check for code blocks without language
  const codeBlocks = body.match(/<ac:structured-macro[^>]*ac:name="code"[^>]*>/gi) || [];
  const codeBlocksWithoutLang = codeBlocks.filter(block =>
    !block.includes('ac:name="language"')
  );

  if (codeBlocksWithoutLang.length > 0) {
    issues.push({
      severity: 'info',
      category: 'structure',
      message: `${codeBlocksWithoutLang.length} code block(s) without language specified`,
      recommendation: 'Specify the programming language for syntax highlighting'
    });
  }

  return issues;
}

function checkLabels(labels) {
  const issues = [];

  if (!labels || labels.length === 0) {
    issues.push({
      severity: 'warning',
      category: 'labels',
      message: 'Page has no labels',
      recommendation: 'Add labels to improve discoverability'
    });
  }

  // Suggest common label categories if missing
  const commonCategories = ['documentation', 'runbook', 'process', 'tutorial', 'reference', 'api', 'troubleshooting'];
  const hasCommonCategory = labels?.some(label =>
    commonCategories.some(cat => label.toLowerCase().includes(cat))
  );

  if (!hasCommonCategory && labels && labels.length > 0) {
    issues.push({
      severity: 'info',
      category: 'labels',
      message: 'No standard category labels found',
      recommendation: `Consider adding category labels: ${commonCategories.join(', ')}`
    });
  }

  return issues;
}

function checkStaleness(lastModified) {
  if (!lastModified) return null;

  const lastModifiedDate = new Date(lastModified);
  const now = new Date();
  const daysSinceUpdate = Math.floor((now - lastModifiedDate) / (1000 * 60 * 60 * 24));

  // Flag if not updated in over a year
  if (daysSinceUpdate > 365) {
    return {
      severity: 'warning',
      category: 'staleness',
      message: `Page hasn't been updated in ${Math.floor(daysSinceUpdate / 365)} year(s)`,
      recommendation: 'Review page for accuracy and relevance, or consider archiving'
    };
  }

  // Info if not updated in 6+ months
  if (daysSinceUpdate > 180) {
    return {
      severity: 'info',
      category: 'staleness',
      message: `Page hasn't been updated in ${Math.floor(daysSinceUpdate / 30)} months`,
      recommendation: 'Consider reviewing page content for accuracy'
    };
  }

  return null;
}

async function checkNestingDepth(confluenceClient, pageId, ancestorIds) {
  const depth = ancestorIds.length;

  // Flag excessive nesting (more than 4 levels deep)
  if (depth > 4) {
    return {
      severity: 'warning',
      category: 'nesting',
      message: `Page is ${depth} levels deep in the hierarchy`,
      recommendation: 'Consider moving to a shallower location for better discoverability'
    };
  }

  return null;
}

function generateSummary(findings) {
  const bySeverity = {
    error: findings.filter(f => f.severity === 'error').length,
    warning: findings.filter(f => f.severity === 'warning').length,
    info: findings.filter(f => f.severity === 'info').length
  };

  const byCategory = findings.reduce((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {});

  return {
    bySeverity,
    byCategory,
    message: findings.length === 0
      ? 'Page follows best practices!'
      : `Found ${findings.length} issue(s): ${bySeverity.error} error(s), ${bySeverity.warning} warning(s), ${bySeverity.info} info`
  };
}

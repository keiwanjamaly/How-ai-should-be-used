/**
 * Tests for FileChangeParser regex patterns and parsing logic
 * Run with: npx ts-node src/__tests__/FileChangeParser.test.ts
 *
 * Since FileChangeParser imports from "obsidian" (unavailable in ts-node),
 * we replicate the core parsing logic here and test the regex patterns directly.
 */

// Simple test assertions (same pattern as DiffService.test.ts)
function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message || "Expected true, got false");
  }
}

function assertFalse(condition: boolean, message?: string): void {
  if (condition) {
    throw new Error(message || "Expected false, got true");
  }
}

function assertNull(value: unknown, message?: string): void {
  if (value !== null) {
    throw new Error(message || `Expected null, got ${JSON.stringify(value)}`);
  }
}

function assertNotNull(value: unknown, message?: string): void {
  if (value === null || value === undefined) {
    throw new Error(message || "Expected non-null value, got null/undefined");
  }
}

// --- Replicated logic from FileChangeParser.ts ---
// These patterns are copied verbatim from the source to test them in isolation.

const hasFileModificationIndicators = [
  /---\n[\s\S]{50,}\n---/, // Content between horizontal rules
  /```(?:markdown|md)?\s*\S*\.\w*\n[\s\S]{50,}```/, // Code block with file extension
  /updated?\s+(?:content|file|note).*:/i, // "Updated content:" header
  /here'?s?\s+(?:the\s+)?updated/i, // "Here's the updated..."
  /changed?\s+.*to\s+/i, // "changed X to Y"
];

function hasFileModification(response: string): boolean {
  return hasFileModificationIndicators.some(pattern => pattern.test(response));
}

interface ParsedChange {
  proposedContent: string;
  description: string;
}

function extractChangeDescription(response: string, contentIndex: number): string {
  const textBefore = response.substring(0, contentIndex).trim();
  const sentences = textBefore.split(/[.!?]\s+/);
  const lastSentence = sentences[sentences.length - 1];
  if (lastSentence.length > 10) {
    return lastSentence.trim();
  }
  return "AI proposed changes";
}

function parseAIResponse(response: string): ParsedChange | null {
  // Pattern 1: Content wrapped in --- (horizontal rules)
  const horizontalRulePattern = /(?:Here'?s?\s+(?:the\s+)?updated\s+(?:note|file).*?)?\n---\n([\s\S]*?)\n---\s*(?:\n|$)/i;
  const hrMatch = response.match(horizontalRulePattern);

  if (hrMatch) {
    const proposedContent = hrMatch[1].trim();
    if (proposedContent.length > 0) {
      return {
        proposedContent,
        description: extractChangeDescription(response, hrMatch.index || 0),
      };
    }
  }

  // Pattern 2: Markdown code blocks with file path in info string
  const codeBlockPattern = /```(?:markdown|md)?\s*(\S+\.\w+)?\n([\s\S]*?)```/;
  const codeMatch = response.match(codeBlockPattern);

  if (codeMatch) {
    const proposedContent = codeMatch[2].trim();
    if (proposedContent.length > 0) {
      return {
        proposedContent,
        description: extractChangeDescription(response, codeMatch.index || 0),
      };
    }
  }

  // Pattern 3: "Updated content:" or similar headers followed by content
  const updateHeaderPattern = /(?:updated?\s+(?:content|file|note)|new\s+(?:content|version))[:\s]\n+([\s\S]{50,})/i;
  const updateMatch = response.match(updateHeaderPattern);

  if (updateMatch) {
    const proposedContent = updateMatch[1].trim();
    if (proposedContent.length >= 50) {
      return {
        proposedContent,
        description: extractChangeDescription(response, updateMatch.index || 0),
      };
    }
  }

  return null;
}

// =============================================
// Tests for hasFileModification
// =============================================

function testHasFileModification_horizontalRules(): void {
  console.log("Test: hasFileModification - horizontal rules indicator");

  const longContent = "A".repeat(60);
  const response = `Here is the result:\n---\n${longContent}\n---`;
  assertTrue(hasFileModification(response), "Should detect content between --- markers with 50+ chars");

  // Short content should NOT trigger (less than 50 chars)
  const shortResponse = `Here:\n---\nShort\n---`;
  assertFalse(hasFileModification(shortResponse), "Should NOT detect short content between --- markers");

  console.log("  PASS");
}

function testHasFileModification_codeBlock(): void {
  console.log("Test: hasFileModification - code block indicator");

  const longContent = "B".repeat(60);
  const response = "```markdown notes.md\n" + longContent + "\n```";
  assertTrue(hasFileModification(response), "Should detect code block with file extension");

  // ```md without a filename does NOT match (pattern requires file extension like notes.md)
  const mdResponse = "```md\n" + longContent + "\n```";
  assertFalse(hasFileModification(mdResponse), "```md without filename should not match (no file extension)");

  console.log("  PASS");
}

function testHasFileModification_updateHeader(): void {
  console.log("Test: hasFileModification - update header indicator");

  assertTrue(
    hasFileModification("Updated content: here it is"),
    "Should detect 'Updated content:'"
  );
  assertTrue(
    hasFileModification("Update file: the new version"),
    "Should detect 'Update file:'"
  );
  assertTrue(
    hasFileModification("Updated note: revised text"),
    "Should detect 'Updated note:'"
  );

  console.log("  PASS");
}

function testHasFileModification_heresTheUpdated(): void {
  console.log("Test: hasFileModification - 'here's the updated' indicator");

  assertTrue(
    hasFileModification("Here's the updated note with your changes."),
    "Should detect \"Here's the updated\""
  );
  assertTrue(
    hasFileModification("Heres the updated version"),
    "Should detect 'Heres the updated' (no apostrophe)"
  );
  // "Here is the updated" does NOT match — pattern only covers here's/heres, not "here is"
  assertFalse(
    hasFileModification("Here is the updated file"),
    "'Here is the updated' should not match (pattern is here'?s?, not 'here is')"
  );
  // BUG: "Here updated" incorrectly matches because both ' and s are optional in here'?s?
  // So `here'?s?\s+(?:the\s+)?updated` matches plain "here updated" as a false positive.
  // Ideally this should be assertFalse, but the current pattern is too permissive.
  assertTrue(
    hasFileModification("Here updated something"),
    "Known false positive: 'here updated' matches due to optional apostrophe and s in regex"
  );

  console.log("  PASS");
}

function testHasFileModification_changedToIndicator(): void {
  console.log("Test: hasFileModification - 'changed X to Y' indicator");

  assertTrue(
    hasFileModification("I changed the title to something new"),
    "Should detect 'changed X to Y'"
  );
  assertTrue(
    hasFileModification("I change the heading to a better one"),
    "Should detect 'change X to Y'"
  );

  console.log("  PASS");
}

function testHasFileModification_falsePositiveProse(): void {
  console.log("Test: hasFileModification - false positive check with normal prose");

  // "I changed my mind to something else" WILL match the /changed?\s+.*to\s+/i regex.
  // This is a known false-positive risk documented in the codebase.
  const proseResponse = "I changed my mind to something else";
  assertTrue(
    hasFileModification(proseResponse),
    "'changed X to Y' pattern matches prose like 'I changed my mind to something else' (known false-positive)"
  );

  // But normal conversation without these patterns should NOT trigger
  assertFalse(
    hasFileModification("Sure, I can help you with that question."),
    "Normal conversation should not trigger"
  );
  assertFalse(
    hasFileModification("The weather is nice today. Let me know if you need anything."),
    "Unrelated prose should not trigger"
  );

  console.log("  PASS");
}

function testHasFileModification_noMatch(): void {
  console.log("Test: hasFileModification - no match for plain text");

  assertFalse(hasFileModification("Hello, how are you?"), "Simple greeting should not match");
  assertFalse(
    hasFileModification("I think the note looks good as is."),
    "Neutral comment should not match"
  );
  assertFalse(hasFileModification(""), "Empty string should not match");

  console.log("  PASS");
}

// =============================================
// Tests for parseAIResponse - Pattern 1 (horizontal rules)
// =============================================

function testParsePattern1_basic(): void {
  console.log("Test: parseAIResponse - Pattern 1 basic horizontal rules");

  const response = `Here's the updated note:\n---\n# My Note\n\nThis is the updated content of the note.\n---`;
  const result = parseAIResponse(response);
  assertNotNull(result);
  assertEqual(result!.proposedContent, "# My Note\n\nThis is the updated content of the note.");

  console.log("  PASS");
}

function testParsePattern1_withoutPrefix(): void {
  console.log("Test: parseAIResponse - Pattern 1 without 'Here's the updated' prefix");

  const response = `I made some changes.\n---\nContent between horizontal rules here.\n---`;
  const result = parseAIResponse(response);
  assertNotNull(result);
  assertEqual(result!.proposedContent, "Content between horizontal rules here.");

  console.log("  PASS");
}

function testParsePattern1_yamlFrontmatter(): void {
  console.log("Test: parseAIResponse - Pattern 1 YAML frontmatter false positive");

  // YAML frontmatter in Obsidian notes uses --- delimiters.
  // A standalone YAML block should be matched by Pattern 1 since
  // the regex doesn't distinguish frontmatter from content markers.
  const yamlNote = `---\ntitle: My Note\ndate: 2024-01-01\ntags: [test, obsidian]\n---\n\n# My Note\n\nSome content here.`;

  // This tests what happens when a YAML frontmatter block is at the beginning.
  // The pattern requires \n---\n so the leading --- won't start a match,
  // but the closing --- may interact with content after it.
  const aiResponse = `Here is the note:\n${yamlNote}`;
  const result = parseAIResponse(aiResponse);

  // The regex /\n---\n([\s\S]*?)\n---/ will match from the first \n---\n
  // to the second \n---. The captured content is the YAML body.
  if (result !== null) {
    // It matched the YAML frontmatter block as "content" - this is a known
    // limitation when YAML frontmatter appears in AI responses.
    assertTrue(
      result.proposedContent.includes("title:"),
      "If matched, it captured the YAML frontmatter body"
    );
  }

  console.log("  PASS");
}

function testParsePattern1_emptyContent(): void {
  console.log("Test: parseAIResponse - Pattern 1 empty content between markers");

  const response = `Here:\n---\n\n---`;
  const result = parseAIResponse(response);
  // Empty/whitespace-only content should be skipped (trimmed length == 0)
  assertNull(result);

  console.log("  PASS");
}

// =============================================
// Tests for parseAIResponse - Pattern 2 (code blocks)
// =============================================

function testParsePattern2_markdownCodeBlock(): void {
  console.log("Test: parseAIResponse - Pattern 2 markdown code block");

  const response = "I updated the note. Here it is:\n```markdown notes.md\n# Updated Title\n\nNew paragraph content.\n```";
  const result = parseAIResponse(response);
  assertNotNull(result);
  assertEqual(result!.proposedContent, "# Updated Title\n\nNew paragraph content.");

  console.log("  PASS");
}

function testParsePattern2_mdInfoString(): void {
  console.log("Test: parseAIResponse - Pattern 2 ```md code block");

  const response = "```md\n# A heading\n\nSome body text goes here.\n```";
  const result = parseAIResponse(response);
  assertNotNull(result);
  assertEqual(result!.proposedContent, "# A heading\n\nSome body text goes here.");

  console.log("  PASS");
}

function testParsePattern2_noInfoString(): void {
  console.log("Test: parseAIResponse - Pattern 2 code block without info string");

  const response = "```\n# Plain Code Block\n\nContent without specifying language.\n```";
  const result = parseAIResponse(response);
  // The regex /```(?:markdown|md)?\s*(\S+\.\w+)?\n/ should still match a bare ```
  assertNotNull(result);
  assertEqual(result!.proposedContent, "# Plain Code Block\n\nContent without specifying language.");

  console.log("  PASS");
}

function testParsePattern2_emptyCodeBlock(): void {
  console.log("Test: parseAIResponse - Pattern 2 empty code block");

  const response = "```markdown\n\n```";
  const result = parseAIResponse(response);
  assertNull(result);

  console.log("  PASS");
}

// =============================================
// Tests for parseAIResponse - Pattern 3 (update header)
// =============================================

function testParsePattern3_updatedContent(): void {
  console.log("Test: parseAIResponse - Pattern 3 'Updated content:' with 50+ chars");

  const longContent = "This is the updated content that should be long enough to pass the fifty character minimum threshold for detection.";
  const response = `Updated content:\n${longContent}`;
  const result = parseAIResponse(response);
  assertNotNull(result);
  assertEqual(result!.proposedContent, longContent);

  console.log("  PASS");
}

function testParsePattern3_newVersion(): void {
  console.log("Test: parseAIResponse - Pattern 3 'New version:' variant");

  const longContent = "This is a completely new version of the document that has been rewritten with additional context and details for clarity.";
  const response = `New version:\n${longContent}`;
  const result = parseAIResponse(response);
  assertNotNull(result);
  assertEqual(result!.proposedContent, longContent);

  console.log("  PASS");
}

function testParsePattern3_belowThreshold(): void {
  console.log("Test: parseAIResponse - Pattern 3 below 50-char threshold");

  // Content under 50 chars should NOT match
  const shortContent = "Short text that is not enough.";
  assertTrue(shortContent.length < 50, "Test content must be under 50 chars");
  const response = `Updated content:\n${shortContent}`;
  const result = parseAIResponse(response);
  assertNull(result);

  console.log("  PASS");
}

function testParsePattern3_exactlyAtThreshold(): void {
  console.log("Test: parseAIResponse - Pattern 3 exactly at 50-char threshold");

  // The regex requires [\s\S]{50,} and then trimmed length >= 50
  const content50 = "A".repeat(50);
  assertEqual(content50.length, 50, "Content should be exactly 50 chars");
  const response = `Updated content:\n${content50}`;
  const result = parseAIResponse(response);
  assertNotNull(result);
  assertEqual(result!.proposedContent, content50);

  console.log("  PASS");
}

function testParsePattern3_49charsRejected(): void {
  console.log("Test: parseAIResponse - Pattern 3 49-char content rejected");

  const content49 = "A".repeat(49);
  assertEqual(content49.length, 49, "Content should be exactly 49 chars");
  const response = `Updated content:\n${content49}`;
  const result = parseAIResponse(response);
  // The regex [\s\S]{50,} won't match 49 chars, so pattern 3 won't fire
  assertNull(result);

  console.log("  PASS");
}

// =============================================
// Tests for parseAIResponse - null activeFile
// =============================================

function testParseNoMatch(): void {
  console.log("Test: parseAIResponse - no match in plain text");

  const result = parseAIResponse("Just a normal response without any file content.");
  assertNull(result);

  console.log("  PASS");
}

// =============================================
// Tests for extractChangeDescription
// =============================================

function testExtractDescription_lastSentence(): void {
  console.log("Test: extractChangeDescription - pulls last sentence before content");

  const response = "I reviewed your note. Here are my suggested improvements for the document.\n---\nSome content\n---";
  const result = parseAIResponse(response);
  assertNotNull(result);
  // The last sentence before the content should be extracted
  assertTrue(
    result!.description.includes("Here are my suggested improvements"),
    `Description should contain last sentence, got: "${result!.description}"`
  );

  console.log("  PASS");
}

function testExtractDescription_shortTextFallback(): void {
  console.log("Test: extractChangeDescription - fallback for short preceding text");

  const response = "OK.\n---\nProposed new content here.\n---";
  const result = parseAIResponse(response);
  assertNotNull(result);
  // "OK" is <= 10 chars, so should fall back to default
  assertEqual(result!.description, "AI proposed changes");

  console.log("  PASS");
}

function testExtractDescription_multiSentence(): void {
  console.log("Test: extractChangeDescription - multiple sentences picks last");

  const response = "First I analyzed the note. Then I rewrote the introduction. Finally I restructured the conclusion section.\n---\nRestructured content goes here.\n---";
  const result = parseAIResponse(response);
  assertNotNull(result);
  assertTrue(
    result!.description.includes("restructured the conclusion"),
    `Should pick last sentence, got: "${result!.description}"`
  );

  console.log("  PASS");
}

// =============================================
// Test runner
// =============================================

function runTests(): void {
  console.log("\n=== FileChangeParser Tests ===\n");

  const tests = [
    // hasFileModification tests
    testHasFileModification_horizontalRules,
    testHasFileModification_codeBlock,
    testHasFileModification_updateHeader,
    testHasFileModification_heresTheUpdated,
    testHasFileModification_changedToIndicator,
    testHasFileModification_falsePositiveProse,
    testHasFileModification_noMatch,
    // parseAIResponse Pattern 1 tests
    testParsePattern1_basic,
    testParsePattern1_withoutPrefix,
    testParsePattern1_yamlFrontmatter,
    testParsePattern1_emptyContent,
    // parseAIResponse Pattern 2 tests
    testParsePattern2_markdownCodeBlock,
    testParsePattern2_mdInfoString,
    testParsePattern2_noInfoString,
    testParsePattern2_emptyCodeBlock,
    // parseAIResponse Pattern 3 tests
    testParsePattern3_updatedContent,
    testParsePattern3_newVersion,
    testParsePattern3_belowThreshold,
    testParsePattern3_exactlyAtThreshold,
    testParsePattern3_49charsRejected,
    // No match test
    testParseNoMatch,
    // extractChangeDescription tests
    testExtractDescription_lastSentence,
    testExtractDescription_shortTextFallback,
    testExtractDescription_multiSentence,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (error) {
      failed++;
      console.error(`  FAIL ${test.name}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log("\n=== Test Results ===");
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  if (failed === 0) {
    console.log("\nAll tests passed!");
  } else {
    console.log("\nSome tests failed");
    process.exit(1);
  }
}

runTests();

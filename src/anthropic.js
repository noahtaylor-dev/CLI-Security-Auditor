/**
 * src/anthropic.js — Claude API client for the audit call.
 *
 * Single export: auditDiff(). Sends the diff to the Anthropic Messages API
 * and returns a parsed report object.
 *
 * The structured output is enforced via the tool-use feature, NOT by asking
 * Claude to "return JSON" in a text response. We define a tool called
 * `report_findings` (schema in src/prompt.js) and set
 *   tool_choice: { type: 'tool', name: 'report_findings' }
 * which forces the model to invoke that tool exactly once. The arguments
 * Claude passes to the tool are guaranteed to validate against the JSON
 * schema, so we get a parseable report without ever calling JSON.parse on
 * model-generated text.
 *
 * If you change the report shape, update both the schema AND the rubric in
 * src/prompt.js — they need to stay aligned.
 */
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, TOOL_SCHEMA } from './prompt.js';

/**
 * Send the diff to Claude and return the structured findings report.
 *
 * @param {Object} args
 * @param {string} args.diff      Raw unified diff text from `git diff`.
 * @param {string[]} args.files   List of changed file paths (for context).
 * @param {string} args.model     Anthropic model id, e.g. 'claude-sonnet-4-6'.
 * @param {number} [args.maxTokens=4096]
 *                                Upper bound on the response length. 4096 is
 *                                enough for ~10–15 detailed findings.
 * @returns {Promise<Object>}     The parsed report — shape defined by
 *                                TOOL_SCHEMA in src/prompt.js. Has
 *                                { risk_score, summary, findings[] }.
 * @throws {Error}                If the API key is missing, the network
 *                                call fails, or Claude refuses to use the
 *                                tool.
 */
export async function auditDiff({ diff, files, model, maxTokens = 4096 }) {
  // Fail fast with a friendly message if the user never set up their key.
  // The SDK would throw a less obvious error a few stack frames later.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your environment or create a .env file (see .env.example).'
    );
  }

  // The SDK constructor reads ANTHROPIC_API_KEY from process.env automatically.
  const client = new Anthropic();

  // Assemble the user message. We give Claude the file list for context
  // (so it can mention realistic paths in findings) and then the diff in a
  // ```diff fenced block — this matches how diffs appear in PR reviews,
  // which the model has seen heavily during training.
  const userContent = [
    `Files changed (${files.length}):`,
    ...files.map((f) => `  - ${f}`),
    '',
    'Diff:',
    '```diff',
    diff,
    '```',
  ].join('\n');

  // The actual API call. Key fields:
  //   system       — the security-engineer persona + rubric (src/prompt.js)
  //   tools        — declares the report_findings tool with its JSON schema
  //   tool_choice  — forces Claude to call that tool exactly once, instead
  //                  of replying with prose. This is how we get reliable
  //                  structured output.
  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: 'report_findings' },
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    // Wrap any SDK/network/auth error so the CLI can show a single line
    // instead of a multi-frame stack trace.
    throw new Error(`Anthropic API error: ${err.message}`);
  }

  // The response is an array of content blocks. With forced tool_choice we
  // expect a single tool_use block; we still scan defensively in case the
  // SDK ever interleaves a thinking block before it.
  const toolUse = response.content.find(
    (block) => block.type === 'tool_use' && block.name === 'report_findings'
  );
  if (!toolUse) {
    // Should be unreachable while tool_choice is honoured, but guard anyway.
    throw new Error('Claude did not return a report_findings tool call.');
  }

  // .input is the already-parsed JSON object that Claude passed as the
  // tool's arguments. Schema-validated by the API, so safe to consume.
  return toolUse.input;
}

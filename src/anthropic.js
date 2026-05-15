import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, TOOL_SCHEMA } from './prompt.js';

export async function auditDiff({ diff, files, model, maxTokens = 4096 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your environment or create a .env file (see .env.example).'
    );
  }

  const client = new Anthropic();

  const userContent = [
    `Files changed (${files.length}):`,
    ...files.map((f) => `  - ${f}`),
    '',
    'Diff:',
    '```diff',
    diff,
    '```',
  ].join('\n');

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
    throw new Error(`Anthropic API error: ${err.message}`);
  }

  const toolUse = response.content.find(
    (block) => block.type === 'tool_use' && block.name === 'report_findings'
  );
  if (!toolUse) {
    throw new Error('Claude did not return a report_findings tool call.');
  }

  return toolUse.input;
}

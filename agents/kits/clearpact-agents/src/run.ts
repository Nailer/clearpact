import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { MODEL } from './config';
import { resetRecorder, getRecordedCalls, type RecordedCall } from './tools';

export type AgentTurnResult = {
  text: string;
  toolCalls: RecordedCall[];
  costUsd: number;
};

/**
 * Run a single non-interactive agent turn: system prompt + role-scoped MCP
 * server, every tool auto-approved (a controlled testnet demo with bounded
 * escrow amounts — no human-in-the-loop pause needed, unlike the upstream
 * kit's interactive spend confirmation).
 */
export async function runAgent(
  systemPrompt: string,
  userPrompt: string,
  mcpServer: ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer>,
  serverName: string,
): Promise<AgentTurnResult> {
  resetRecorder();

  const options: Options = {
    model: MODEL,
    systemPrompt,
    mcpServers: { [serverName]: mcpServer },
    tools: [],
    canUseTool: async (_toolName, input) => ({ behavior: 'allow', updatedInput: input }),
    permissionMode: 'default',
    settingSources: [],
  };

  let text = '';
  let costUsd = 0;

  for await (const msg of query({ prompt: userPrompt, options }) as AsyncIterable<SDKMessage>) {
    if (msg.type === 'assistant') {
      const content = msg.message.content;
      const blocks = Array.isArray(content) ? content : [];
      for (const block of blocks) {
        if (block.type === 'text') text += block.text;
      }
    }
    if (msg.type === 'result' && msg.subtype === 'success') {
      costUsd = msg.total_cost_usd;
    }
  }

  return { text: text.trim(), toolCalls: getRecordedCalls(), costUsd };
}

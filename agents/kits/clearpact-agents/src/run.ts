import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { MODEL } from './config';

export type AgentTurnResult = {
  text: string;
  toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
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
  const options: Options = {
    model: MODEL,
    systemPrompt,
    mcpServers: { [serverName]: mcpServer },
    tools: [],
    canUseTool: async (_toolName, input) => ({ behavior: 'allow', updatedInput: input }),
    permissionMode: 'default',
    settingSources: [],
  };

  const toolCalls: AgentTurnResult['toolCalls'] = [];
  let text = '';
  let costUsd = 0;

  for await (const msg of query({ prompt: userPrompt, options }) as AsyncIterable<SDKMessage>) {
    if (msg.type === 'assistant') {
      const content = msg.message.content;
      const blocks = Array.isArray(content) ? content : [];
      for (const block of blocks) {
        if (block.type === 'text') text += block.text;
        if (block.type === 'tool_use') toolCalls.push({ tool: block.name, input: block.input, output: undefined });
      }
    }
    if (msg.type === 'user') {
      const content = (msg.message as any).content;
      const blocks = Array.isArray(content) ? content : [];
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          const last = toolCalls[toolCalls.length - 1];
          if (last && last.output === undefined) {
            const c = block.content;
            last.output = Array.isArray(c) ? c.map((x: any) => x.text).join('') : c;
          }
        }
      }
    }
    if (msg.type === 'result' && msg.subtype === 'success') {
      costUsd = msg.total_cost_usd;
    }
  }

  return { text: text.trim(), toolCalls, costUsd };
}

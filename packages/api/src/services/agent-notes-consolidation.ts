import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getAgentConfig } from './agent.js';
import { listNotes, updateNoteContent, deleteNote, type AgentNote } from './agent-notes.js';

const CONSOLIDATE_MAX_NOTES = 100;
const CONSOLIDATE_CONTENT_LENGTH = 300;

function formatNotesForConsolidation(notes: AgentNote[]): string {
  if (notes.length === 0) return 'No notes.';
  const limited = notes.slice(0, CONSOLIDATE_MAX_NOTES);
  return limited
    .map((n, i) => {
      const content = n.content.length <= CONSOLIDATE_CONTENT_LENGTH 
        ? n.content 
        : n.content.slice(0, CONSOLIDATE_CONTENT_LENGTH) + '…';
      return `${i + 1}. noteId: ${n.noteId}\n   category: ${n.category}\n   content: ${content}${n.patientName ? `\n   user: ${n.patientName}` : ''}\n   createdAt: ${n.createdAt ? new Date(n.createdAt).toLocaleString() : 'unknown'}`;
    })
    .join('\n\n');
}

/**
 * Run consolidation for agent notes: review all notes and merge duplicates/similar ones.
 * Returns the number of notes that were consolidated (merged or deleted).
 */
export async function consolidateNotes(tenantId: string): Promise<{ notesConsolidated: number }> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return { notesConsolidated: 0 };

  const config = await getAgentConfig(tenantId);
  const notes = await listNotes(tenantId, { limit: CONSOLIDATE_MAX_NOTES });
  if (notes.length === 0) return { notesConsolidated: 0 };

  const model = new ChatGoogleGenerativeAI({
    model: config.model,
    temperature: 0.3,
    apiKey,
  });

  const notesBlock = formatNotesForConsolidation(notes);
  const defaultConsolidationPrompt = `You are consolidating the Agent Notebook: analytics and insights tracked during conversations. Your task is to find notes that are about the SAME topic, are duplicates, or contain overlapping information (e.g. multiple notes about "users asking about appointment booking" or "keyword trend: insurance").

Below are the current notes (noteId, category, content, user, createdAt).

Instructions:
1) Identify groups of notes that cover the same topic or are clearly duplicates/similar (e.g. same common question, same keyword trend, same insight).
2) For each group: choose ONE note to keep as the single source of truth. Use merge_notes to update that note's content with consolidated, merged information (combine the facts, remove redundancy, keep the most up-to-date or comprehensive details). Use delete_note on the OTHER notes in the group so they are removed (redundant).
3) Do not add new notes. Only use merge_notes and delete_note.
4) If a note has no duplicates or related notes, leave it unchanged (do not call any tool for it).
5) Be conservative: only consolidate when notes are clearly about the same thing. When in doubt, leave as is.
6) When merging, preserve important details from all notes in the group. Combine timestamps or mention frequency if relevant.

--- Current notes ---
${notesBlock}
--- End of notes ---

Review the list above and consolidate duplicate or overlapping notes.`;

  let systemContent: string;
  if (config.consolidationPrompt?.trim()) {
    const customPrompt = config.consolidationPrompt.trim();
    // Replace placeholders if present, otherwise append notes block
    let prompt = customPrompt;
    if (prompt.includes('{recordsBlock}')) {
      prompt = prompt.replace('{recordsBlock}', notesBlock);
    }
    if (prompt.includes('{notesBlock}')) {
      prompt = prompt.replace('{notesBlock}', notesBlock);
    }
    if (!prompt.includes(notesBlock)) {
      prompt = `${prompt}\n\n--- Current notes ---\n${notesBlock}\n--- End of notes ---`;
    }
    systemContent = prompt;
  } else {
    systemContent = defaultConsolidationPrompt;
  }

  const mergeNotesTool = new DynamicStructuredTool({
    name: 'merge_notes',
    description: 'Merge multiple notes into one. Update the primary note with consolidated content and mark other notes for deletion.',
    schema: z.object({
      keepNoteId: z.string().describe('The noteId of the note to keep (will be updated with merged content)'),
      deleteNoteIds: z.array(z.string()).describe('Array of noteIds to delete (redundant notes being merged into the primary one)'),
      mergedContent: z.string().describe('The consolidated content combining information from all notes in the group'),
    }),
    func: async ({ keepNoteId, deleteNoteIds, mergedContent }) => {
      try {
        // Update the primary note with merged content
        await updateNoteContent(tenantId, keepNoteId, mergedContent);
        // Delete the redundant notes
        for (const noteId of deleteNoteIds) {
          await deleteNote(tenantId, noteId);
        }
        return `Merged ${deleteNoteIds.length + 1} notes. Kept note ${keepNoteId}, deleted ${deleteNoteIds.length} redundant notes.`;
      } catch (e) {
        console.error('merge_notes error:', e);
        return e instanceof Error ? e.message : 'Failed to merge notes.';
      }
    },
  });

  const deleteNoteTool = new DynamicStructuredTool({
    name: 'delete_note',
    description: 'Delete a redundant note that is a duplicate or has been merged into another note.',
    schema: z.object({
      noteId: z.string().describe('The noteId of the note to delete'),
      reason: z.string().optional().describe('Brief reason for deletion (e.g. "duplicate of note X" or "merged into note Y")'),
    }),
    func: async ({ noteId, reason }) => {
      try {
        const deleted = await deleteNote(tenantId, noteId);
        if (!deleted) return 'Note not found or already deleted.';
        return `Note ${noteId} deleted${reason ? `: ${reason}` : ''}.`;
      } catch (e) {
        console.error('delete_note error:', e);
        return e instanceof Error ? e.message : 'Failed to delete note.';
      }
    },
  });

  const messages: BaseMessage[] = [
    new SystemMessage(systemContent),
    new HumanMessage({ content: 'Please review the notes and consolidate any that are duplicates or cover the same topic. Merge related notes and delete redundant ones.' }),
  ];

  const modelWithTools = model.bindTools([mergeNotesTool, deleteNoteTool]);
  let currentMessages: BaseMessage[] = messages;
  const maxToolRounds = 5;
  let notesConsolidated = 0;
  let response: BaseMessage = await modelWithTools.invoke(currentMessages);

  for (let round = 0; round < maxToolRounds; round++) {
    const toolCalls = (response as { tool_calls?: Array<{ id: string; name: string; args?: Record<string, unknown> }> }).tool_calls;
    if (!toolCalls?.length) break;
    const toolMessages: ToolMessage[] = [];
    for (const tc of toolCalls) {
      let content: string;
      if (tc.name === 'merge_notes' && tc.args && typeof tc.args.keepNoteId === 'string' && Array.isArray(tc.args.deleteNoteIds)) {
        try {
          const mergedContent = typeof tc.args.mergedContent === 'string' ? tc.args.mergedContent : '';
          const deleteNoteIds = (tc.args.deleteNoteIds as string[]).filter((id): id is string => typeof id === 'string');
          content = await mergeNotesTool.invoke({
            keepNoteId: tc.args.keepNoteId,
            deleteNoteIds,
            mergedContent,
          });
          notesConsolidated += deleteNoteIds.length + 1; // Count merged notes
        } catch (e) {
          console.error('merge_notes error:', e);
          content = e instanceof Error ? e.message : 'Failed to merge notes.';
        }
      } else if (tc.name === 'delete_note' && tc.args && typeof tc.args.noteId === 'string') {
        try {
          const reason = typeof tc.args.reason === 'string' ? tc.args.reason : undefined;
          content = await deleteNoteTool.invoke({
            noteId: tc.args.noteId,
            reason,
          });
          notesConsolidated += 1;
        } catch (e) {
          console.error('delete_note error:', e);
          content = e instanceof Error ? e.message : 'Failed to delete note.';
        }
      } else {
        content = 'Invalid arguments.';
      }
      toolMessages.push(new ToolMessage({ content, tool_call_id: tc.id }));
    }
    currentMessages = [...currentMessages, response, ...toolMessages];
    response = await modelWithTools.invoke(currentMessages);
  }

  return { notesConsolidated };
}

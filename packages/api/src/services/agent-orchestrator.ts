/**
 * Agent Orchestrator - Deterministic Control Layer
 * 
 * This module implements the orchestrator pattern where:
 * - LLM suggests actions
 * - Orchestrator validates and decides
 * - Tools execute deterministically
 * - State is verified after execution
 * 
 * The LLM does NOT control system state - the orchestrator does.
 */

import { BaseMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getAgentConfig } from './agent.js';
import { getRagContext } from './rag.js';
import { createRecord, createModificationRequest, getRecord, listRecords } from './auto-agent-brain.js';
import { isGoogleConnected, fetchSheetData, appendSheetRow, getSheetRows, updateSheetRow } from './google-sheets.js';
import { createNote, listNotes as listAgentNotes, AgentNote } from './agent-notes.js';
import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

// Record agent activity for dashboard visualization
async function recordActivity(tenantId: string, type: string): Promise<void> {
  try {
    await db.collection('agent_activities').add({
      tenantId,
      type,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('Failed to record activity:', e);
  }
}

// ============================================================================
// STRICT TOOL CONTRACTS
// ============================================================================

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  verified?: boolean; // Whether the action was verified after execution
  action?: 'read' | 'write' | 'delete' | 'edit' | 'query' | 'create'; // Type of action performed
  timestamp?: Date; // When the action was executed
}

export interface BookAppointmentResult extends ToolResult {
  success: boolean;
  data?: {
    appointmentId: string;
    date: string;
    doctor: string;
    time: string;
    action: 'created' | 'updated';
  };
  error?: string;
  verified?: boolean;
  action?: 'write';
  timestamp?: Date;
}

export interface GetAppointmentResult extends ToolResult {
  success: boolean;
  data?: {
    found: boolean;
    appointmentId?: string;
    date?: string;
    patientName?: string;
    phone?: string;
    doctor?: string;
    time?: string;
    notes?: string;
  };
  error?: string;
  verified?: boolean;
  action?: 'read';
  timestamp?: Date;
}

export interface QuerySheetResult extends ToolResult {
  success: boolean;
  data?: string; // Markdown table
  error?: string;
  verified?: boolean;
  action?: 'read';
  timestamp?: Date;
}

export interface RecordKnowledgeResult extends ToolResult {
  success: boolean;
  error?: string;
  verified?: boolean;
  action?: 'write';
  timestamp?: Date;
}

export interface CreateNoteResult extends ToolResult {
  success: boolean;
  error?: string;
  verified?: boolean;
  action?: 'create';
  timestamp?: Date;
}

// ============================================================================
// TOOL EXECUTOR - Deterministic execution with strict contracts
// ============================================================================

export class ToolExecutor {
  constructor(
    private tenantId: string,
    private bookingsSheetEntry?: { spreadsheetId: string; range?: string }
  ) {}

  /** Normalize phone to digits only for duplicate detection. */
  private normalizePhone(phone: string): string {
    return (phone ?? '').replace(/\D/g, '');
  }

  /** Normalize a cell value to YYYY-MM-DD for comparison. */
  private normalizeDateForComparison(cell: unknown): string {
    if (cell == null) return '';
    const s = String(cell).trim();
    if (!s) return '';
    const num = Number(s);
    if (!Number.isNaN(num) && num > 10000) {
      const d = new Date((num - 25569) * 86400 * 1000);
      return d.toISOString().slice(0, 10);
    }
    const iso = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return '';
  }

  async executeBookAppointment(params: {
    date: string;
    patientName: string;
    phone: string;
    doctorName: string;
    appointmentTime: string;
    notes?: string;
  }): Promise<BookAppointmentResult> {
    if (!this.bookingsSheetEntry) {
      return {
        success: false,
        error: 'Bookings sheet not configured',
      };
    }

    const dateStr = /today/i.test(params.date) ? new Date().toISOString().slice(0, 10) : params.date;
    const row = [
      dateStr,
      params.patientName.trim(),
      params.phone.trim(),
      params.doctorName.trim(),
      params.appointmentTime.trim(),
      (params.notes ?? '').trim(),
    ];

    const sheetRange = this.bookingsSheetEntry.range ?? 'Sheet1';
    const phoneNorm = this.normalizePhone(params.phone);
    if (!phoneNorm) {
      return {
        success: false,
        error: 'Phone number is required',
      };
    }

    try {
      const rows = await getSheetRows(this.tenantId, this.bookingsSheetEntry.spreadsheetId, sheetRange);
      const dataRows = rows.slice(1);
      const targetDateNorm = this.normalizeDateForComparison(dateStr) || dateStr;
      const targetTime = params.appointmentTime.trim();

      // 1. Check for double-booking (same date and time for ANYONE)
      const conflictIndex = dataRows.findIndex((r: string[]) => {
        const rowDateNorm = this.normalizeDateForComparison(r[0]);
        const rowTime = String(r[4] ?? '').trim();
        return rowDateNorm === targetDateNorm && rowTime === targetTime;
      });

      // 2. Check if this specific patient already has a booking on this date
      const existingIndex = dataRows.findIndex((r: string[]) => {
        const rowHasPhone = r.some((cell: string) => this.normalizePhone(String(cell ?? '')) === phoneNorm);
        const rowHasDate = r.some((cell: string) => this.normalizeDateForComparison(cell) === targetDateNorm);
        return rowHasPhone && rowHasDate;
      });

      // If there's a conflict with someone else, prevent booking
      if (conflictIndex >= 0 && conflictIndex !== existingIndex) {
        return {
          success: false,
          error: `Time slot ${targetTime} on ${dateStr} is already booked for another patient.`,
        };
      }

      if (existingIndex >= 0) {
        const sheetRow1Based = existingIndex + 2;
        const result = await updateSheetRow(
          this.tenantId,
          this.bookingsSheetEntry.spreadsheetId,
          sheetRange,
          sheetRow1Based,
          row
        );
        
      if (result.success) {
        // Also record in Agent Notebook (notes)
        try {
          await createNote(this.tenantId, 'SYSTEM', `Booking UPDATED: ${params.patientName} (${params.phone}) with Dr. ${params.doctorName} on ${dateStr} at ${params.appointmentTime}. Notes: ${params.notes ?? 'none'}`, {
            patientName: params.patientName,
            category: 'bookings'
          });
        } catch (noteErr) {
          console.warn('[ToolExecutor] Failed to create note for booking update:', noteErr);
        }

        return {
          success: true,
          data: {
            appointmentId: `APT-${phoneNorm}-${targetDateNorm}`,
            doctor: params.doctorName.trim(),
            time: params.appointmentTime.trim(),
            date: dateStr,
            action: 'updated',
          },
          action: 'write',
          timestamp: new Date(),
        };
      } else {
        return {
          success: false,
          error: result.error,
          action: 'write',
          timestamp: new Date(),
        };
      }
      }

      const result = await appendSheetRow(
        this.tenantId,
        this.bookingsSheetEntry.spreadsheetId,
        sheetRange,
        row
      );

      if (result.success) {
        // Also record in Agent Notebook (notes)
        try {
          await createNote(this.tenantId, 'SYSTEM', `NEW Booking: ${params.patientName} (${params.phone}) with Dr. ${params.doctorName} on ${dateStr} at ${params.appointmentTime}. Notes: ${params.notes ?? 'none'}`, {
            patientName: params.patientName,
            category: 'bookings'
          });
        } catch (noteErr) {
          console.warn('[ToolExecutor] Failed to create note for new booking:', noteErr);
        }

        return {
          success: true,
          data: {
            appointmentId: `APT-${phoneNorm}-${targetDateNorm}`,
            doctor: params.doctorName.trim(),
            time: params.appointmentTime.trim(),
            date: dateStr,
            action: 'created',
          },
          action: 'write',
          timestamp: new Date(),
        };
      } else {
        return {
          success: false,
          error: result.error,
          action: 'write',
          timestamp: new Date(),
        };
      }
    } catch (e) {
      console.error('[ToolExecutor] Book appointment error:', e);
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Failed to record booking',
      };
    }
  }

  async executeGetAppointment(params: {
    phone: string;
    date?: string;
  }): Promise<GetAppointmentResult> {
    if (!this.bookingsSheetEntry) {
      return {
        success: false,
        error: 'Bookings sheet not configured',
      };
    }

    const phoneNorm = this.normalizePhone(params.phone);
    if (!phoneNorm) {
      return {
        success: false,
        error: 'Invalid phone number',
      };
    }

    try {
      const sheetRange = this.bookingsSheetEntry.range ?? 'Sheet1';
      
      let targetDateNorm: string | null = null;
      if (params.date) {
        const dateStr = /today/i.test(params.date) ? new Date().toISOString().slice(0, 10) : params.date;
        targetDateNorm = this.normalizeDateForComparison(dateStr) || dateStr;
      }

      // Retry logic for eventual consistency
      let rows: string[][];
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        rows = await getSheetRows(this.tenantId, this.bookingsSheetEntry!.spreadsheetId, sheetRange);
        
        if (rows.length < 2) {
          if (attempts < maxAttempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            attempts++;
            continue;
          }
          return {
            success: true,
            data: {
              found: false,
            },
            action: 'read',
            timestamp: new Date(),
          };
        }

        const dataRows = rows.slice(1);
        const matches = dataRows.filter((r) => {
          const rowHasPhone = r.some((cell) => {
            const cellPhoneNorm = this.normalizePhone(String(cell ?? ''));
            return cellPhoneNorm === phoneNorm && cellPhoneNorm.length > 0;
          });
          if (!rowHasPhone) return false;
          if (targetDateNorm) {
            const rowHasDate = r.some((cell) => {
              const cellDateNorm = this.normalizeDateForComparison(cell);
              return cellDateNorm === targetDateNorm;
            });
            return rowHasDate;
          }
          return true;
        });

         if (matches.length > 0) {
          const match = matches[0];
          const dateIdx = 0;
          const nameIdx = 1;
          const phoneIdx = 2;
          const doctorIdx = 3;
          const timeIdx = 4;
          const notesIdx = 5;

          const foundDateNorm = this.normalizeDateForComparison(match[dateIdx]) || match[dateIdx];

          return {
            success: true,
            data: {
              found: true,
              appointmentId: `APT-${phoneNorm}-${foundDateNorm}`,
              date: match[dateIdx] || '',
              patientName: match[nameIdx] || '',
              phone: match[phoneIdx] || '',
              doctor: match[doctorIdx] || '',
              time: match[timeIdx] || '',
              notes: match[notesIdx] || '',
            },
            action: 'read',
            timestamp: new Date(),
          };
        }
      }

      // 2. If not found in sheet, check Agent Notebook (notes)
      try {
        const notes = await listAgentNotes(this.tenantId, { patientName: params.phone }); // Using phone as a fallback identifier in notes if needed, or just search by patientName if we had it
        // Better: search for notes containing the phone number
        const allNotes = await listAgentNotes(this.tenantId, { limit: 50 });
        const bookingNote = allNotes.find((n: AgentNote) => n.content.includes(phoneNorm) && (n.content.includes('Booking') || n.content.includes('Appointment')));
        
        if (bookingNote) {
          // Extract info from note content if possible
          const content = bookingNote.content;
          const dateMatch = content.match(/on (\d{4}-\d{2}-\d{2})/);
          const timeMatch = content.match(/at (\d{1,2}:\d{2}\s*(am|pm)?)/i);
          const doctorMatch = content.match(/with Dr\. (.*?)(?= on| at|$)/);
          
          return {
            success: true,
            data: {
              found: true,
              appointmentId: `NOTE-${bookingNote.noteId}`,
              date: dateMatch ? dateMatch[1] : 'unknown',
              patientName: bookingNote.patientName || 'unknown',
              phone: params.phone,
              doctor: doctorMatch ? doctorMatch[1] : 'unknown',
              time: timeMatch ? timeMatch[1] : 'unknown',
              notes: `Found in Agent Notebook: ${content}`,
            },
            action: 'read',
            timestamp: new Date(),
          };
        }
      } catch (noteErr) {
        console.warn('[ToolExecutor] Failed to check notes for appointment:', noteErr);
      }

      return {
        success: true,
        data: {
          found: false,
        },
        action: 'read',
        timestamp: new Date(),
      };
    } catch (e) {
      console.error('[ToolExecutor] Get appointment error:', e);
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Failed to query bookings',
      };
    }
  }

  async executeQuerySheet(params: {
    useWhen: string;
    range?: string;
  }, googleSheetsList: Array<{ spreadsheetId: string; range?: string; useWhen: string }>): Promise<QuerySheetResult> {
    const entry = googleSheetsList.find((s) => s.useWhen.toLowerCase() === (params.useWhen ?? '').toLowerCase()) ?? googleSheetsList[0];
    if (!entry) {
      return {
        success: false,
        error: 'Sheet not found',
      };
    }

    try {
      const rangeToUse = params.range?.trim() || entry.range;
      const data = await fetchSheetData(this.tenantId, entry.spreadsheetId, rangeToUse ?? undefined);
      return {
        success: true,
        data,
        action: 'read',
        timestamp: new Date(),
      };
    } catch (e) {
      console.error('[ToolExecutor] Query sheet error:', e);
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Failed to fetch sheet data',
      };
    }
  }

  async executeRecordKnowledge(params: {
    title: string;
    content: string;
  }): Promise<RecordKnowledgeResult> {
    try {
      await createRecord(this.tenantId, params.title.trim(), params.content.trim());
      return {
        success: true,
        action: 'write',
        timestamp: new Date(),
      };
    } catch (e) {
      console.error('[ToolExecutor] Record knowledge error:', e);
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Failed to save record',
        action: 'write',
        timestamp: new Date(),
      };
    }
  }

  async executeCreateNote(params: {
    content: string;
    patientName?: string;
    category?: 'common_questions' | 'keywords' | 'analytics' | 'insights' | 'other';
  }, conversationId?: string, userId?: string): Promise<CreateNoteResult> {
    if (!conversationId) {
      return {
        success: false,
        error: 'Conversation ID not available',
      };
    }

    try {
      await createNote(this.tenantId, conversationId, params.content.trim(), {
        userId,
        patientName: params.patientName?.trim(),
        category: params.category ?? 'other',
      });
      return {
        success: true,
        action: 'create',
        timestamp: new Date(),
      };
    } catch (e) {
      console.error('[ToolExecutor] Create note error:', e);
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Failed to create note',
      };
    }
  }
}

// ============================================================================
// STATE VERIFICATION LAYER
// ============================================================================

export class StateVerifier {
  constructor(private toolExecutor: ToolExecutor) {}

  /**
   * Verify that a booking was actually persisted to the database.
   * This is called AFTER append_booking_row to ensure state consistency.
   */
  async verifyBooking(params: {
    phone: string;
    date: string;
    expectedAppointmentId?: string;
  }): Promise<{ verified: boolean; appointment?: GetAppointmentResult['data'] }> {
    const result = await this.toolExecutor.executeGetAppointment({
      phone: params.phone,
      date: params.date,
    });

    if (!result.success) {
      return { verified: false };
    }

    if (!result.data?.found) {
      return { verified: false };
    }

    // If we expected a specific appointment ID, verify it matches
    if (params.expectedAppointmentId && result.data.appointmentId !== params.expectedAppointmentId) {
      return { verified: false };
    }

    return {
      verified: true,
      appointment: result.data,
    };
  }
}

// ============================================================================
// ORCHESTRATOR - Controls tool execution deterministically
// ============================================================================

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ExecutionLog {
  toolCall: ToolCall;
  result: ToolResult;
  timestamp: Date;
  verified?: boolean;
}

export class AgentOrchestrator {
  private toolExecutor: ToolExecutor;
  private stateVerifier: StateVerifier;
  private executionLogs: ExecutionLog[] = [];
  private tenantId: string;

  constructor(
    tenantId: string,
    bookingsSheetEntry?: { spreadsheetId: string; range?: string }
  ) {
    this.tenantId = tenantId;
    this.toolExecutor = new ToolExecutor(tenantId, bookingsSheetEntry);
    this.stateVerifier = new StateVerifier(this.toolExecutor);
  }

  /**
   * Execute a tool call with validation and verification.
   * The orchestrator decides whether to execute, not the LLM.
   */
  async executeToolCall(
    toolCall: ToolCall,
    googleSheetsList: Array<{ spreadsheetId: string; range?: string; useWhen: string }>,
    conversationId?: string,
    userId?: string
  ): Promise<ToolResult> {
    let result: ToolResult;

    // MANDATORY CONSISTENCY CHECK: Load existing notes before ANY state-changing action
    // This ensures we don't contradict previous bookings or information recorded in notes.
    let noteContext = '';
    if (conversationId && ['append_booking_row', 'check_availability', 'record_learned_knowledge'].includes(toolCall.name)) {
      try {
        const notes = await listAgentNotes(this.tenantId, { conversationId, limit: 20 });
        if (notes.length > 0) {
          noteContext = notes.map(n => `[${n.category}] ${n.content}`).join('; ');
          console.log(`[Orchestrator] Consistency check: Loaded ${notes.length} notes for validation.`);
        }
      } catch (e) {
        console.warn('[Orchestrator] Failed to load notes for consistency check:', e);
      }
    }

    // Deterministic execution based on tool name
    switch (toolCall.name) {
      case 'append_booking_row':
        if (
          typeof toolCall.args.date === 'string' &&
          typeof toolCall.args.patientName === 'string' &&
          typeof toolCall.args.phone === 'string' &&
          typeof toolCall.args.doctorName === 'string' &&
          typeof toolCall.args.appointmentTime === 'string'
        ) {
          // Cross-reference with notes for consistency
          const dateStr = /today/i.test(toolCall.args.date) ? new Date().toISOString().slice(0, 10) : toolCall.args.date;
          const timeStr = toolCall.args.appointmentTime;
          const doctorStr = toolCall.args.doctorName;
          
          if (noteContext.toLowerCase().includes(dateStr.toLowerCase()) && 
              noteContext.toLowerCase().includes(timeStr.toLowerCase()) && 
              noteContext.toLowerCase().includes(doctorStr.toLowerCase())) {
            console.warn(`[Orchestrator] Potential double-booking detected in notes for ${doctorStr} on ${dateStr} at ${timeStr}`);
            // We don't block it here yet because the tool itself checks the sheet, 
            // but we could add a stricter block if needed.
          }

          result = await this.toolExecutor.executeBookAppointment({
            date: toolCall.args.date,
            patientName: toolCall.args.patientName,
            phone: toolCall.args.phone,
            doctorName: toolCall.args.doctorName,
            appointmentTime: toolCall.args.appointmentTime,
            notes: typeof toolCall.args.notes === 'string' ? toolCall.args.notes : undefined,
          });

          // Record integration activity for dashboard visualization
          if (result.success) {
            void recordActivity(this.tenantId, 'integrations');
          }

          // CRITICAL: Verify booking was actually persisted
          if (result.success && result.data) {
            const bookingData = result as BookAppointmentResult;
            const verification = await this.stateVerifier.verifyBooking({
              phone: toolCall.args.phone as string,
              date: toolCall.args.date as string,
              expectedAppointmentId: bookingData.data?.appointmentId,
            });

            // Only mark as successful if verification passes
            if (!verification.verified) {
              result = {
                ...result,
                success: false,
                verified: false,
                error: 'Booking was created but could not be verified in database',
              };
            } else {
              result = {
                ...result,
                verified: true,
              };
            }

            this.executionLogs.push({
              toolCall,
              result,
              timestamp: new Date(),
              verified: verification.verified,
            });
          } else {
            this.executionLogs.push({
              toolCall,
              result,
              timestamp: new Date(),
              verified: false,
            });
          }
        } else {
          result = {
            success: false,
            error: 'Invalid arguments for append_booking_row',
          };
        }
        break;

      case 'get_appointment_by_phone':
        if (typeof toolCall.args.phone === 'string') {
          result = await this.toolExecutor.executeGetAppointment({
            phone: toolCall.args.phone,
            date: typeof toolCall.args.date === 'string' ? toolCall.args.date : undefined,
          });
          // Record integration activity for dashboard visualization
          if (result.success) {
            void recordActivity(this.tenantId, 'integrations');
          }
        } else {
          result = {
            success: false,
            error: 'Invalid arguments for get_appointment_by_phone',
          };
        }
        break;

      case 'check_availability':
        if (typeof toolCall.args.date === 'string') {
          result = await this.toolExecutor.executeQuerySheet(
            {
              useWhen: 'booking',
              range: typeof toolCall.args.range === 'string' ? toolCall.args.range : undefined,
            },
            googleSheetsList
          );
          // Record integration activity for dashboard visualization
          if (result.success) {
            void recordActivity(this.tenantId, 'integrations');
          }
        } else {
          result = {
            success: false,
            error: 'Invalid arguments for check_availability',
          };
        }
        break;

      case 'query_google_sheet':
        if (typeof toolCall.args.useWhen === 'string') {
          result = await this.toolExecutor.executeQuerySheet(
            {
              useWhen: toolCall.args.useWhen,
              range: typeof toolCall.args.range === 'string' ? toolCall.args.range : undefined,
            },
            googleSheetsList
          );
          // Record integration activity for dashboard visualization
          if (result.success) {
            void recordActivity(this.tenantId, 'integrations');
          }
        } else {
          result = {
            success: false,
            error: 'Invalid arguments for query_google_sheet',
          };
        }
        break;

      case 'record_learned_knowledge':
        if (typeof toolCall.args.title === 'string' && typeof toolCall.args.content === 'string') {
          result = await this.toolExecutor.executeRecordKnowledge({
            title: toolCall.args.title,
            content: toolCall.args.content,
          });
          // Record agent-brain activity for dashboard visualization
          if (result.success) {
            void recordActivity(this.tenantId, 'agent-brain');
          }
        } else {
          result = {
            success: false,
            error: 'Invalid arguments for record_learned_knowledge',
          };
        }
        break;

      case 'request_edit_record':
        if (typeof toolCall.args.recordId === 'string') {
          try {
            const record = await getRecord(this.tenantId, toolCall.args.recordId);
            if (!record) {
              result = {
                success: false,
                error: 'Record not found',
              };
            } else {
              await createModificationRequest(
                this.tenantId,
                'edit',
                toolCall.args.recordId,
                {
                  title: typeof toolCall.args.title === 'string' ? toolCall.args.title : undefined,
                  content: typeof toolCall.args.content === 'string' ? toolCall.args.content : undefined,
                  reason: typeof toolCall.args.reason === 'string' ? toolCall.args.reason : undefined,
                }
              );
              result = {
                success: true,
                action: 'edit',
                timestamp: new Date(),
              };
              // Record agent-brain activity for dashboard visualization
              void recordActivity(this.tenantId, 'agent-brain');
            }
          } catch (e) {
            console.error('[Orchestrator] request_edit_record error:', e);
            result = {
              success: false,
              error: e instanceof Error ? e.message : 'Failed to submit edit request',
            };
          }
        } else {
          result = {
            success: false,
            error: 'Invalid arguments for request_edit_record',
          };
        }
        break;

      case 'request_delete_record':
        if (typeof toolCall.args.recordId === 'string') {
          try {
            const record = await getRecord(this.tenantId, toolCall.args.recordId);
            if (!record) {
              result = {
                success: false,
                error: 'Record not found',
              };
            } else {
              await createModificationRequest(
                this.tenantId,
                'delete',
                toolCall.args.recordId,
                {
                  reason: typeof toolCall.args.reason === 'string' ? toolCall.args.reason : undefined,
                }
              );
              result = {
                success: true,
                action: 'delete',
                timestamp: new Date(),
              };
              // Record agent-brain activity for dashboard visualization
              void recordActivity(this.tenantId, 'agent-brain');
            }
          } catch (e) {
            console.error('[Orchestrator] request_delete_record error:', e);
            result = {
              success: false,
              error: e instanceof Error ? e.message : 'Failed to submit delete request',
            };
          }
        } else {
          result = {
            success: false,
            error: 'Invalid arguments for request_delete_record',
          };
        }
        break;

      case 'create_note':
        if (typeof toolCall.args.content === 'string') {
          result = await this.toolExecutor.executeCreateNote(
            {
              content: toolCall.args.content,
              patientName: typeof toolCall.args.patientName === 'string' ? toolCall.args.patientName : undefined,
              category:
                typeof toolCall.args.category === 'string' &&
                ['common_questions', 'keywords', 'analytics', 'insights', 'other'].includes(toolCall.args.category)
                  ? (toolCall.args.category as 'common_questions' | 'keywords' | 'analytics' | 'insights' | 'other')
                  : undefined,
            },
            conversationId,
            userId
          );
        } else {
          result = {
            success: false,
            error: 'Invalid arguments for create_note',
          };
        }
        break;

      default:
        result = {
          success: false,
          error: `Unknown tool: ${toolCall.name}`,
        };
    }

    this.executionLogs.push({
      toolCall,
      result,
      timestamp: new Date(),
    });

    return result;
  }

  /**
   * Get execution logs for this turn (for context optimization).
   */
  getExecutionLogs(): ExecutionLog[] {
    return [...this.executionLogs];
  }

  /**
   * Clear execution logs (call at start of new turn).
   */
  clearExecutionLogs(): void {
    this.executionLogs = [];
  }
}

/*
 * Messaging channel adapter contract (web chat, email, WhatsApp, Instagram, …). Types only in
 * Phase 1. Adapters normalize platform payloads so the rest of the system is channel-agnostic.
 */

export type ChannelKind =
  'web' | 'email' | 'whatsapp' | 'instagram' | 'messenger' | 'sms' | 'tiktok';

export interface ChannelCapabilities {
  /** Hours after the last inbound message during which free-form replies are allowed. */
  freeformWindowHours?: number;
  /** Outbound messages outside the window must use pre-approved templates. */
  requiresTemplates: boolean;
  supportsMedia: boolean;
}

export interface NormalizedInbound {
  channel: ChannelKind;
  /** Platform identity of the sender (email address, phone number, platform user id). */
  externalUserId: string;
  externalThreadId?: string;
  externalMessageId: string;
  text: string;
  receivedAt: Date;
  /** Attribution or platform metadata (ad id, referral, …). Never trusted as instructions. */
  metadata?: Record<string, unknown>;
}

export interface NormalizedOutbound {
  channel: ChannelKind;
  to: string;
  text: string;
  templateId?: string;
  /** Prevents duplicate sends when a job is retried. */
  idempotencyKey: string;
}

export interface SendResult {
  externalMessageId: string;
  acceptedAt: Date;
}

export interface DeliveryStatus {
  externalMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
  error?: string;
}

export interface ChannelAdapter {
  readonly channel: ChannelKind;
  readonly capabilities: ChannelCapabilities;
  verifyWebhook(request: Request): Promise<boolean>;
  parseInbound(request: Request): Promise<NormalizedInbound[]>;
  send(message: NormalizedOutbound): Promise<SendResult>;
  parseStatus?(request: Request): Promise<DeliveryStatus[]>;
}

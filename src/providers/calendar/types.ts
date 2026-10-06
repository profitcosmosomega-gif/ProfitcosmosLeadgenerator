/*
 * Calendar provider contract (Cal.com, Google Calendar, …). Types only in Phase 1.
 * All times are UTC `Date`s; `timezone` is the IANA zone used for display to the prospect.
 */

export interface Slot {
  start: Date;
  end: Date;
  hostId?: string;
}

export interface Attendee {
  name: string;
  email: string;
  phone?: string;
  timezone: string;
}

export interface Booking {
  externalId: string;
  start: Date;
  end: Date;
  hostId?: string;
  meetingUrl?: string;
  status: 'booked' | 'rescheduled' | 'canceled';
}

export interface AvailabilityQuery {
  from: Date;
  to: Date;
  durationMinutes: number;
  timezone: string;
  hostIds?: string[];
}

export interface CreateBookingInput {
  slot: Slot;
  attendee: Attendee;
  notes?: string;
  /** Prevents duplicate bookings when a request is retried. */
  idempotencyKey: string;
}

export type CalendarEvent =
  | { type: 'booking.created'; booking: Booking }
  | { type: 'booking.rescheduled'; booking: Booking; previousStart: Date }
  | { type: 'booking.canceled'; externalId: string; reason?: string };

export interface CalendarProvider {
  readonly name: string;
  getAvailability(query: AvailabilityQuery): Promise<Slot[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  rescheduleBooking(externalId: string, slot: Slot): Promise<Booking>;
  cancelBooking(externalId: string, reason?: string): Promise<void>;
  /** Verify and parse an inbound webhook. Returns null for events we ignore. */
  parseWebhook(request: Request): Promise<CalendarEvent | null>;
}

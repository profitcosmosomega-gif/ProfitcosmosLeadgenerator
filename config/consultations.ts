/**
 * Consultation defaults (founder answer to business question 7, 2026-10-07): one host (the
 * founder), 30-minute consultations, weekdays 9:00–17:00 Eastern Time.
 *
 * Phase 3 does not book anything: the AI never proposes or confirms a date or time, and staff
 * arrange consultations themselves. Calendar booking is Phase 6, which will read this config.
 */
export const consultationConfig = {
  host: 'Founder',
  durationMinutes: 30,
  timezone: 'America/Toronto',
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  weekdays: [1, 2, 3, 4, 5],
  dayStart: '09:00',
  dayEnd: '17:00',
  /** Automatic booking is off until Phase 6. */
  autoBooking: false,
} as const;

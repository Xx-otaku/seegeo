import type { Schedule } from "./types.js";
const offset = 8 * 60 * 60 * 1000;
/** The most recent intended slot, independent of service downtime or collection duration. */
export function latestSlot(schedule: Schedule, now = new Date()): string {
  const local = new Date(now.getTime() + offset);
  const slot = new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      schedule.hour,
      schedule.minute,
    ),
  );
  if (schedule.frequency === "weekly")
    slot.setUTCDate(
      slot.getUTCDate() - ((slot.getUTCDay() - schedule.weekday + 7) % 7),
    );
  if (slot > local)
    slot.setUTCDate(
      slot.getUTCDate() - (schedule.frequency === "weekly" ? 7 : 1),
    );
  return new Date(slot.getTime() - offset).toISOString();
}
export function nextSlot(schedule: Schedule, now = new Date()): string {
  const previous = new Date(latestSlot(schedule, now));
  return new Date(
    previous.getTime() + (schedule.frequency === "weekly" ? 7 : 1) * 86400000,
  ).toISOString();
}

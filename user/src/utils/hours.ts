import type { OpeningHours } from '../types';

interface HoursDisplay {
  todayHours: string | null; // "10:00 AM – 11:00 PM"
  timeUntil: string | null;  // "Opens in 2 hours" or "Closes in 3 hours"
  isOpen: boolean;
}

export function getHoursDisplay(hours: OpeningHours | undefined): HoursDisplay {
  if (!hours?.weekday_text || hours.weekday_text.length === 0) {
    return { todayHours: null, timeUntil: null, isOpen: hours?.open_now ?? false };
  }

  const today = new Date();
  const dayIndex = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const todayText = hours.weekday_text[dayIndex] ?? null;

  // Extract hours string from "Monday: 10:00 AM – 11:00 PM" format
  const hoursString = todayText?.split(': ')[1] ?? null;

  // Calculate time until open/close
  const timeUntil = getTimeUntil(hours.periods, dayIndex);

  return {
    todayHours: hoursString,
    timeUntil,
    isOpen: hours.open_now ?? false,
  };
}

function getTimeUntil(
  periods: Array<{ open: { day: number; time: string }; close?: { day: number; time: string } }> | undefined,
  dayIndex: number
): string | null {
  if (!periods || periods.length === 0) return null;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMin;

  // Find today's periods
  const todayPeriods = periods.filter((p) => p.open?.day === dayIndex);
  if (todayPeriods.length === 0) return null;

  for (const period of todayPeriods) {
    const openTime = parseTime(period.open?.time);
    const closeTime = period.close ? parseTime(period.close.time) : null;

    if (openTime !== null) {
      // Check if we're before opening time
      if (currentTimeInMinutes < openTime) {
        const minutesUntil = openTime - currentTimeInMinutes;
        return formatTimeDelta(minutesUntil, 'Opens in');
      }

      // Check if we're between open and close
      if (closeTime !== null && currentTimeInMinutes >= openTime && currentTimeInMinutes < closeTime) {
        const minutesUntil = closeTime - currentTimeInMinutes;
        return formatTimeDelta(minutesUntil, 'Closes in');
      }
    }
  }

  // If we get here, check if place opens tomorrow
  const nextDayIndex = (dayIndex + 1) % 7;
  const tomorrowPeriods = periods.filter((p) => p.open?.day === nextDayIndex);
  if (tomorrowPeriods.length > 0) {
    return 'Opens tomorrow';
  }

  return 'Closed';
}

function parseTime(timeStr: string | undefined): number | null {
  if (!timeStr || timeStr.length !== 4) return null;
  const hours = parseInt(timeStr.slice(0, 2), 10);
  const mins = parseInt(timeStr.slice(2), 10);
  return hours * 60 + mins;
}

function formatTimeDelta(minutes: number, prefix: string): string {
  if (minutes < 60) {
    return `${prefix} ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${prefix} ${hours}h`;
  }
  return `${prefix} ${hours}h ${mins}m`;
}

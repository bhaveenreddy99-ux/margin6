import type {
  InventoryCatalogItemRow,
  InventoryListRow,
  InventorySessionListRow,
  ListSelectorMeta,
  ReminderScheduleForNextOccurrence,
  ReminderWithListLocation,
  ScheduleWithNextDate,
  SessionStats,
} from "@/domain/inventory/enterInventoryTypes";

export function computeNextOccurrence(
  schedule: ReminderScheduleForNextOccurrence,
): Date | null {
  const dayMap: Record<string, number> = {
    SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
  };
  const rawDays = schedule.days_of_week;
  const days = Array.isArray(rawDays) ? (rawDays as string[]) : [];
  const [hours, minutes] = (schedule.time_of_day || "09:00").split(":").map(Number);
  const now = new Date();

  const monthlyDay = days.find((day) => day.startsWith("MONTHLY_"));
  if (monthlyDay) {
    const day = parseInt(monthlyDay.split("_")[1], 10);
    const candidate = new Date(now.getFullYear(), now.getMonth(), day, hours, minutes, 0, 0);
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
    return candidate;
  }

  for (let index = 0; index <= 7; index += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + index);
    const candidateDay = Object.keys(dayMap).find((key) => dayMap[key] === candidate.getDay());
    if (candidateDay && days.includes(candidateDay)) {
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate > now) return candidate;
    }
  }

  return null;
}

export function getScheduleStatus(nextDate: Date): "upcoming" | "ready" | "overdue" {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs < 0) return "overdue";
  if (diffMs < 60 * 60 * 1000) return "ready";
  return "upcoming";
}

export function formatCountdown(nextDate: Date): string {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs <= 0) return "Now";
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function findNextSchedule(
  schedules: ReminderWithListLocation[],
): ScheduleWithNextDate | null {
  let closest: ScheduleWithNextDate | null = null;
  for (const schedule of schedules) {
    const nextDate = computeNextOccurrence(schedule);
    if (nextDate && (!closest || nextDate < closest.nextDate)) {
      closest = { ...schedule, nextDate };
    }
  }
  return closest;
}

export function buildLandingFocus(args: {
  lists: InventoryListRow[];
  landingFocusListId: string | null;
  inProgressSessions: InventorySessionListRow[];
  reviewSessions: InventorySessionListRow[];
  sessionStats: SessionStats;
  listSelectorMeta: ListSelectorMeta;
}) {
  const effectiveLandingListId =
    args.landingFocusListId && args.lists.some((l) => l.id === args.landingFocusListId)
      ? args.landingFocusListId
      : args.lists[0]?.id ?? null;
  const focusList = args.lists.find((l) => l.id === effectiveLandingListId) || null;
  const focusInProgressSession = effectiveLandingListId
    ? args.inProgressSessions.find((s) => s.inventory_list_id === effectiveLandingListId) ?? null
    : null;
  const focusReviewSession =
    !focusInProgressSession && effectiveLandingListId
      ? args.reviewSessions.find((s) => s.inventory_list_id === effectiveLandingListId) ?? null
      : null;
  const meta = effectiveLandingListId
    ? args.listSelectorMeta[effectiveLandingListId]
    : { itemCount: 0, lastCountedAt: null, hasParGuide: false };
  const stats = focusInProgressSession
    ? args.sessionStats[focusInProgressSession.id]
    : undefined;

  return {
    effectiveLandingListId,
    focusList,
    focusInProgressSession,
    focusReviewSession,
    meta: meta || { itemCount: 0, lastCountedAt: null, hasParGuide: false },
    stats,
  };
}

export function buildListSelectorMeta(
  lists: InventoryListRow[],
  catalogItems: Array<Pick<InventoryCatalogItemRow, "inventory_list_id">>,
  guides: Array<{ inventory_list_id: string | null }>,
  approvedSessions: Array<Pick<InventorySessionListRow, "inventory_list_id" | "approved_at">>,
): ListSelectorMeta {
  const nextMeta: ListSelectorMeta = {};
  for (const list of lists) {
    nextMeta[list.id] = { itemCount: 0, lastCountedAt: null, hasParGuide: false };
  }
  for (const item of catalogItems) {
    if (!item.inventory_list_id) continue;
    nextMeta[item.inventory_list_id] ||= { itemCount: 0, lastCountedAt: null, hasParGuide: false };
    nextMeta[item.inventory_list_id].itemCount += 1;
  }
  for (const guide of guides) {
    if (!guide.inventory_list_id) continue;
    nextMeta[guide.inventory_list_id] ||= { itemCount: 0, lastCountedAt: null, hasParGuide: false };
    nextMeta[guide.inventory_list_id].hasParGuide = true;
  }
  for (const session of approvedSessions) {
    if (!session.inventory_list_id || !session.approved_at) continue;
    nextMeta[session.inventory_list_id] ||= { itemCount: 0, lastCountedAt: null, hasParGuide: false };
    const existingDate = nextMeta[session.inventory_list_id].lastCountedAt;
    if (!existingDate || new Date(session.approved_at) > new Date(existingDate)) {
      nextMeta[session.inventory_list_id].lastCountedAt = session.approved_at;
    }
  }
  return nextMeta;
}

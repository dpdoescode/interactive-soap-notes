import CAPNoteModel from '../../models/CAPNoteModel';
import { createCAPNote } from '../../controllers/capNotes/createSoapNote';
import dbConnect from '../dbConnect';

type SIGVenue = {
  name?: string;
  day_of_week?: string;
  projects?: Array<string | { name?: string }>;
};

type SprintProcess = {
  name?: string;
  start_day?: string;
  end_day?: string;
};

type ParsedSprint = {
  sprintNumber: number;
  startDay: Date;
  endDay: Date;
};

const fetchJson = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.json();
};

const normalizeDateToUtcMidnight = (date: Date) => {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
};

const getTimezoneDateAtUtcMidnight = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  return new Date(Date.UTC(year, month - 1, day));
};

const weekdayToUtcIndex: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

const startOfIsoWeek = (date: Date) => {
  const normalizedDate = normalizeDateToUtcMidnight(date);
  const utcDay = normalizedDate.getUTCDay();
  const daysFromMonday = utcDay === 0 ? 6 : utcDay - 1;
  normalizedDate.setUTCDate(normalizedDate.getUTCDate() - daysFromMonday);
  return normalizedDate;
};

const weekKey = (date: Date) => startOfIsoWeek(date).toISOString();

const getVenueDateInWeek = (weekStart: Date, weekday: string) => {
  const targetUtcDay = weekdayToUtcIndex[weekday];
  if (targetUtcDay === undefined) {
    return null;
  }

  const mondayStart = startOfIsoWeek(weekStart);
  const dayOffset = targetUtcDay === 0 ? 6 : targetUtcDay - 1;
  mondayStart.setUTCDate(mondayStart.getUTCDate() + dayOffset);
  return mondayStart;
};

const fetchSIGVenues = async () => {
  if (!process.env.STUDIO_API) {
    return [];
  }

  const venues = await fetchJson(`${process.env.STUDIO_API}/venues/sig`);
  return Array.isArray(venues) ? venues : [];
};

const fetchSprints = async () => {
  if (!process.env.STUDIO_API) {
    return [];
  }

  const sprints = await fetchJson(`${process.env.STUDIO_API}/sprints`);
  return Array.isArray(sprints) ? sprints : [];
};

const getQuarterBounds = (sprints: SprintProcess[]) => {
  const sprintEntries = sprints
    .map<ParsedSprint | null>((sprint) => {
      const match = sprint?.name?.match(/^Sprint (\d+)$/);
      if (!match || match[1] === '0' || !sprint.start_day || !sprint.end_day) {
        return null;
      }

      const sprintNumber = Number(match[1]);
      const startDay = new Date(sprint.start_day);
      const endDay = new Date(sprint.end_day);
      if (
        Number.isNaN(startDay.getTime()) ||
        Number.isNaN(endDay.getTime())
      ) {
        return null;
      }

      return {
        sprintNumber,
        startDay: normalizeDateToUtcMidnight(startDay),
        endDay: normalizeDateToUtcMidnight(endDay)
      };
    })
    .filter((sprint): sprint is ParsedSprint => sprint !== null)
    .sort((a, b) => a.sprintNumber - b.sprintNumber);

  if (sprintEntries.length === 0) {
    return null;
  }

  return {
    quarterStart: sprintEntries[0].startDay,
    quarterEnd: sprintEntries[sprintEntries.length - 1].endDay
  };
};

const getTargetWeekStart = (
  quarterStart: Date,
  quarterEnd: Date
) => {
  const todayInChicago = getTimezoneDateAtUtcMidnight(
    new Date(),
    'America/Chicago'
  );

  if (todayInChicago < quarterStart || todayInChicago > quarterEnd) {
    return null;
  }

  return startOfIsoWeek(todayInChicago);
};

export const ensureWeeklyCAPNotesExist = async (): Promise<{
  createdCount: number;
  quarterStart: Date | null;
  quarterEnd: Date | null;
}> => {
  const [sigVenues, sprints] = await Promise.all([fetchSIGVenues(), fetchSprints()]);
  if (sigVenues.length === 0 || sprints.length === 0) {
    return { createdCount: 0, quarterStart: null, quarterEnd: null };
  }

  const quarterBounds = getQuarterBounds(sprints);
  if (!quarterBounds) {
    return { createdCount: 0, quarterStart: null, quarterEnd: null };
  }

  const { quarterStart, quarterEnd } = quarterBounds;

  const targetWeekStart = getTargetWeekStart(quarterStart, quarterEnd);

  if (!targetWeekStart) {
    // Outside active quarter but still return bounds so the UI can fall back to them
    return { createdCount: 0, quarterStart, quarterEnd };
  }

  await dbConnect();

  const allProjects = sigVenues.flatMap((venue) =>
    Array.isArray(venue.projects)
      ? venue.projects
          .map((project) =>
            typeof project === 'string' ? project : project?.name ?? null
          )
          .filter((projectName): projectName is string => Boolean(projectName))
      : []
  );

  const existingNotes = await CAPNoteModel.find({
    project: { $in: allProjects }
  }).select({ project: 1, date: 1 });

  const existingNoteKeys = new Set(
    existingNotes.map((note) => `${note.project}::${weekKey(new Date(note.date))}`)
  );

  let createdCount = 0;

  for (const venue of sigVenues) {
    if (
      !venue?.day_of_week ||
      !Array.isArray(venue.projects) ||
      venue.projects.length === 0
    ) {
      continue;
    }

    const noteDate = getVenueDateInWeek(targetWeekStart, venue.day_of_week);
    if (
      !noteDate ||
      noteDate < quarterBounds.quarterStart ||
      noteDate > quarterBounds.quarterEnd
    ) {
      continue;
    }

    for (const projectRef of venue.projects) {
      const projectName =
        typeof projectRef === 'string' ? projectRef : projectRef?.name ?? null;

      if (!projectName) {
        continue;
      }

      const noteKey = `${projectName}::${weekKey(noteDate)}`;
      if (existingNoteKeys.has(noteKey)) {
        continue;
      }

      const createdNote = await createCAPNote(projectName, noteDate);
      if (createdNote) {
        existingNoteKeys.add(noteKey);
        createdCount += 1;
      }
    }
  }

  return { createdCount, quarterStart, quarterEnd };
};

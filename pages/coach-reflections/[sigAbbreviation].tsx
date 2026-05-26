import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useRef, useState } from 'react';
import { Tooltip } from 'flowbite-react';
import ArrowPathIcon from '@heroicons/react/24/outline/ArrowPathIcon';
import CheckCircleIcon from '@heroicons/react/24/outline/CheckCircleIcon';
import ExclamationCircleIcon from '@heroicons/react/24/outline/ExclamationCircleIcon';
import { longDate, shortDateFromISO, getMondayOfWeek } from '../../lib/helperFns';
import { useTeamRecording, TranscriptEntry } from '../../lib/useTeamRecording';

interface CoachReflections {
  pre: string;
  mid: string;
  post: string;
}

interface TeamData {
  project: string;
  capNoteId: string;
  coachReflections: CoachReflections;
  transcripts: TranscriptEntry[];
  members: string[];
}

interface WeekOption {
  label: string;
  value: string; // Monday ISO string (YYYY-MM-DD)
}

interface PageProps {
  sigAbbreviation: string;
  weekOfISO: string;
  weekLabel: string;
  lastSavedISO: string;
  teams: TeamData[];
  weekOptions: WeekOption[];
}

const phases: { key: keyof CoachReflections; label: string; hint: string }[] = [
  {
    key: 'pre',
    label: 'Pre-Meeting',
    hint: 'After reviewing deliverables and student reflections, before the meeting.'
  },
  {
    key: 'mid',
    label: 'Mid-Meeting',
    hint: "Immediately after this team's turn in the SIG meeting."
  },
  {
    key: 'post',
    label: 'Post-Meeting',
    hint: 'Later in the day with more time to reflect.'
  }
];

// ─── Per-team section ────────────────────────────────────────────────────────

function TeamSection({
  team,
  sigAbbreviation,
  weekOfISO,
  onSaveStart,
  onSaveEnd
}: {
  team: TeamData;
  sigAbbreviation: string;
  weekOfISO: string;
  onSaveStart: () => void;
  onSaveEnd: (err: string | null) => void;
}) {
  const recording = useTeamRecording(team.capNoteId, team.transcripts, team.members);
  const [showRecording, setShowRecording] = useState(false);
  const [reflections, setReflections] = useState<CoachReflections>(team.coachReflections);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = async (updated: CoachReflections) => {
    onSaveStart();
    try {
      const res = await fetch(`/api/sig-reflection/${sigAbbreviation}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekOf: weekOfISO,
          project: team.project,
          capNoteId: team.capNoteId,
          coachReflections: updated
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Save failed');
      onSaveEnd(null);

    } catch (e: any) {
      onSaveEnd(e.message ?? 'Unknown error');
    }
  };

  const handleChange = (field: keyof CoachReflections, value: string) => {
    const updated = { ...reflections, [field]: value };
    setReflections(updated);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(updated), 1200);
  };

  const {
    meetingTranscripts,
    isRecording,
    isPaused,
    isUploadingRecording,
    transcriptError,
    audioPlaybackUrl,
    expandedTranscriptIds,
    speakerNameMaps,
    setSpeakerNameMaps,
    expectedSpeakers,
    setExpectedSpeakers,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    toggleExpandedTranscript,
    getTranscriptWithNames
  } = recording;

  return (
    <div className="mb-10 rounded border border-slate-200 bg-white">
      {/* Team header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-lg font-bold">{team.project}</h2>
        <Link
          href={`/cap-notes/${team.capNoteId}`}
          className="text-sm text-blue-600 underline hover:text-blue-800"
        >
          Open CAP Note →
        </Link>
      </div>

      <div className="p-4">
        {/* ── Recording panel ─────────────────────────────────────────── */}
        <div className="mb-6 rounded border border-slate-300 bg-slate-50">
          <button
            className="flex w-full items-center justify-between px-4 py-2 text-left"
            onClick={() => setShowRecording(!showRecording)}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold">Meeting Recording</h3>
              {isRecording && !isPaused && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                  Recording
                </span>
              )}
              {isRecording && isPaused && (
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                  Paused
                </span>
              )}
              {isUploadingRecording && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-600">
                  Uploading
                </span>
              )}
              {meetingTranscripts[0]?.status === 'processing' && (
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                  Processing
                </span>
              )}
              {meetingTranscripts[0]?.status === 'completed' && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                  Transcript Ready
                </span>
              )}
              {transcriptError && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                  Error
                </span>
              )}
            </div>
            <span className="text-slate-400">{showRecording ? '▲' : '▼'}</span>
          </button>

          {showRecording && (
            <div className="border-t border-slate-300 p-4">
              <p className="mb-3 text-sm text-slate-600">
                Record the project team meeting, then process a speaker-labeled transcript for
                coach review and AI draft generation.
              </p>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  <span>Expected Speakers</span>
                  <select
                    value={expectedSpeakers}
                    onChange={(e) => setExpectedSpeakers(Number(e.target.value))}
                    className="bg-transparent outline-none"
                    disabled={isRecording || isUploadingRecording}
                  >
                    {[2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>

                {!isRecording ? (
                  <button
                    className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    onClick={startRecording}
                    disabled={isUploadingRecording}
                  >
                    Start Recording
                  </button>
                ) : (
                  <>
                    {!isPaused ? (
                      <button
                        className="rounded-full bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600"
                        onClick={pauseRecording}
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        className="rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
                        onClick={resumeRecording}
                      >
                        Resume
                      </button>
                    )}
                    <button
                      className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                      onClick={stopRecording}
                    >
                      Stop & Process
                    </button>
                  </>
                )}
              </div>

              <div className="mt-3 text-sm text-slate-700">
                {isRecording && !isPaused && (
                  <p>Recording in progress. Click pause to pause, or stop when the meeting ends.</p>
                )}
                {isRecording && isPaused && (
                  <p>Recording paused. Click resume to continue, or stop & process to finalize.</p>
                )}
                {isUploadingRecording && <p>Uploading audio and starting transcription...</p>}
                {!isUploadingRecording && meetingTranscripts[0]?.status === 'processing' && (
                  <p>
                    Transcript is processing with {meetingTranscripts[0].provider}. This panel
                    refreshes automatically every few seconds.
                  </p>
                )}
                {transcriptError && (
                  <p className="font-semibold text-red-600">{transcriptError}</p>
                )}
              </div>

              {/* Most recent transcript */}
              {meetingTranscripts[0] && (
                <div className="mt-4">
                  {meetingTranscripts[0].status === 'completed' &&
                    meetingTranscripts[0].utterances?.length > 0 && (
                      <div className="rounded border border-slate-200 bg-white p-3">
                        <h4 className="mb-2 text-sm font-bold">Identify Speakers</h4>
                        <p className="mb-2 text-xs text-slate-500">
                          Map each speaker label to a participant name.
                        </p>
                        <datalist id={`members-${team.capNoteId}`}>
                          {team.members.map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                        <div className="flex flex-wrap gap-2">
                          {Array.from(
                            new Set(
                              meetingTranscripts[0].utterances.map(
                                (u: { speaker: string }) => u.speaker
                              )
                            )
                          ).map((speakerLabel: string) => (
                            <label
                              key={speakerLabel}
                              className="flex items-center gap-1.5 text-sm text-slate-700"
                            >
                              <span className="font-medium">{speakerLabel}:</span>
                              <input
                                type="text"
                                list={`members-${team.capNoteId}`}
                                className="w-36 rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
                                placeholder="Name (optional)"
                                value={
                                  speakerNameMaps[meetingTranscripts[0].id]?.[speakerLabel] ?? ''
                                }
                                onChange={(e) =>
                                  setSpeakerNameMaps((prev) => ({
                                    ...prev,
                                    [meetingTranscripts[0].id]: {
                                      ...(prev[meetingTranscripts[0].id] ?? {}),
                                      [speakerLabel]: e.target.value
                                    }
                                  }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                  {audioPlaybackUrl && (
                    <div className="mt-3">
                      <p className="mb-1 text-xs font-medium text-slate-500">
                        Playback (current session)
                      </p>
                      <audio controls src={audioPlaybackUrl} className="w-full" />
                    </div>
                  )}

                  {meetingTranscripts[0].formattedText && (
                    <div className="mt-3 rounded border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-bold">Transcript</h4>
                        <div className="text-xs text-slate-500">
                          {meetingTranscripts[0].utterances?.length ?? 0} speaker turns
                          {meetingTranscripts[0].completedAt
                            ? ` • ${new Date(meetingTranscripts[0].completedAt).toLocaleString()}`
                            : ''}
                        </div>
                      </div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-800">
                        {getTranscriptWithNames(
                          meetingTranscripts[0].formattedText,
                          meetingTranscripts[0].id
                        )}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Previous recordings */}
              {meetingTranscripts.length > 1 && (
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Previous Recordings ({meetingTranscripts.length - 1})
                  </h4>
                  {meetingTranscripts.slice(1).map((t: any, i: number) => (
                    <div key={t.id} className="mb-2 rounded border border-slate-200 bg-white">
                      <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                        onClick={() => toggleExpandedTranscript(t.id)}
                      >
                        <span className="font-medium text-slate-700">
                          Recording {meetingTranscripts.length - 1 - i}
                          {t.requestedAt
                            ? ` — ${new Date(t.requestedAt).toLocaleDateString()}`
                            : ''}
                        </span>
                        <div className="flex items-center gap-2">
                          {t.status === 'completed' && (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              Completed
                            </span>
                          )}
                          {t.status === 'processing' && (
                            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                              Processing
                            </span>
                          )}
                          {t.status === 'error' && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                              Error
                            </span>
                          )}
                          <span className="text-slate-400">
                            {expandedTranscriptIds.has(t.id) ? '▲' : '▼'}
                          </span>
                        </div>
                      </button>
                      {expandedTranscriptIds.has(t.id) && (
                        <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                          {t.status === 'error' && (
                            <p className="text-sm text-red-600">
                              {t.error ?? 'Transcription failed.'}
                            </p>
                          )}
                          {t.status === 'completed' && t.utterances?.length > 0 && (
                            <div className="mb-3">
                              <h5 className="mb-1 text-xs font-semibold text-slate-600">
                                Identify Speakers
                              </h5>
                              <div className="flex flex-wrap gap-2">
                                {Array.from(
                                  new Set(
                                    t.utterances.map((u: { speaker: string }) => u.speaker)
                                  )
                                ).map((speakerLabel: string) => (
                                  <label
                                    key={speakerLabel}
                                    className="flex items-center gap-1.5 text-sm text-slate-700"
                                  >
                                    <span className="font-medium">{speakerLabel}:</span>
                                    <input
                                      type="text"
                                      list={`members-${team.capNoteId}`}
                                      className="w-36 rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
                                      placeholder="Name (optional)"
                                      value={speakerNameMaps[t.id]?.[speakerLabel] ?? ''}
                                      onChange={(e) =>
                                        setSpeakerNameMaps((prev) => ({
                                          ...prev,
                                          [t.id]: {
                                            ...(prev[t.id] ?? {}),
                                            [speakerLabel]: e.target.value
                                          }
                                        }))
                                      }
                                    />
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {t.formattedText && (
                            <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-800">
                              {getTranscriptWithNames(t.formattedText, t.id)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Coach reflections ────────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {phases.map(({ key, label, hint }) => (
            <div key={key}>
              <h3 className="mb-0.5 text-sm font-bold">{label}</h3>
              <p className="mb-1 text-xs text-slate-500">{hint}</p>
              <textarea
                className="w-full rounded border p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-300"
                rows={4}
                value={reflections[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                placeholder={`${label} reflection…`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CoachReflectionsPage({
  sigAbbreviation,
  weekOfISO,
  weekLabel,
  lastSavedISO,
  teams,
  weekOptions
}: PageProps) {
  const router = useRouter();

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState(longDate(new Date(lastSavedISO)));
  const saveCount = useRef(0);

  const onSaveStart = () => {
    saveCount.current += 1;
    setIsSaving(true);
    setSaveError(null);
  };

  const onSaveEnd = (err: string | null) => {
    saveCount.current = Math.max(0, saveCount.current - 1);
    if (saveCount.current === 0) setIsSaving(false);
    if (err) {
      setSaveError(err);
    } else {
      setLastSaved(longDate(new Date()));
    }
  };

  const handleWeekChange = (value: string) => {
    router.push(`/coach-reflections/${sigAbbreviation}?weekOf=${value}`);
  };

  return (
    <>
      <Head>
        <title>{`${sigAbbreviation} | Coach Reflections -- ${weekLabel}`}</title>
      </Head>

      <div className="mx-auto flex h-dvh flex-col overflow-hidden pl-3 pr-3 pt-2">
        {/* Header row */}
        <div className="flex flex-shrink-0 flex-row flex-nowrap items-center">
          <div className="mr-1">
            <Link href="/">
              <h3 className="text-base font-bold text-blue-400 visited:text-purple-600 hover:text-blue-500">
                &#8592;
              </h3>
            </Link>
          </div>

          <div className="mr-2">
            <h1 className="text-base font-bold">
              {sigAbbreviation} | Coach Reflections -- {weekLabel}
            </h1>
          </div>

          <div className="flex flex-row items-center">
            {!isSaving && saveError === null ? (
              <>
                <CheckCircleIcon className="mr-0.5 h-5 w-5 text-green-600" />
                <h2 className="text-base font-semibold text-green-600">
                  Reflections last saved on {lastSaved}
                </h2>
              </>
            ) : null}

            {isSaving ? (
              <>
                <ArrowPathIcon className="mr-0.5 h-5 w-5 animate-spin text-blue-600" />
                <h2 className="text-base font-semibold text-blue-600">Saving...</h2>
              </>
            ) : null}

            {!isSaving && saveError !== null ? (
              <>
                <Tooltip content={saveError} placement="bottom">
                  <ExclamationCircleIcon className="mr-0.5 h-5 w-5 text-red-600" />
                </Tooltip>
                <h2 className="text-base font-semibold text-red-600">
                  Error saving reflections (Last saved: {lastSaved})
                </h2>
              </>
            ) : null}
          </div>
        </div>

        {/* Week selector */}
        <div className="mb-4 mt-2 flex-shrink-0">
          <label className="text-sm font-medium">
            Week:{' '}
            <select
              value={weekOfISO.slice(0, 10)}
              onChange={(e) => handleWeekChange(e.target.value)}
              className="ml-2 rounded border px-2 py-1 text-sm"
            >
              {weekOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Team sections */}
        <div className="flex-1 overflow-y-auto pb-10">
          {teams.length === 0 ? (
            <p className="text-sm text-slate-400">
              No CAP notes found for this SIG during the week of {weekLabel}. Create them from the
              home page first.
            </p>
          ) : (
            teams.map((team) => (
              <TeamSection
                key={team.capNoteId}
                team={team}
                sigAbbreviation={sigAbbreviation}
                weekOfISO={weekOfISO}
                onSaveStart={onSaveStart}
                onSaveEnd={onSaveEnd}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ─── Server-side data loading ─────────────────────────────────────────────────

export const getServerSideProps: GetServerSideProps = async ({ params, query }) => {
  const sigAbbreviation = params?.sigAbbreviation as string;
  const weekOfParam = query?.weekOf as string | undefined;

  const { default: dbConnect } = await import('../../lib/dbConnect');
  const { default: CAPNoteModel } = await import('../../models/CAPNoteModel');
  const { default: MeetingTranscriptModel } = await import('../../models/MeetingTranscriptModel');
  const { default: SIGReflectionModel } = await import('../../models/SIGReflectionModel');

  await dbConnect();

  const studioApi = process.env.STUDIO_API;

  // Weekly grouping — always 7 days starting from Monday
  const targetDate = weekOfParam ? new Date(weekOfParam) : new Date();
  const weekOf = getMondayOfWeek(targetDate);
  const weekEnd = new Date(weekOf);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  // Use studio-api to label each week with its sprint name (e.g. "Sprint 4 — Mon, May 25, 2026")
  // Build the last 8 weeks and label them
  const weekOptions: WeekOption[] = [];
  let allSprints: any[] = [];
  if (studioApi) {
    try {
      const res = await fetch(`${studioApi}/sprints`);
      if (res.ok) allSprints = await res.json();
    } catch {}
  }

  const getSprintLabel = (monday: Date): string => {
    const sprint = allSprints.find(
      (s: any) => new Date(s.start_day) <= monday && monday <= new Date(s.end_day)
    );
    const dateStr = shortDateFromISO(monday.toISOString());
    return sprint ? `${sprint.name} — ${dateStr}` : dateStr;
  };

  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i * 7);
    const monday = getMondayOfWeek(d);
    weekOptions.push({
      label: getSprintLabel(monday),
      value: monday.toISOString().slice(0, 10)
    });
  }

  const weekLabel = getSprintLabel(weekOf);

  const capNotes = await CAPNoteModel.find({
    sigAbbreviation,
    date: { $gte: weekOf, $lte: weekEnd }
  })
    .sort({ project: 1 })
    .lean();

  // Fetch sigMembers from studio-api — same pattern as cap-notes/[id].tsx
  let sigMembers: { name: string; slack_id: string }[] = [];
  if (studioApi) {
    try {
      const sigsRes = await fetch(`${studioApi}/socialStructures/sigs`);
      if (sigsRes.ok) {
        const sigs = await sigsRes.json();
        const thisSig = Array.isArray(sigs)
          ? sigs.find((s: any) => s.abbreviation === sigAbbreviation)
          : null;
        if (thisSig) {
          const members: { name: string; slack_id: string }[] = (thisSig.members ?? [])
            .filter((m: any) => m.name && m.slack_id)
            .map((m: any) => ({ name: String(m.name), slack_id: String(m.slack_id) }));
          const coach =
            thisSig.sig_head?.name && thisSig.sig_head?.slack_id
              ? [{ name: String(thisSig.sig_head.name), slack_id: String(thisSig.sig_head.slack_id) }]
              : [];
          sigMembers = [...members, ...coach];
        }
      }
    } catch {}
  }

  const sigName = (capNotes[0] as any)?.sigName ?? '';
  let sigReflection = await SIGReflectionModel.findOne({ sigAbbreviation, weekOf });
  if (!sigReflection) {
    sigReflection = await SIGReflectionModel.create({ sigAbbreviation, sigName, weekOf, teams: [] });
  } else if (sigName && !sigReflection.sigName) {
    sigReflection.sigName = sigName;
    await sigReflection.save();
  }

  const teamsFromReflection = sigReflection.toObject().teams ?? [];

  const teams: TeamData[] = await Promise.all(
    capNotes.map(async (note) => {
      const noteId = (note._id as any).toString();
      // Serialize transcripts the same way cap-notes/[id].tsx does — via .toObject()
      const transcriptDocs = await MeetingTranscriptModel.find({ capNoteId: note._id })
        .sort({ requestedAt: -1 });
      const transcripts = transcriptDocs.map((doc) => {
        const obj = doc.toObject();
        return {
          id: obj._id.toString(),
          capNoteId: obj.capNoteId?.toString() ?? null,
          provider: obj.provider,
          status: obj.status,
          transcriptId: obj.transcriptId,
          audioMimeType: obj.audioMimeType,
          requestedAt: obj.requestedAt,
          completedAt: obj.completedAt,
          text: obj.text,
          formattedText: obj.formattedText,
          utterances: obj.utterances ?? [],
          error: obj.error
        };
      });
      const teamReflection = teamsFromReflection.find(
        (t: any) => t.capNoteId?.toString() === noteId
      );
      return {
        project: note.project,
        capNoteId: noteId,
        coachReflections: {
          pre: teamReflection?.coachReflections?.pre ?? '',
          mid: teamReflection?.coachReflections?.mid ?? '',
          post: teamReflection?.coachReflections?.post ?? ''
        },
        transcripts,
        members: sigMembers.map((m) => m.name)
      };
    })
  );

  return {
    props: {
      sigAbbreviation,
      weekOfISO: weekOf.toISOString(),
      weekLabel,
      lastSavedISO: ((sigReflection as any).updatedAt ?? (sigReflection as any).createdAt ?? new Date()).toISOString(),
      teams,
      weekOptions
    }
  };
};

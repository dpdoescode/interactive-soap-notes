// general imports
import type { GetServerSideProps } from 'next';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import mongoose, { set } from 'mongoose';
import { mutate } from 'swr';
import type { AIDraftIssue, AIDraftOutput } from '../api/ai-draft/[id]';

// helper components
import { Tooltip } from 'flowbite-react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// utilities
import {
  longDate,
  serializeDateOnlyToISO,
  serializeDates,
  shortDateFromISO,
  shortenText
} from '../../lib/helperFns';

// data models and controllers
import { fetchCAPNoteById } from '../../controllers/capNotes/fetchCAPNotes';
import { fetchIssueObjectsByIds } from '../../controllers/issueObjects/fetchIssueObject';
import { fetchProjectGapObjectsByIds } from '../../controllers/practiceGapObjects/fetchPracticeGapObject';
import { createNewTextEntryBlock } from '../../controllers/textEntryBlock/createNewTextEntryBlock';

// components
import LastWeekIssueCard from '../../components/LastWeekIssueCard';
import LastWeekIssuePane from '../../components/LastWeekIssuePane';
import CurrWeekIssueCard from '../../components/CurrWeekIssueCard';
import CurrWeekIssuePane from '../../components/CurrWeekIssuePane';
import PracticeGapCard from '../../components/PracticeGapCard';

// icons
import ArrowPathIcon from '@heroicons/react/24/outline/ArrowPathIcon';
import CheckCircleIcon from '@heroicons/react/24/outline/CheckCircleIcon';
import ExclamationCircleIcon from '@heroicons/react/24/outline/ExclamationCircleIcon';

export default function CAPNote({
  capNoteInfo,
  lastWeekIssues,
  currentWeekIssues,
  practiceGaps
}): JSX.Element {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // have state for cap note data
  const [noteInfo, setNoteInfo] = useState(capNoteInfo);
  const [lastUpdated, setLastUpdated] = useState(capNoteInfo.lastUpdated);
  const [meetingTranscript, setMeetingTranscript] = useState(
    capNoteInfo.meetingTranscript ?? null
  );
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingRecording, setIsUploadingRecording] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [expectedSpeakers, setExpectedSpeakers] = useState(2);

  // hold data state for issues and practices
  // see here for updating arrays in state variables: https://react.dev/learn/updating-arrays-in-state#updating-objects-inside-arrays
  const [pastIssuesData, setPastIssuesData] = useState(lastWeekIssues);
  const [currentIssuesData, setCurrentIssuesData] = useState(currentWeekIssues);
  const [practiceGapData, setPracticeGapData] = useState(practiceGaps);

  // hold a state for which issue is selected
  const [selectedIssue, setSelectedIssue] = useState(null);

  // hold a state for showing / hiding practice gap details
  const [showPracticeGaps, setShowPracticeGaps] = useState(false);

  // hold a state for showing / hiding the recording panel
  const [showRecording, setShowRecording] = useState(false);

  // AI draft assistant state
  const [showAIDraft, setShowAIDraft] = useState(false);
  const [coachReflections, setCoachReflections] = useState('');
  const [aiDraft, setAiDraft] = useState<AIDraftOutput | null>(null);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [followUpInput, setFollowUpInput] = useState('');
  const [showEvidence, setShowEvidence] = useState<Record<number, boolean>>({});

  // let user know that we are saving and if there were any errors
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // hold a ref that checks if first load
  const firstLoad = useRef(true);

  // on first load, set the dates for noteInfo to be localized to the timezone
  useEffect(() => {
    setNoteInfo((prevNoteInfo) => ({
      ...prevNoteInfo,
      sigDate: shortDateFromISO(prevNoteInfo.sigDate),
      lastUpdated: longDate(new Date(prevNoteInfo.lastUpdated))
    }));

    setLastUpdated(longDate(new Date(noteInfo.lastUpdated)));
  }, []);

  useEffect(() => {
    if (meetingTranscript?.status !== 'processing') {
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        const transcriptRes = await fetch(`/api/transcripts/${noteInfo.id}`);
        const transcriptData = await transcriptRes.json();

        if (!transcriptRes.ok) {
          throw new Error(
            transcriptData.error ?? 'Unable to refresh transcript status'
          );
        }

        setMeetingTranscript(transcriptData.data);
        if (transcriptData.data?.status === 'error') {
          setTranscriptError(
            transcriptData.data.error ?? 'Transcription processing failed'
          );
        }
      } catch (error) {
        console.error(error);
        setTranscriptError(
          error instanceof Error
            ? error.message
            : 'Unable to refresh transcript status'
        );
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [meetingTranscript?.status, noteInfo.id]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream
        ?.getTracks()
        .forEach((track) => track.stop());
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const startRecording = async () => {
    try {
      setTranscriptError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const preferredMimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4'
      ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));

      const recorder = new MediaRecorder(stream, {
        mimeType: preferredMimeType,
        audioBitsPerSecond: 128000
      });
      mediaRecorderRef.current = recorder;

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm'
        });
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setIsUploadingRecording(true);

        try {
          const transcriptRes = await fetch(`/api/transcripts/${noteInfo.id}`, {
            method: 'POST',
            headers: {
              'Content-Type': audioBlob.type,
              'x-expected-speakers': expectedSpeakers.toString()
            },
            body: audioBlob
          });
          const transcriptData = await transcriptRes.json();

          if (!transcriptRes.ok) {
            throw new Error(
              transcriptData.error ?? 'Unable to start transcription'
            );
          }

          setMeetingTranscript(transcriptData.data);
        } catch (error) {
          console.error(error);
          setTranscriptError(
            error instanceof Error
              ? error.message
              : 'Unable to upload meeting recording'
          );
        } finally {
          setIsUploadingRecording(false);
          mediaRecorderRef.current = null;
        }
      });

      recorder.start(1000);
      setIsRecording(true);
    } catch (error) {
      console.error(error);
      setTranscriptError(
        error instanceof Error
          ? error.message
          : 'Unable to access microphone for recording'
      );
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return;
    }

    mediaRecorderRef.current.requestData();
    mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const refreshTranscript = async () => {
    try {
      setTranscriptError(null);
      const transcriptRes = await fetch(`/api/transcripts/${noteInfo.id}`);
      const transcriptData = await transcriptRes.json();

      if (!transcriptRes.ok) {
        throw new Error(transcriptData.error ?? 'Unable to fetch transcript');
      }

      setMeetingTranscript(transcriptData.data);
    } catch (error) {
      console.error(error);
      setTranscriptError(
        error instanceof Error ? error.message : 'Unable to fetch transcript'
      );
    }
  };

  // listen for changes in pastIssue, currentIssue, or practiceGaps states and do debounced saves to database
  useEffect(() => {
    // don't save on first load
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }

    setIsSaving(true);
    const timeOutId = setTimeout(async () => {
      /**
       * Start by saving the issues
       */
      // create a list of objects to save
      let pastIssuesToSave = pastIssuesData.map((issue) => {
        return structuredClone({
          id: issue.id,
          title: issue.title,
          date: new Date(issue.date).toISOString(),
          project: issue.project,
          sig: issue.sig,
          lastUpdated: new Date(issue.lastUpdated).toISOString(),
          wasDeleted: issue.wasDeleted,
          wasMerged: issue.wasMerged,
          mergeTarget: issue.mergeTarget,
          context: issue.context,
          assessment: issue.assessment,
          plan: issue.plan,
          followUps: issue.followUps,
          priorInstances: issue.priorInstances
        });
      });

      let currentIssuesToSave = currentIssuesData.map((issue) => {
        return structuredClone({
          id: issue.id,
          title: issue.title,
          date: new Date(issue.date).toISOString(),
          project: issue.project,
          sig: issue.sig,
          lastUpdated: new Date(issue.lastUpdated).toISOString(),
          wasDeleted: issue.wasDeleted,
          wasMerged: issue.wasMerged,
          mergeTarget: issue.mergeTarget,
          context: issue.context,
          assessment: issue.assessment,
          plan: issue.plan,
          followUps: issue.followUps,
          priorInstances: issue.priorInstances
        });
      });

      // make request to save the data to the database
      let noteInfoWithUtc = {
        ...noteInfo,
        sigDate: serializeDateOnlyToISO(noteInfo.sigDate),
        lastUpdated: new Date(noteInfo.lastUpdated).toISOString()
      };
      try {
        // make one request to save the past issues
        const pastIssueRes = await fetch(`/api/issues/`, {
          method: 'POST',
          body: JSON.stringify({
            data: [...pastIssuesToSave],
            updateType: 'past',
            noteInfo: noteInfoWithUtc
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        });
        const pastIssueOutput = await pastIssueRes.json();

        // if there's an error, throw an exception
        if (!pastIssueRes.ok) {
          throw new Error(
            `Error from server when saving PastIssues: ${pastIssueOutput.error}`
          );
        }

        // otherwise, update the local data without a revalidation
        if (pastIssueOutput.data !== null) {
          mutate(`/api/issues/`, pastIssueOutput.data, false);
        }

        // make another request to save the current issues
        const currentIssueRes = await fetch(`/api/issues/`, {
          method: 'POST',
          body: JSON.stringify({
            data: [...currentIssuesToSave],
            updateType: 'current',
            noteInfo: noteInfoWithUtc
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        });
        const currentIssueOutput = await currentIssueRes.json();

        // if there's an error, throw an exception
        if (!currentIssueRes.ok) {
          throw new Error(
            `Error from server when saving CurrentIssues: ${currentIssueOutput.error}`
          );
        }

        // otherwise, update the local data without a revalidation
        if (currentIssueOutput.data !== null) {
          mutate(`/api/issues/`, currentIssueOutput.data, false);
        }

        /**
         * Now save the practice gaps
         */
        let practiceGapsToSave = practiceGapData.map((practiceGap) => {
          return structuredClone({
            id: practiceGap.id,
            title: practiceGap.title,
            date: new Date(practiceGap.date).toISOString(),
            project: practiceGap.project,
            sig: practiceGap.sig,
            description: practiceGap.description,
            lastUpdated: practiceGap.lastUpdated,
            practiceInactive: practiceGap.practiceInactive,
            practiceArchived: practiceGap.practiceArchived,
            prevIssues: practiceGap.prevIssues.map((issue) => issue.id)
          });
        });

        // make request to save the data to the database
        const practiceGapRes = await fetch(`/api/practice-gaps/`, {
          method: 'POST',
          body: JSON.stringify({
            data: [...practiceGapsToSave]
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        });
        const practiceGapOutput = await practiceGapRes.json();

        // if there's an error, throw an exception
        if (!practiceGapRes.ok) {
          throw new Error(
            `Error from server when saving PracticeGaps: ${practiceGapOutput.error}`
          );
        }

        // otherwise, update the local data without a revalidation
        if (practiceGapOutput.data !== null) {
          mutate(`/api/practice-gaps/`, practiceGapOutput.data, false);
        }

        /**
         * Finally, update and save noteInfo
         */
        // hold a last updated timestamp
        const lastUpdated = new Date().toISOString();

        // create a clone of the data to save
        let dataToSave = structuredClone({
          project: noteInfo.project,
          date: serializeDateOnlyToISO(noteInfo.sigDate),
          lastUpdated: lastUpdated,
          sigName: noteInfo.sigName,
          sigAbbreviation: noteInfo.sigAbbreviation,
          context: noteInfo.context ?? [],
          assessment: noteInfo.assessment ?? [],
          plan: noteInfo.plan ?? [],
          pastIssues: pastIssueOutput.data.map((issue) => issue._id),
          currentIssues: currentIssueOutput.data.map((issue) => issue._id),
          trackedPractices: practiceGapOutput.data.map(
            (practice) => practice._id
          )
        });

        // make request to save the data to the database
        const capNoteInfoRes = await fetch(`/api/soap/${noteInfo.id}`, {
          method: 'PUT',
          body: JSON.stringify(dataToSave),
          headers: {
            'Content-Type': 'application/json'
          }
        });
        const capNoteInfoOutput = await capNoteInfoRes.json();

        // if there's an error, throw an exception
        if (!capNoteInfoRes.ok) {
          throw new Error(
            `Error from server when saving CAPNote: ${capNoteInfoOutput.error}`
          );
        }

        // otherwise, update the local data without a revalidation
        if (capNoteInfoOutput.data !== null) {
          mutate(`/api/soap/${noteInfo.id}`, capNoteInfoOutput.data, false);
        }

        // update the last updated timestamp for the note
        setLastUpdated(longDate(new Date(lastUpdated), true));

        // update the state variable for noteInfo
        setNoteInfo((prevNoteInfo) => ({
          ...prevNoteInfo,
          pastIssues: pastIssueOutput.data.map((issue) => issue._id),
          currentIssues: currentIssueOutput.data.map((issue) => issue._id),
          trackedPractices: practiceGapOutput.data.map(
            (practice) => practice._id
          )
        }));

        // if there's no error, clear the error state
        setSaveError(null);
      } catch (err) {
        // if there's an error, set the error state
        console.error('Error in saving data: ', err);
        setSaveError(err.message);
      }

      // saving is completed
      setIsSaving(false);
    }, 1000);

    return () => clearTimeout(timeOutId);
  }, [pastIssuesData, currentIssuesData, practiceGapData]);

  // return the page
  return (
    <>
      {/* Set title of the page to be project name */}
      <Head>
        <title>
          {`${shortenText(
            noteInfo.project,
            15
          )} | ${noteInfo.sigDate}`}
        </title>
      </Head>

      {/* Header info for CAP note */}
      <div className="mx-auto flex h-dvh flex-col overflow-hidden pl-3 pr-3 pt-2">
        {/* Back, title, and last updated */}
        <div className="flex flex-shrink-0 flex-row flex-nowrap items-center">
          {/* Back button */}
          <div className="mr-1">
            <Link href="/">
              <Tooltip content="" placement="bottom">
                <h3 className="text-base font-bold text-blue-400 visited:text-purple-600 hover:text-blue-500">
                  &#8592;
                </h3>
              </Tooltip>
            </Link>
          </div>

          {/* Title */}
          <div className="mr-2">
            <h1 className="text-base font-bold">
              {noteInfo.project} | {noteInfo.sigDate}
            </h1>
          </div>

          {/* Save status */}
          {/* Three states of saved: (1) saved without error; (2) saving; (3) save attemped but error */}
          <div className="flex flex-row items-center">
            {/* Saved successfully */}
            {!isSaving && saveError === null ? (
              <>
                <CheckCircleIcon className="mr-0.5 h-5 w-5 text-green-600" />
                <h2 className="text-base font-semibold text-green-600">
                  Notes last saved on {lastUpdated}
                </h2>
              </>
            ) : (
              <></>
            )}

            {/* Saving */}
            {isSaving ? (
              <>
                <ArrowPathIcon className="mr-0.5 h-5 w-5 animate-spin text-blue-600" />
                <h2 className="text-base font-semibold text-blue-600">
                  Saving...
                </h2>
              </>
            ) : (
              <></>
            )}

            {/* Save attempted but error */}
            {!isSaving && saveError !== null ? (
              <>
                <Tooltip content={saveError} placement="bottom">
                  <ExclamationCircleIcon className="mr-0.5 h-5 w-5 text-red-600" />
                </Tooltip>
                <h2 className="text-base font-semibold text-red-600">
                  Error in saving notes (Last saved: {lastUpdated})
                </h2>
              </>
            ) : (
              <></>
            )}
          </div>
          <div></div>
        </div>

        {/* Collapsible panels — scroll within this area if both are expanded */}
        <div className="mt-2 flex-shrink-0 overflow-y-auto" style={{ maxHeight: '45vh' }}>

        {/* Meeting Recording — collapsible */}
        <div className="rounded border border-slate-300 bg-slate-50">
          <button
            className="flex w-full items-center justify-between px-4 py-2 text-left"
            onClick={() => setShowRecording(!showRecording)}
          >
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold">Meeting Recording</h2>
              {isRecording && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                  Recording
                </span>
              )}
              {isUploadingRecording && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-600">
                  Uploading
                </span>
              )}
              {meetingTranscript?.status === 'processing' && (
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                  Processing
                </span>
              )}
              {meetingTranscript?.status === 'completed' && (
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
                Record the project team meeting, then process a speaker-labeled
                transcript for coach review and future LLM use.
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
                    {[2, 3, 4, 5, 6].map((count) => (
                      <option key={count} value={count}>
                        {count}
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
                  <button
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                    onClick={stopRecording}
                  >
                    Stop & Process
                  </button>
                )}
                <button
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  onClick={refreshTranscript}
                >
                  Refresh Transcript
                </button>
              </div>

              <div className="mt-3 text-sm text-slate-700">
                {isRecording && <p>Recording in progress. Click stop when the meeting ends.</p>}
                {isUploadingRecording && <p>Uploading audio and starting transcription...</p>}
                {!isUploadingRecording && meetingTranscript?.status === 'processing' && (
                  <p>
                    Transcript is processing with {meetingTranscript.provider}. This
                    panel refreshes automatically every few seconds.
                  </p>
                )}
                {meetingTranscript?.status === 'completed' && (
                  <p>
                    Transcript ready
                    {meetingTranscript.completedAt
                      ? ` • Completed ${meetingTranscript.completedAt}`
                      : ''}
                  </p>
                )}
                {transcriptError && (
                  <p className="font-semibold text-red-600">{transcriptError}</p>
                )}
              </div>

              {meetingTranscript?.formattedText && (
                <div className="mt-4 rounded border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">Transcript</h3>
                    <div className="text-xs text-slate-500">
                      {meetingTranscript.utterances?.length ?? 0} speaker turns
                    </div>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-800">
                    {meetingTranscript.formattedText}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* AI Draft Assistant — collapsible */}
        <div className="mt-2 rounded border border-violet-300 bg-violet-50">
          <button
            className="flex w-full items-center justify-between px-4 py-2 text-left"
            onClick={() => setShowAIDraft(!showAIDraft)}
          >
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-violet-800">AI Draft Assistant</h2>
              {isGeneratingDraft && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                  Generating...
                </span>
              )}
              {aiDraft && !isGeneratingDraft && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                  Draft Ready
                </span>
              )}
            </div>
            <span className="text-slate-400">{showAIDraft ? '▲' : '▼'}</span>
          </button>

          {showAIDraft && (
            <div className="border-t border-violet-200 p-4">
              <p className="mb-3 text-sm text-slate-600">
                Generate a structured CAP note draft from this meeting&apos;s transcript.
                The AI will produce Context (observations), Assessment (hypotheses), and Plan
                (verbatim from meeting) for each issue it identifies.
              </p>

              {!meetingTranscript?.formattedText && (
                <p className="mb-3 rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                  No transcript found. Record and process a meeting first using the Meeting
                  Recording panel above.
                </p>
              )}

              {/* Coach reflections input */}
              <div className="mb-3">
                <label className="mb-1 block text-sm font-semibold text-slate-700">
                  Coach Post-Meeting Reflections (optional)
                </label>
                <textarea
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-violet-400 focus:outline-none"
                  rows={3}
                  placeholder="Add any observations or context from after the meeting that aren't in the transcript..."
                  value={coachReflections}
                  onChange={(e) => setCoachReflections(e.target.value)}
                  disabled={isGeneratingDraft}
                />
              </div>

              {/* Generate button */}
              <button
                className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                disabled={isGeneratingDraft || !meetingTranscript?.formattedText}
                onClick={async () => {
                  setIsGeneratingDraft(true);
                  setDraftError(null);
                  setShowEvidence({});
                  try {
                    const res = await fetch(`/api/ai-draft/${noteInfo.id}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ coachReflections })
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) {
                      throw new Error(data.error ?? 'Failed to generate draft');
                    }
                    setAiDraft(data.data);
                    setFollowUpInput('');
                  } catch (err) {
                    setDraftError(err instanceof Error ? err.message : 'Unknown error');
                  } finally {
                    setIsGeneratingDraft(false);
                  }
                }}
              >
                {isGeneratingDraft ? 'Generating...' : aiDraft ? 'Regenerate Draft' : 'Generate Draft'}
              </button>

              {draftError && (
                <p className="mt-2 text-sm font-semibold text-red-600">{draftError}</p>
              )}

              {/* Per-issue draft cards */}
              {aiDraft && aiDraft.issues.length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-700">
                      Generated Draft — {aiDraft.issues.length} issue{aiDraft.issues.length !== 1 ? 's' : ''}
                    </h3>
                    <button
                      className="text-xs text-slate-400 underline hover:text-slate-600"
                      onClick={() => {
                        const text = aiDraft.issues.map((issue, i) => {
                          const ctx = issue.context.map(c => `- ${c}`).join('\n');
                          const asmnt = issue.assessment.map(a => `- ${a}`).join('\n');
                          const plan = issue.plan.join('\n');
                          return `Issue ${i + 1}: ${issue.title}\n\nContext:\n${ctx}\n\nAssessment:\n${asmnt}\n\nPlan:\n${plan}`;
                        }).join('\n\n---\n\n');
                        navigator.clipboard.writeText(text);
                      }}
                    >
                      Copy all
                    </button>
                  </div>

                  {aiDraft.issues.map((issue: AIDraftIssue, i: number) => (
                    <div key={i} className="rounded border border-violet-100 bg-white text-sm">
                      {/* Issue header — copy title only */}
                      <div className="flex items-start justify-between border-b border-violet-100 px-3 py-2">
                        <span className="font-semibold text-slate-800">
                          Issue {i + 1} — {issue.title}
                        </span>
                        <button
                          className="ml-2 shrink-0 text-xs text-slate-400 underline hover:text-slate-600"
                          onClick={() => navigator.clipboard.writeText(issue.title)}
                        >
                          Copy
                        </button>
                      </div>

                      <div className="divide-y divide-slate-50">
                        {/* Context */}
                        {issue.context.length > 0 && (
                          <div className="px-3 py-2">
                            <div className="mb-1 flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Context</p>
                              <button
                                className="text-xs text-slate-400 underline hover:text-slate-600"
                                onClick={() => navigator.clipboard.writeText(issue.context.map(c => `- ${c}`).join('\n'))}
                              >
                                Copy
                              </button>
                            </div>
                            <ul className="space-y-1 text-slate-700">
                              {issue.context.map((c, j) => (
                                <li key={j} className="flex gap-1.5">
                                  <span className="mt-0.5 shrink-0 text-slate-400">•</span>
                                  <span>{c}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Assessment */}
                        {issue.assessment.length > 0 && (
                          <div className="px-3 py-2">
                            <div className="mb-1 flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Assessment</p>
                              <div className="flex gap-2">
                                {issue.supporting_quotes?.length > 0 && (
                                  <button
                                    className="text-xs text-violet-500 underline hover:text-violet-700"
                                    onClick={() => setShowEvidence(prev => ({ ...prev, [i]: !prev[i] }))}
                                  >
                                    {showEvidence[i] ? 'Hide evidence' : 'Show evidence'}
                                  </button>
                                )}
                                <button
                                  className="text-xs text-slate-400 underline hover:text-slate-600"
                                  onClick={() => navigator.clipboard.writeText(issue.assessment.map(a => `- ${a}`).join('\n'))}
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                            <ul className="space-y-1 text-slate-700">
                              {issue.assessment.map((a, j) => (
                                <li key={j} className="flex gap-1.5">
                                  <span className="mt-0.5 shrink-0 text-slate-400">•</span>
                                  <span>{a}</span>
                                </li>
                              ))}
                            </ul>
                            {showEvidence[i] && issue.supporting_quotes?.length > 0 && (
                              <div className="mt-2 space-y-1 rounded bg-violet-50 p-2">
                                <p className="text-xs font-semibold text-violet-600">Supporting quotes from transcript</p>
                                {issue.supporting_quotes.map((q, j) => (
                                  <p key={j} className="text-xs italic text-slate-600">"{q}"</p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Plan */}
                        {issue.plan.length > 0 && (
                          <div className="px-3 py-2">
                            <div className="mb-1 flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Plan</p>
                              <button
                                className="text-xs text-slate-400 underline hover:text-slate-600"
                                onClick={() => navigator.clipboard.writeText(issue.plan.join('\n'))}
                              >
                                Copy
                              </button>
                            </div>
                            <ul className="space-y-1.5 text-slate-700">
                              {issue.plan.map((p, j) => {
                                const tagMatch = p.match(/^\[([^\]]+)\]/);
                                return (
                                  <li key={j} className="flex gap-1.5">
                                    <span className="mt-0.5 shrink-0 text-slate-400">•</span>
                                    <span>
                                      {tagMatch && (
                                        <span className="mr-1 rounded bg-violet-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-violet-700">
                                          [{tagMatch[1]}]
                                        </span>
                                      )}
                                      {tagMatch ? p.slice(tagMatch[0].length).trim() : p}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Refinement input */}
                  <div className="mt-1">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                        placeholder='Ask to refine, e.g. "Issue 2 missed the timeline discussion"'
                        value={followUpInput}
                        onChange={(e) => setFollowUpInput(e.target.value)}
                        disabled={isGeneratingDraft}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && !e.shiftKey && followUpInput.trim() && !isGeneratingDraft) {
                            e.preventDefault();
                            setIsGeneratingDraft(true);
                            setDraftError(null);
                            try {
                              const res = await fetch(`/api/ai-draft/${noteInfo.id}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  coachReflections,
                                  followUpMessage: followUpInput,
                                  previousDraft: JSON.stringify(aiDraft)
                                })
                              });
                              const data = await res.json();
                              if (!res.ok || !data.success) throw new Error(data.error ?? 'Failed to refine');
                              setAiDraft(data.data);
                              setFollowUpInput('');
                              setShowEvidence({});
                            } catch (err) {
                              setDraftError(err instanceof Error ? err.message : 'Unknown error');
                            } finally {
                              setIsGeneratingDraft(false);
                            }
                          }
                        }}
                      />
                      <button
                        className="rounded-full bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                        disabled={isGeneratingDraft || !followUpInput.trim()}
                        onClick={async () => {
                          if (!followUpInput.trim()) return;
                          setIsGeneratingDraft(true);
                          setDraftError(null);
                          try {
                            const res = await fetch(`/api/ai-draft/${noteInfo.id}`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                coachReflections,
                                followUpMessage: followUpInput,
                                previousDraft: JSON.stringify(aiDraft)
                              })
                            });
                            const data = await res.json();
                            if (!res.ok || !data.success) throw new Error(data.error ?? 'Failed to refine');
                            setAiDraft(data.data);
                            setFollowUpInput('');
                            setShowEvidence({});
                          } catch (err) {
                            setDraftError(err instanceof Error ? err.message : 'Unknown error');
                          } finally {
                            setIsGeneratingDraft(false);
                          }
                        }}
                      >
                        Refine
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* end collapsible panels wrapper */}
        </div>

        <DndProvider backend={HTML5Backend}>
          {/* Past issues and tracked practices pinned above note space */}
          <div className="w-full flex-shrink-0">
            <div className="mr-6 flex flex-row">
              {/* All Issues */}
              <div className="mb-5 h-[25vh] w-full">
                {/* Section title and description */}
                <div className="flex flex-col">
                  <h1 className="border-b border-black text-base font-bold">
                    Items of Concern
                  </h1>
                  <div className="h-[20vh] overflow-y-auto">
                    <p className="mb-2 text-xs italic">
                      Note any items of concern here (e.g., project issues,
                      practice gaps, developing competencies). Click on items
                      tracked from SIG to view follow-up outcomes. Click on
                      current week items to edit it&apos;s CAP notes. Create new
                      items by typing on the last card, or by dragging a prior
                      week card on it.
                      {/* Cards from this week can be dragged on top of each other to merge them, or into the CAP notes for a selected issue. */}
                    </p>

                    {/* Issues */}
                    <div className="grid grid-cols-6 gap-2">
                      {/* Last Week Issues */}
                      {pastIssuesData.map((lastWeekIssue) => (
                        <LastWeekIssueCard
                          key={`issue-card-${lastWeekIssue.id}`}
                          issueId={lastWeekIssue.id}
                          title={lastWeekIssue.title}
                          date={new Date(lastWeekIssue.date).toISOString()}
                          noteDate={serializeDateOnlyToISO(noteInfo.sigDate)}
                          selectedIssue={selectedIssue}
                          setSelectedIssue={setSelectedIssue}
                          pastIssuesData={pastIssuesData}
                          setPastIssuesData={setPastIssuesData}
                          currentIssuesData={currentIssuesData}
                          setCurrentIssuesData={setCurrentIssuesData}
                        />
                      ))}

                      {/* Current Issues */}
                      {currentIssuesData
                        .filter((currIssue) => {
                          return !(currIssue.wasDeleted || currIssue.wasMerged);
                        })
                        .map((currIssue) => (
                          <CurrWeekIssueCard
                            key={`issue-card-${currIssue.id}`}
                            project={noteInfo.project}
                            sig={noteInfo.sigName}
                            date={serializeDateOnlyToISO(noteInfo.sigDate)}
                            issueId={currIssue.id}
                            issue={currIssue}
                            selectedIssue={selectedIssue}
                            setSelectedIssue={setSelectedIssue}
                            currentIssuesData={currentIssuesData}
                            setCurrentIssuesData={setCurrentIssuesData}
                            pastIssuesData={pastIssuesData}
                            setPastIssuesData={setPastIssuesData}
                          />
                        ))}

                      {/* Create a new issue for the week */}
                      <CurrWeekIssueCard
                        key="issue-card-add-issue"
                        project={noteInfo.project}
                        sig={noteInfo.sigName}
                        date={serializeDateOnlyToISO(noteInfo.sigDate)}
                        issueId="add-issue"
                        issue={null}
                        selectedIssue={selectedIssue}
                        setSelectedIssue={setSelectedIssue}
                        currentIssuesData={currentIssuesData}
                        setCurrentIssuesData={setCurrentIssuesData}
                        pastIssuesData={pastIssuesData}
                        setPastIssuesData={setPastIssuesData}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Note Space — fills remaining viewport height */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* if no issue is selected */}
            {selectedIssue === null && (
              <div className="flex flex-1 flex-col min-h-0">
                <h1 className="sticky top-0 mb-1 border-b border-black bg-white text-base font-bold italic">
                  Select an issue from above to view or edit notes. Tracked gaps
                  in students self-regulation skills are shown below, for
                  reference.
                </h1>

                <div className="min-h-0 flex-1 w-full overflow-auto">
                  {/* Practice Cards */}
                  <div className="mb-3">
                    {/* Active Practices */}
                    <div className="grid grid-cols-3 gap-2 overflow-auto">
                      {practiceGapData
                        .filter((practiceGap) => {
                          return (
                            !practiceGap.practiceInactive &&
                            !practiceGap.practiceArchived
                          );
                        })
                        .map((practiceGap) => (
                          <PracticeGapCard
                            key={`issue-card-${practiceGap.id}`}
                            project={noteInfo.project}
                            sig={noteInfo.sigName}
                            date={serializeDateOnlyToISO(noteInfo.sigDate)}
                            practiceGapId={practiceGap.id}
                            practiceGap={practiceGap}
                            practiceGapsData={practiceGapData}
                            setPracticeGapsData={setPracticeGapData}
                            showPracticeGaps={'Show Gaps with Details'}
                            setShowPracticeGaps={setShowPracticeGaps}
                            currentIssuesData={currentIssuesData}
                            setCurrentIssuesData={setCurrentIssuesData}
                          />
                        ))}

                      {/* practice card for new practice gaps */}
                      <PracticeGapCard
                        key="issue-card-add-practice"
                        project={noteInfo.project}
                        sig={noteInfo.sigName}
                        date={serializeDateOnlyToISO(noteInfo.sigDate)}
                        practiceGapId="add-practice"
                        practiceGap={null}
                        practiceGapsData={practiceGapData}
                        setPracticeGapsData={setPracticeGapData}
                        showPracticeGaps={'Show Gaps with Details'}
                        setShowPracticeGaps={setShowPracticeGaps}
                        currentIssuesData={currentIssuesData}
                        setCurrentIssuesData={setCurrentIssuesData}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* if a current week issue is selected */}
            {selectedIssue !== null &&
              currentIssuesData.findIndex(
                (issue) => issue.id === selectedIssue
              ) !== -1 && (
                <>
                  <h1 className="sticky top-0 mb-1 border-b border-black bg-white text-base font-bold">
                    {currentIssuesData.findIndex(
                      (practice) => practice.id === selectedIssue
                    ) !== -1 &&
                      currentIssuesData[
                        currentIssuesData.findIndex(
                          (practice) => practice.id === selectedIssue
                        )
                      ].title}
                  </h1>
                  <div className="min-h-0 flex-1 w-full overflow-auto">
                    <p className="text-xs italic">
                      Write notes about selected issue below. Context and
                      Assessment notes are private to you.{' '}
                      <span className="font-semibold">
                        The Title above and Plan notes will be shared with
                        students.
                      </span>
                    </p>

                    <p className="mb-2 text-xs italic text-slate-500">
                      Press Shift-Enter to add a new text block and
                      Shift-Backspace to delete current block. Press Tab to move
                      to next block, and Shift-Tab to move to previous block.
                    </p>

                    <div className="w-full">
                      <CurrWeekIssuePane
                        key={`issue-pane-${selectedIssue}`}
                        issueId={selectedIssue}
                        project={noteInfo.project}
                        sig={noteInfo.sigName}
                        date={serializeDateOnlyToISO(noteInfo.sigDate)}
                        currentIssuesData={currentIssuesData}
                        setCurrentIssuesData={setCurrentIssuesData}
                        practiceGapData={practiceGapData}
                        setPracticeGapData={setPracticeGapData}
                      />
                    </div>
                  </div>
                </>
              )}

            {/* if a last week issue is selected */}
            {selectedIssue !== null &&
              pastIssuesData.findIndex(
                (issue) => issue.id === selectedIssue
              ) !== -1 && ( // Selected issue is a last week issue
                <>
                  <h1 className="sticky top-0 mb-1 border-b border-black bg-white text-base font-bold">
                    {pastIssuesData.findIndex(
                      (issue) => issue.id === selectedIssue
                    ) !== -1 &&
                      pastIssuesData[
                        pastIssuesData.findIndex(
                          (practice) => practice.id === selectedIssue
                        )
                      ].title}
                  </h1>

                  <div className="min-h-0 flex-1 w-full overflow-auto">
                    <LastWeekIssuePane
                      issueId={selectedIssue}
                      noteInfo={noteInfo}
                      currentIssuesData={currentIssuesData}
                      setCurrentIssuesData={setCurrentIssuesData}
                      pastIssuesData={pastIssuesData}
                      setPastIssuesData={setPastIssuesData}
                      practiceGapData={practiceGapData}
                      setPracticeGapData={setPracticeGapData}
                    />
                  </div>
                </>
              )}
          </div>
        </DndProvider>
      </div>
    </>
  );
}

// use serverside rendering to generate this page
export const getServerSideProps: GetServerSideProps = async (query) => {
  // helper function to convert mongo ids to strings
  const mongoIdFlattener = {
    transform: function (doc, ret) {
      if (ret?._id != null) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
    }
  };

  // helper function to add a placeholder line if there is no data
  const addPlaceholderLine = (object) => {
    const placeholderLine = {
      id: new mongoose.Types.ObjectId().toString(),
      ...createNewTextEntryBlock()
    };

    return {
      ...object,
      context: object.context.length === 0 ? [placeholderLine] : object.context,
      assessment:
        object.assessment.length === 0 ? [placeholderLine] : object.assessment,
      plan: object.plan.length === 0 ? [placeholderLine] : object.plan
    };
  };

  // get the sig name and date from the query
  let capNoteId = query.params?.id as string;

  /**
   *
   * fetch CAP note for the given sig and date, and format for display
   */
  // TODO: see how I can add type checking to this
  let currentCAPNote = await fetchCAPNoteById(capNoteId);
  let currentCAPNoteFlattened = serializeDates(
    currentCAPNote.toJSON(mongoIdFlattener)
  );

  // get the issues for the current note
  let pastIssues = await fetchIssueObjectsByIds(
    currentCAPNote.pastIssues.map((issue) => issue._id)
  );
  let pastIssuesFlattened = pastIssues.map((issue) => {
    let flattenedData = serializeDates(issue.toJSON(mongoIdFlattener));
    flattenedData.priorInstances = issue.priorInstances.map((instance) => {
      return instance.toString();
    });
    return flattenedData;
  });

  let currentIssues = await fetchIssueObjectsByIds(
    currentCAPNote.currentIssues.map((issue) => issue._id)
  );
  let currentIssuesFlattened = currentIssues.map((issue) => {
    let flattenedData = addPlaceholderLine(
      serializeDates(issue.toJSON(mongoIdFlattener))
    );
    flattenedData.priorInstances = issue.priorInstances.map((instance) => {
      return instance.toString();
    });
    return flattenedData;
  });

  // get tracked practice for the current note
  let trackedPractices = await fetchProjectGapObjectsByIds(
    currentCAPNote.trackedPractices.map((practice) => practice._id)
  );
  let trackedPracticesFlattened = trackedPractices.map((practice) => {
    return serializeDates(practice.toJSON(mongoIdFlattener));
  });

  // fetch issues for prevIssues linked to practices
  for (const trackedPractice of trackedPracticesFlattened) {
    trackedPractice.prevIssues = (
      await fetchIssueObjectsByIds(
        trackedPractice.prevIssues.map((issue) => issue._id)
      )
    ).map((issue) => {
      let flattenedData = serializeDates(issue.toJSON(mongoIdFlattener));
      flattenedData.priorInstances = issue.priorInstances.map((instance) => {
        return instance.toString();
      });
      return flattenedData;
    });
  }

  // create data object for display
  const capNoteInfo = {
    id: currentCAPNoteFlattened.id,
    project: currentCAPNoteFlattened.project,
    sigName: currentCAPNoteFlattened.sigName,
    sigAbbreviation: currentCAPNoteFlattened.sigAbbreviation,
    sigDate: currentCAPNoteFlattened.date,
    lastUpdated: currentCAPNoteFlattened.lastUpdated,
    context: currentCAPNoteFlattened.context,
    assessment: currentCAPNoteFlattened.assessment,
    plan: currentCAPNoteFlattened.plan,
    pastIssues: currentCAPNoteFlattened.pastIssues.map((issue) => {
      return issue.toString();
    }),
    currentIssues: currentCAPNoteFlattened.currentIssues.map((issue) => {
      return issue.toString();
    }),
    trackedPractices: currentCAPNoteFlattened.trackedPractices.map(
      (practice) => {
        return practice.toString();
      }
    ),
    meetingTranscript: currentCAPNoteFlattened.meetingTranscript ?? null
  };

  /**
   * fetch contextual data from OS
   */
  let contextualData;
  try {
    const res = await fetch(
      `${process.env.ORCH_ENGINE}/organizationalObjects/getComputedOrganizationalObjectsForProject`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ projectName: currentCAPNote.project })
      }
    );

    contextualData = await res.json();
  } catch (err) {
    console.error(err);
  }
  // setup tracked data
  let sprintStories;
  try {
    sprintStories = contextualData.project.tools.sprintLog.stories.map(
      (story) => {
        return `- ${story.description}`;
      }
    );
  } catch (err) {
    sprintStories = ['unable to fetch sprint stories'];
  }

  let sprintPoints;
  try {
    sprintPoints = contextualData.project.tools.sprintLog.points.map(
      (pointsForPerson) => {
        return `- ${pointsForPerson.name}: ${pointsForPerson.pointsCommitted.total} points out of ${pointsForPerson.pointsAvailable} committed; ${pointsForPerson.hoursSpent.total} hours spent`;
      }
    );
  } catch (err) {
    sprintPoints = ['unable to fetch sprint points'];
  }

  // /**
  //  * get active issues from OS
  //  * TODO: if using these, make them create cards that can be removed
  //  */
  // let activeIssues;
  // try {
  //   const res = await fetch(
  //     `${
  //       process.env.ORCH_ENGINE
  //     }/activeIssues/fetchActiveIssuesForProject?${new URLSearchParams({
  //       projectName: currentCAPNote.project
  //     })}`
  //   );
  //   activeIssues = await res.json();
  // } catch (err) {
  //   console.error(err);
  // }

  // // TODO: 03-03-24 -- see if I can filter out actionable followups and get some context separately
  // // get only issues and follow-ups for next SIG
  // const triggeredScripts = activeIssues
  //   .filter(
  //     (issue) =>
  //       !issue.name.includes('actionable follow-up') ||
  //       (issue.name.includes('actionable follow-up') &&
  //         (issue.name.includes('morning of next SIG') ||
  //           issue.name.includes('at next SIG')))
  //   )
  //   .map((script) => {
  //     return {
  //       name: script.name,
  //       type: script.name.includes('follow-up') ? 'follow-up' : 'issue',
  //       strategies: script.computed_strategies[0].outlet_args.message
  //     };
  //   });

  // // add active issues to SOAP notes
  // for (let script of triggeredScripts) {
  //   let scriptType = '';
  //   switch (script.type) {
  //     case 'follow-up':
  //       scriptType = 'follow-up';
  //       break;
  //     case 'practice':
  //       scriptType = 'practice';
  //       break;
  //     case 'issue':
  //     default:
  //       scriptType = 'detected issue';
  //   }
  //   let title =
  //     scriptType == 'follow-up'
  //       ? `[${scriptType}] ${script.strategies}`
  //       : `[${scriptType}] ${script.name} - ${script.strategies}`;
  //   let titleIndex = capNoteInfo.context.findIndex(
  //     (line) => line.value === title
  //   );

  //   if (titleIndex === -1) {
  //     capNoteInfo.context.push({
  //       id: new mongoose.Types.ObjectId().toString(),
  //       type: 'script',
  //       context: [],
  //       value: title
  //     });
  //   }
  // }

  // // sort context notes by [detected issues] first
  // capNoteInfo.context.sort((a, b) => {
  //   if (a.type === 'script' && b.type !== 'script') {
  //     return -1;
  //   } else {
  //     return 1;
  //   }
  // });

  // setup the page with the data from the database
  const lastWeekIssues = pastIssuesFlattened;
  const currentWeekIssues = currentIssuesFlattened;
  const practiceGaps = trackedPracticesFlattened;

  // print before returning if in development
  const env = process.env.NODE_ENV;
  if (env == 'development') {
    console.log('capNoteInfo', JSON.stringify(capNoteInfo, null, 2));
    console.log('lastWeekIssues', JSON.stringify(lastWeekIssues, null, 2));
    console.log(
      'currentWeekIssues',
      JSON.stringify(currentWeekIssues, null, 2)
    );
    console.log('practiceGaps', JSON.stringify(practiceGaps, null, 2));
  }

  return {
    props: {
      capNoteInfo: capNoteInfo,
      lastWeekIssues,
      currentWeekIssues,
      practiceGaps
    }
  };
};

import { useEffect, useRef, useState } from 'react';

export interface TranscriptEntry {
  id: string;
  capNoteId: string | null;
  status: 'idle' | 'processing' | 'completed' | 'error';
  provider: string;
  transcriptId: string | null;
  audioMimeType: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  text: string;
  formattedText: string;
  utterances: { speaker: string; text: string; start: number | null; end: number | null }[];
  error: string | null;
}

export function useTeamRecording(
  capNoteId: string,
  initialTranscripts: TranscriptEntry[],
  memberNames: string[] = []
) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [meetingTranscripts, setMeetingTranscripts] = useState<TranscriptEntry[]>(initialTranscripts);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isUploadingRecording, setIsUploadingRecording] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [audioPlaybackUrl, setAudioPlaybackUrl] = useState<string | null>(null);
  const [expandedTranscriptIds, setExpandedTranscriptIds] = useState<Set<string>>(new Set());
  const [speakerNameMaps, setSpeakerNameMaps] = useState<Record<string, Record<string, string>>>({});
  const [expectedSpeakers, setExpectedSpeakers] = useState(
    Math.max(2, Math.min(memberNames.length || 2, 6))
  );

  const hasProcessingTranscript = meetingTranscripts.some((t) => t.status === 'processing');

  useEffect(() => {
    if (!hasProcessingTranscript) return;
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/transcripts/${capNoteId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Unable to refresh transcript');
        setMeetingTranscripts(data.data);
        const errored = data.data?.find((t: any) => t.status === 'error' && t.error);
        if (errored) setTranscriptError(errored.error ?? 'Transcription processing failed');
      } catch (e) {
        setTranscriptError(e instanceof Error ? e.message : 'Unable to refresh transcript status');
      }
    }, 5000);
    return () => clearInterval(intervalId);
  }, [hasProcessingTranscript, capNoteId]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    try {
      setTranscriptError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m)
      );
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
      mediaRecorderRef.current = recorder;

      recorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      });

      recorder.addEventListener('stop', async () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        setAudioPlaybackUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setIsUploadingRecording(true);
        try {
          const res = await fetch(`/api/transcripts/${capNoteId}`, {
            method: 'POST',
            headers: {
              'Content-Type': blob.type,
              'x-expected-speakers': String(expectedSpeakers)
            },
            body: blob
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? 'Unable to start transcription');
          setMeetingTranscripts((prev) => [data.data, ...prev]);
        } catch (e) {
          setTranscriptError(e instanceof Error ? e.message : 'Unable to upload meeting recording');
        } finally {
          setIsUploadingRecording(false);
          mediaRecorderRef.current = null;
        }
      });

      recorder.start(1000);
      setIsRecording(true);
    } catch (e) {
      setTranscriptError(e instanceof Error ? e.message : 'Unable to access microphone for recording');
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;
    if (mediaRecorderRef.current.state === 'paused') mediaRecorderRef.current.resume();
    mediaRecorderRef.current.requestData();
    mediaRecorderRef.current.stop();
    setIsRecording(false);
    setIsPaused(false);
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  };

  const toggleExpandedTranscript = (id: string) => {
    setExpandedTranscriptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getTranscriptWithNames = (formattedText: string, transcriptId: string) => {
    let result = formattedText;
    const nameMap = speakerNameMaps[transcriptId] ?? {};
    Object.entries(nameMap).forEach(([label, name]) => {
      if (name.trim())
        result = result.replace(
          new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          name
        );
    });
    return result;
  };

  return {
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
  };
}

import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/dbConnect';
import CAPNoteModel from '../../../models/CAPNoteModel';
import MeetingTranscriptModel from '../../../models/MeetingTranscriptModel';

type TranscriptResponse = {
  success: boolean;
  data?: any;
  error?: string;
};

const ASSEMBLY_AI_API = 'https://api.assemblyai.com/v2';

const getAssemblyHeaders = (contentType?: string) => {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not configured');
  }

  return {
    authorization: apiKey,
    ...(contentType ? { 'content-type': contentType } : {})
  };
};

const readRawBody = async (req: NextApiRequest): Promise<Buffer> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

const formatUtterances = (utterances: any[] | null = []) => {
  if (!utterances) return [];
  return utterances.map((utterance) => ({
    speaker: utterance.speaker ? `Speaker ${utterance.speaker}` : 'Speaker',
    text: utterance.text ?? '',
    start:
      typeof utterance.start === 'number' ? Math.round(utterance.start) : null,
    end: typeof utterance.end === 'number' ? Math.round(utterance.end) : null
  }));
};

const formatTranscriptText = (utterances: any[] | null = [], fallbackText = '') => {
  if (!utterances || !utterances.length) {
    return fallbackText;
  }

  return utterances
    .map((utterance) => {
      const speaker = utterance.speaker
        ? `Speaker ${utterance.speaker}`
        : 'Speaker';
      return `${speaker}: ${utterance.text ?? ''}`;
    })
    .join('\n\n');
};

const serializeTranscript = (doc: any) => {
  const obj = doc.toObject ? doc.toObject() : doc;
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
};

/**
 * Syncs any 'processing' transcripts against AssemblyAI and saves updates.
 * Returns all transcript docs for the cap note sorted newest first.
 */
const syncAndFetchTranscripts = async (capNoteId: string) => {
  const capNote = await CAPNoteModel.findById(capNoteId);
  if (!capNote) {
    throw new Error('CAP note not found');
  }

  // One-time migration: legacy embedded meetingTranscript → meetingTranscripts collection
  // Guard by checking the collection directly — the capNote array is not reliably persisted
  if (capNote.meetingTranscript?.transcriptId) {
    const existingCount = await MeetingTranscriptModel.countDocuments({
      capNoteId: capNote._id
    });
    if (existingCount === 0) {
      const legacy = (capNote.meetingTranscript as any).toObject();
      const migratedDoc = await MeetingTranscriptModel.create({
        capNoteId: capNote._id,
        provider: legacy.provider ?? 'assemblyai',
        status: legacy.status === 'idle' ? 'completed' : legacy.status,
        transcriptId: legacy.transcriptId,
        audioMimeType: legacy.audioMimeType,
        requestedAt: legacy.requestedAt,
        completedAt: legacy.completedAt,
        text: legacy.text,
        formattedText: legacy.formattedText,
        utterances: legacy.utterances ?? [],
        error: legacy.error
      });
      if (!capNote.meetingTranscripts) capNote.meetingTranscripts = [];
      capNote.meetingTranscripts.push(migratedDoc._id);
      await capNote.save();
    }
  }

  const transcripts = await MeetingTranscriptModel.find({ capNoteId }).sort({
    requestedAt: -1
  });

  // Sync any still-processing transcripts with AssemblyAI
  for (const transcript of transcripts) {
    if (transcript.status !== 'processing' || !transcript.transcriptId) {
      continue;
    }

    const transcriptRes = await fetch(
      `${ASSEMBLY_AI_API}/transcript/${transcript.transcriptId}`,
      { headers: getAssemblyHeaders() }
    );
    const transcriptJson = await transcriptRes.json();

    if (!transcriptRes.ok) {
      throw new Error(
        transcriptJson?.error ?? 'Unable to fetch transcript from AssemblyAI'
      );
    }

    if (transcriptJson.status === 'completed') {
      transcript.status = 'completed';
      transcript.completedAt = new Date().toISOString();
      transcript.text = transcriptJson.text ?? '';
      transcript.formattedText = formatTranscriptText(
        transcriptJson.utterances,
        transcriptJson.text ?? ''
      );
      transcript.utterances = formatUtterances(transcriptJson.utterances);
      transcript.error = null;
      await transcript.save();
    } else if (transcriptJson.status === 'error') {
      transcript.status = 'error';
      transcript.completedAt = new Date().toISOString();
      transcript.error =
        transcriptJson.error ?? 'AssemblyAI transcription failed';
      await transcript.save();
    }
  }

  return transcripts;
};

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TranscriptResponse>
) {
  const {
    query: { id },
    method
  } = req;

  if (typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid CAP note id' });
  }

  await dbConnect();

  switch (method) {
    case 'GET':
      try {
        const transcripts = await syncAndFetchTranscripts(id);
        return res
          .status(200)
          .json({ success: true, data: transcripts.map(serializeTranscript) });
      } catch (error) {
        console.error('Error fetching transcripts:', error);
        return res.status(400).json({
          success: false,
          error:
            error instanceof Error ? error.message : 'Unable to fetch transcripts'
        });
      }

    case 'POST':
      try {
        const capNote = await CAPNoteModel.findById(id);
        if (!capNote) {
          return res
            .status(404)
            .json({ success: false, error: 'CAP note not found' });
        }

        const audioBuffer = await readRawBody(req);
        if (!audioBuffer.length) {
          return res
            .status(400)
            .json({ success: false, error: 'No audio received' });
        }

        const audioMimeType = Array.isArray(req.headers['content-type'])
          ? req.headers['content-type'][0]
          : req.headers['content-type'] ?? 'application/octet-stream';
        const expectedSpeakersHeader = Array.isArray(
          req.headers['x-expected-speakers']
        )
          ? req.headers['x-expected-speakers'][0]
          : req.headers['x-expected-speakers'];
        const expectedSpeakers = Number(expectedSpeakersHeader);
        const shouldUseExactSpeakerCount =
          Number.isFinite(expectedSpeakers) &&
          expectedSpeakers >= 2 &&
          expectedSpeakers <= 10;

        const uploadRes = await fetch(`${ASSEMBLY_AI_API}/upload`, {
          method: 'POST',
          headers: getAssemblyHeaders(audioMimeType),
          body: audioBuffer as unknown as BodyInit
        });
        const uploadJson = await uploadRes.json();

        if (!uploadRes.ok || !uploadJson.upload_url) {
          throw new Error(uploadJson?.error ?? 'AssemblyAI upload failed');
        }

        const transcriptRes = await fetch(`${ASSEMBLY_AI_API}/transcript`, {
          method: 'POST',
          headers: getAssemblyHeaders('application/json'),
          body: JSON.stringify({
            audio_url: uploadJson.upload_url,
            speech_models: ['universal-3-pro', 'universal-2'],
            language_detection: true,
            speaker_labels: true,
            speakers_expected: shouldUseExactSpeakerCount ? expectedSpeakers : 2
          })
        });
        const transcriptJson = await transcriptRes.json();

        if (!transcriptRes.ok || !transcriptJson.id) {
          throw new Error(
            transcriptJson?.error ?? 'AssemblyAI transcript creation failed'
          );
        }

        const newTranscript = await MeetingTranscriptModel.create({
          capNoteId: capNote._id,
          provider: 'assemblyai',
          status: 'processing',
          transcriptId: transcriptJson.id,
          audioMimeType,
          requestedAt: new Date().toISOString(),
          completedAt: null,
          text: '',
          formattedText: '',
          utterances: [],
          error: null
        });

        capNote.meetingTranscripts.push(newTranscript._id);
        await capNote.save();

        return res
          .status(200)
          .json({ success: true, data: serializeTranscript(newTranscript) });
      } catch (error) {
        console.error('Error starting transcript:', error);
        return res.status(400).json({
          success: false,
          error:
            error instanceof Error ? error.message : 'Unable to start transcript'
        });
      }

    default:
      return res
        .status(405)
        .json({ success: false, error: 'Method not allowed' });
  }
}

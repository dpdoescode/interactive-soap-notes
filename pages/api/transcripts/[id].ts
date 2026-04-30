import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/dbConnect';
import CAPNoteModel from '../../../models/CAPNoteModel';

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

const formatUtterances = (utterances: any[] = []) => {
  return utterances.map((utterance) => ({
    speaker: utterance.speaker ? `Speaker ${utterance.speaker}` : 'Speaker',
    text: utterance.text ?? '',
    start:
      typeof utterance.start === 'number' ? Math.round(utterance.start) : null,
    end: typeof utterance.end === 'number' ? Math.round(utterance.end) : null
  }));
};

const formatTranscriptText = (utterances: any[] = [], fallbackText = '') => {
  if (!utterances.length) {
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

const syncTranscriptStatus = async (capNoteId: string) => {
  const capNote = await CAPNoteModel.findById(capNoteId);
  if (!capNote) {
    throw new Error('CAP note not found');
  }

  const meetingTranscript = capNote.meetingTranscript;
  if (!meetingTranscript?.transcriptId) {
    return meetingTranscript ?? null;
  }

  if (meetingTranscript.status !== 'processing') {
    return meetingTranscript;
  }

  const transcriptRes = await fetch(
    `${ASSEMBLY_AI_API}/transcript/${meetingTranscript.transcriptId}`,
    {
      headers: getAssemblyHeaders()
    }
  );
  const transcriptJson = await transcriptRes.json();

  if (!transcriptRes.ok) {
    throw new Error(
      transcriptJson?.error ?? 'Unable to fetch transcript from AssemblyAI'
    );
  }

  if (transcriptJson.status === 'completed') {
    capNote.meetingTranscript = {
      ...meetingTranscript.toObject(),
      status: 'completed',
      completedAt: new Date().toISOString(),
      text: transcriptJson.text ?? '',
      formattedText: formatTranscriptText(
        transcriptJson.utterances,
        transcriptJson.text ?? ''
      ),
      utterances: formatUtterances(transcriptJson.utterances),
      error: null
    };
    await capNote.save();
  } else if (transcriptJson.status === 'error') {
    capNote.meetingTranscript = {
      ...meetingTranscript.toObject(),
      status: 'error',
      completedAt: new Date().toISOString(),
      error: transcriptJson.error ?? 'AssemblyAI transcription failed'
    };
    await capNote.save();
  }

  return capNote.meetingTranscript;
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
        const transcript = await syncTranscriptStatus(id);
        return res.status(200).json({ success: true, data: transcript });
      } catch (error) {
        console.error('Error syncing transcript status:', error);
        return res.status(400).json({
          success: false,
          error:
            error instanceof Error ? error.message : 'Unable to fetch transcript'
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
          body: audioBuffer
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
            speech_models: ['universal-3-pro'],
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

        capNote.meetingTranscript = {
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
        };
        await capNote.save();

        return res.status(200).json({
          success: true,
          data: capNote.meetingTranscript
        });
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

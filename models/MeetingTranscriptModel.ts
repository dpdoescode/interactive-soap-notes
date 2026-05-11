import mongoose, { Types } from 'mongoose';

export interface MeetingTranscriptUtteranceStruct {
  speaker: string;
  text: string;
  start: number | null;
  end: number | null;
}

export interface MeetingTranscriptDocStruct {
  capNoteId: Types.ObjectId;
  provider: string;
  status: 'processing' | 'completed' | 'error';
  transcriptId: string | null;
  audioMimeType: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  text: string;
  formattedText: string;
  utterances: MeetingTranscriptUtteranceStruct[];
  error: string | null;
}

const MeetingTranscriptUtteranceSchema =
  new mongoose.Schema<MeetingTranscriptUtteranceStruct>(
    {
      speaker: { type: String, required: true },
      text: { type: String, required: true },
      start: { type: Number, default: null },
      end: { type: Number, default: null }
    },
    { _id: false }
  );

const MeetingTranscriptSchema = new mongoose.Schema<MeetingTranscriptDocStruct>(
  {
    capNoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CAPNote',
      required: true,
      index: true
    },
    provider: { type: String, default: 'assemblyai' },
    status: {
      type: String,
      enum: ['processing', 'completed', 'error'],
      default: 'processing'
    },
    transcriptId: { type: String, default: null },
    audioMimeType: { type: String, default: null },
    requestedAt: { type: String, default: null },
    completedAt: { type: String, default: null },
    text: { type: String, default: '' },
    formattedText: { type: String, default: '' },
    utterances: { type: [MeetingTranscriptUtteranceSchema], default: [] },
    error: { type: String, default: null }
  },
  { timestamps: false }
);

export default (mongoose.models
  .MeetingTranscript as mongoose.Model<MeetingTranscriptDocStruct>) ||
  mongoose.model('MeetingTranscript', MeetingTranscriptSchema);

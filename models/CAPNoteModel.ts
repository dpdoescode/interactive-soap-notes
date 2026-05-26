import mongoose, { Types } from 'mongoose';
import { TextEntrySchema, TextEntryStruct } from './TextEntryModel';

export interface MeetingTranscriptUtteranceStruct {
  speaker: string;
  text: string;
  start: number | null;
  end: number | null;
}

export interface MeetingTranscriptStruct {
  provider: string;
  status: 'idle' | 'processing' | 'completed' | 'error';
  transcriptId: string | null;
  audioMimeType: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  text: string;
  formattedText: string;
  utterances: MeetingTranscriptUtteranceStruct[];
  error: string | null;
}

export interface CAPStruct {
  project: string;
  date: Date;
  lastUpdated: Date;
  sigName: string;
  sigAbbreviation: string;
  context: TextEntryStruct[];
  assessment: TextEntryStruct[];
  plan: TextEntryStruct[];
  pastIssues: Types.ObjectId[];
  currentIssues: Types.ObjectId[];
  trackedPractices: Types.ObjectId[];
  meetingTranscripts: Types.ObjectId[];
  aiDrafts: Types.ObjectId[];
  /** @deprecated migrated to meetingTranscripts collection */
  meetingTranscript?: MeetingTranscriptStruct | null;
}

const MeetingTranscriptUtteranceSchema =
  new mongoose.Schema<MeetingTranscriptUtteranceStruct>(
    {
      speaker: {
        type: String,
        required: true
      },
      text: {
        type: String,
        required: true
      },
      start: {
        type: Number,
        default: null
      },
      end: {
        type: Number,
        default: null
      }
    },
    { _id: false }
  );

const MeetingTranscriptSchema = new mongoose.Schema<MeetingTranscriptStruct>(
  {
    provider: {
      type: String,
      default: 'assemblyai'
    },
    status: {
      type: String,
      enum: ['idle', 'processing', 'completed', 'error'],
      default: 'idle'
    },
    transcriptId: {
      type: String,
      default: null
    },
    audioMimeType: {
      type: String,
      default: null
    },
    requestedAt: {
      type: String,
      default: null
    },
    completedAt: {
      type: String,
      default: null
    },
    text: {
      type: String,
      default: ''
    },
    formattedText: {
      type: String,
      default: ''
    },
    utterances: {
      type: [MeetingTranscriptUtteranceSchema],
      default: []
    },
    error: {
      type: String,
      default: null
    }
  },
  { _id: false }
);

const CAPNote = new mongoose.Schema<CAPStruct>({
  project: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  lastUpdated: {
    type: Date,
    required: true
  },
  sigName: {
    type: String,
    required: true
  },
  sigAbbreviation: {
    type: String,
    required: true
  },
  // TODO: CAP won't be used in the future, but keeping for now so I don't have to migrate
  context: [TextEntrySchema],
  assessment: [TextEntrySchema],
  plan: [TextEntrySchema],
  pastIssues: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IssueObject'
    }
  ],
  currentIssues: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IssueObject'
    }
  ],
  trackedPractices: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PracticeGapObject'
    }
  ],
  meetingTranscripts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MeetingTranscript'
    }
  ],
  aiDrafts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AIDraft'
    }
  ],
  meetingTranscript: {
    type: MeetingTranscriptSchema,
    default: () => ({
      provider: 'assemblyai',
      status: 'idle',
      transcriptId: null,
      audioMimeType: null,
      requestedAt: null,
      completedAt: null,
      text: '',
      formattedText: '',
      utterances: [],
      error: null
    })
  }
});

export default (mongoose.models.CAPNote as mongoose.Model<CAPStruct>) ||
  mongoose.model('CAPNote', CAPNote);

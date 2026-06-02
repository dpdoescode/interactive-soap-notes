import mongoose, { Types } from 'mongoose';

export interface AIDraftIssueStruct {
  title: string;
  context: string[];
  assessment: string[];
  supporting_quotes: string[];
  plan: string[];
}

export interface GapSuggestionStruct {
  type: 'existing' | 'new';
  gapTitle: string;
  gapDescription: string;
  issueTitle: string;
  assessmentEntry: string;
  evidenceSummary: string;
}

export interface AIDraftDocStruct {
  capNoteId: Types.ObjectId;
  version: number;
  generatedAt: string;
  issues: AIDraftIssueStruct[];
  gapSuggestions: GapSuggestionStruct[];
  followUpMessage: string | null;
}

const AIDraftIssueSchema = new mongoose.Schema<AIDraftIssueStruct>(
  {
    title: { type: String, default: '' },
    context: { type: [String], default: [] },
    assessment: { type: [String], default: [] },
    supporting_quotes: { type: [String], default: [] },
    plan: { type: [String], default: [] }
  },
  { _id: false }
);

const GapSuggestionSchema = new mongoose.Schema<GapSuggestionStruct>(
  {
    type: { type: String, enum: ['existing', 'new'], required: true },
    gapTitle: { type: String, required: true },
    gapDescription: { type: String, default: '' },
    issueTitle: { type: String, required: true },
    assessmentEntry: { type: String, required: true },
    evidenceSummary: { type: String, required: true }
  },
  { _id: false }
);

const AIDraftSchema = new mongoose.Schema<AIDraftDocStruct>(
  {
    capNoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CAPNote',
      required: true,
      index: true
    },
    version: { type: Number, required: true },
    generatedAt: { type: String, required: true },
    issues: { type: [AIDraftIssueSchema], default: [] },
    gapSuggestions: { type: [GapSuggestionSchema], default: [] },
    followUpMessage: { type: String, default: null }
  },
  { timestamps: false }
);

export default (mongoose.models.AIDraft as mongoose.Model<AIDraftDocStruct>) ||
  mongoose.model('AIDraft', AIDraftSchema);

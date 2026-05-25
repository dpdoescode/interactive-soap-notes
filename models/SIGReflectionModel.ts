import mongoose from 'mongoose';

export interface TeamReflectionStruct {
  project: string;
  capNoteId: mongoose.Types.ObjectId;
  coachReflections: { pre: string; mid: string; post: string };
}

export interface SIGReflectionStruct {
  sigAbbreviation: string;
  sigName: string;
  weekOf: Date;
  teams: TeamReflectionStruct[];
}

const TeamReflectionSchema = new mongoose.Schema<TeamReflectionStruct>(
  {
    project: { type: String, required: true },
    capNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'CAPNote', required: true },
    coachReflections: {
      pre: { type: String, default: '' },
      mid: { type: String, default: '' },
      post: { type: String, default: '' }
    }
  },
  { _id: false }
);

const SIGReflection = new mongoose.Schema<SIGReflectionStruct>(
  {
    sigAbbreviation: { type: String, required: true },
    sigName: { type: String, default: '' },
    weekOf: { type: Date, required: true },
    teams: { type: [TeamReflectionSchema], default: [] }
  },
  { timestamps: true }
);

SIGReflection.index({ sigAbbreviation: 1, weekOf: 1 }, { unique: true });

export default (mongoose.models.SIGReflection as mongoose.Model<SIGReflectionStruct>) ||
  mongoose.model('SIGReflection', SIGReflection);

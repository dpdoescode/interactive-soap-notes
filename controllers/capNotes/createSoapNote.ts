import crypto from 'crypto';
import mongoose from 'mongoose';
import dbConnect from '../../lib/dbConnect';
import CAPNoteModel from '../../models/CAPNoteModel';
import IssueObjectModel from '../../models/IssueObjectModel';
import { createNewTextEntryBlock } from '../textEntryBlock/createNewTextEntryBlock';

const getDeterministicCAPNoteId = (projectName: string, normalizedDate: Date) => {
  const stableHex = crypto
    .createHash('md5')
    .update(`${projectName}::${normalizedDate.toISOString()}`)
    .digest('hex')
    .slice(0, 24);

  return new mongoose.Types.ObjectId(stableHex);
};

/**
 * Create a new CAP note given the project and date of the note.
 * @param projectName
 * @param noteDate
 */
export const createCAPNote = async (projectName: string, noteDate: Date) => {
  try {
    await dbConnect();

    const normalizedDate = new Date(
      Date.UTC(
        noteDate.getUTCFullYear(),
        noteDate.getUTCMonth(),
        noteDate.getUTCDate()
      )
    );

    const existingCAPNote = await CAPNoteModel.findOne({
      project: projectName,
      date: normalizedDate
    });

    if (existingCAPNote) {
      return existingCAPNote;
    }

    // get proj and sig info
    const projInfoRes = await fetch(
      `${process.env.STUDIO_API}/projects/byName?${new URLSearchParams({
        populateTools: 'false',
        projectName: projectName
      })}`
    );
    let projInfo = await projInfoRes.json();

    const socialStructuresRes = await fetch(
      `${process.env.STUDIO_API}/socialStructures`
    );
    let socialStructuresInfo = await socialStructuresRes.json();

    // parse out sigName and sigAbbreviation
    let sigName = projInfo.sig_name;
    let sigAbbreviation = socialStructuresInfo.find(
      (socialStructure) =>
        socialStructure.name === sigName &&
        socialStructure.kind === 'SigStructure'
    ).abbreviation;

    // get the previous CAP note for the project
    const previousCAPNotes = await CAPNoteModel.find({
      project: projectName,
      sigName: sigName
    }).sort({ date: -1 });
    const previousCAPNote = previousCAPNotes[0];

    // get the currentIssues from the prior CAP note, which will become the pastIssues for the new note
    let pastIssues = [];
    let trackedPractices = [];
    if (previousCAPNote) {
      // using the currentIssue ids from the prior note, fetch all those IssueObjects and only include ones where wasDeleted and wasMerged is false (i.e., the mentor didn't remove them after notetaking or consolidate it with another issue) as pastIssues
      const pastIssueIds = previousCAPNote.currentIssues;
      const issueObjects = await IssueObjectModel.find({
        _id: { $in: pastIssueIds }
      });
      pastIssues = issueObjects
        .filter((issue) => !issue.wasDeleted && !issue.wasMerged)
        .map((issue) => issue._id);

      // keep all tracked practices
      trackedPractices = previousCAPNote.trackedPractices;
    }

    // save the new SOAP note to the database
    return await CAPNoteModel.create({
      _id: getDeterministicCAPNoteId(projectName, normalizedDate),
      project: projectName,
      date: normalizedDate,
      lastUpdated: normalizedDate,
      sigName: sigName,
      sigAbbreviation: sigAbbreviation,
      context: [createNewTextEntryBlock()],
      assessment: [createNewTextEntryBlock()],
      plan: [createNewTextEntryBlock()],
      pastIssues: pastIssues,
      currentIssues: [],
      trackedPractices: trackedPractices
    });
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      err.code === 11000
    ) {
      return await CAPNoteModel.findOne({
        project: projectName,
        date: new Date(
          Date.UTC(
            noteDate.getUTCFullYear(),
            noteDate.getUTCMonth(),
            noteDate.getUTCDate()
          )
        )
      });
    }

    console.error(
      'Error in creating CAP note: ',
      err,
      err instanceof Error ? err.stack : undefined
    );
    return null;
  }
};

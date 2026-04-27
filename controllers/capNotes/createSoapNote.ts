import mongoose from 'mongoose';
import dbConnect from '../../lib/dbConnect';
import CAPNoteModel from '../../models/CAPNoteModel';
import IssueObjectModel from '../../models/IssueObjectModel';
import { createNewTextEntryBlock } from '../textEntryBlock/createNewTextEntryBlock';
import { createPreSigReflectionMessage } from '../followUpObjects/createFollowUpStrategies';

const refreshPreviousNotePreSigIssue = async (
  previousCAPNote,
  nextCAPNoteDate: Date,
  projectName: string
) => {
  if (!process.env.ORCH_ENGINE || !previousCAPNote?._id) {
    return;
  }

  const orgObjRes = await fetch(
    `${process.env.ORCH_ENGINE}/organizationalObjects/getComputedOrganizationalObjectsForProject`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ projectName })
    }
  );

  if (!orgObjRes.ok) {
    throw new Error(
      `Could not fetch computed organizational objects for ${projectName}`
    );
  }

  const orgObjs = await orgObjRes.json();
  const preSigReflectionScript = createPreSigReflectionMessage(
    previousCAPNote._id.toString(),
    projectName,
    previousCAPNote.date.toISOString(),
    orgObjs,
    nextCAPNoteDate.toISOString()
  );

  const preSigReflectionOSRes = await fetch(
    `${process.env.ORCH_ENGINE}/activeissues/createActiveIssue`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(preSigReflectionScript)
    }
  );

  if (!preSigReflectionOSRes.ok) {
    throw new Error(
      `Could not refresh pre-sig reflection for ${projectName} on ${previousCAPNote.date.toISOString()}`
    );
  }
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
    const createdCAPNote = await CAPNoteModel.create({
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

    if (previousCAPNote) {
      try {
        await refreshPreviousNotePreSigIssue(
          previousCAPNote,
          normalizedDate,
          projectName
        );
      } catch (error) {
        console.error(
          'Error in refreshing previous note pre-sig issue: ',
          error
        );
      }
    }

    return createdCAPNote;
  } catch (err) {
    console.error('Error in creating CAP note: ', err, err.stack);
    return null;
  }
};

import dbConnect from '../../lib/dbConnect';
import CAPNoteModel from '../../models/CAPNoteModel';

/**
 * Fetches all CAP notes.
 * @returns {Array} Array of CAP notes or null
 */
export const fetchAllCAPNotes = async () => {
  await dbConnect();
  return await CAPNoteModel.find({}).sort({ sigName: 1, date: 1 });
};

/**
 * Fetches a CAP note by sig name and date.
 * @param sigName Sig name (e.g., RALE)
 * @param date Date in YYYY-MM-DD format (e.g., 2023-05-08)
 * @param project Project name
 * @returns {Object} CAP note object or null
 */
export const fetchCAPNote = async (
  sigName: string,
  project: string,
  date: string
) => {
  await dbConnect();

  // get current CAP note
  const startDate = new Date(date);
  const endDate = new Date(date);
  endDate.setDate(endDate.getDate() + 1);

  let currentCAPNote = await CAPNoteModel.findOne({
    sigAbbreviation: sigName.toUpperCase(),
    project: project,
    date: { $gte: startDate, $lte: endDate }
  });

  return currentCAPNote;
};

/**
 * Fetches a CAP note by ID.
 * @param id ID of the CAP note
 * @returns {Object} CAP note object or null
 */
export const fetchCAPNoteById = async (id: string) => {
  await dbConnect();
  return await CAPNoteModel.findById(id);
};

/**
 * Fetches the next CAP note for a project after a given date.
 * @param project Project name
 * @param currentDate Current CAP note date
 * @returns next CAP note object or null
 */
export const fetchNextCAPNoteForProject = async (
  project: string,
  currentDate: Date
) => {
  await dbConnect();
  return await CAPNoteModel.findOne({
    project,
    date: { $gt: currentDate }
  }).sort({ date: 1 });
};

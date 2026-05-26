import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/dbConnect';
import SIGReflectionModel from '../../../models/SIGReflectionModel';
import { getMondayOfWeek } from '../../../lib/helperFns';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sigAbbreviation } = req.query;
  if (typeof sigAbbreviation !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid sigAbbreviation' });
  }

  await dbConnect();

  if (req.method === 'GET') {
    const { weekOf } = req.query;
    const week = getMondayOfWeek(weekOf ? new Date(weekOf as string) : new Date());

    let reflection = await SIGReflectionModel.findOne({ sigAbbreviation, weekOf: week });
    if (!reflection) {
      reflection = await SIGReflectionModel.create({ sigAbbreviation, weekOf: week, teams: [] });
    }
    return res.status(200).json({ success: true, data: reflection });
  }

  if (req.method === 'PATCH') {
    const { weekOf, project, capNoteId, coachReflections } = req.body;
    if (!weekOf || !project || !capNoteId || !coachReflections) {
      return res
        .status(400)
        .json({ success: false, error: 'weekOf, project, capNoteId, and coachReflections required' });
    }
    const week = getMondayOfWeek(new Date(weekOf));

    let reflection = await SIGReflectionModel.findOne({ sigAbbreviation, weekOf: week });
    if (!reflection) {
      reflection = await SIGReflectionModel.create({
        sigAbbreviation,
        weekOf: week,
        teams: [{ project, capNoteId, coachReflections, lastReflectionSavedAt: new Date().toISOString() }]
      });
      return res.status(200).json({ success: true, data: reflection });
    }

    const teamIndex = reflection.teams.findIndex((t) => t.capNoteId?.toString() === capNoteId);
    if (teamIndex === -1) {
      reflection.teams.push({ project, capNoteId, coachReflections, lastReflectionSavedAt: new Date().toISOString() } as any);
    } else {
      reflection.teams[teamIndex].coachReflections = coachReflections;
      reflection.teams[teamIndex].lastReflectionSavedAt = new Date().toISOString();
    }
    await reflection.save();
    return res.status(200).json({ success: true, data: reflection });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

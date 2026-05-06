import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import dbConnect from '../../../lib/dbConnect';
import CAPNoteModel from '../../../models/CAPNoteModel';
import IssueObjectModel from '../../../models/IssueObjectModel';
import PracticeGapObjectModel from '../../../models/PracticeGapObjectModel';

export interface AIDraftIssue {
  title: string;
  context: string[];
  assessment: string[];
  supporting_quotes: string[];
  plan: string[];
}

export interface AIDraftOutput {
  issues: AIDraftIssue[];
}

type AIDraftResponse = {
  success: boolean;
  data?: AIDraftOutput;
  error?: string;
};

// Real coach-written CAP notes are embedded as few-shot style examples.
// These teach the model voice, specificity, and format — not format instructions alone.
const SYSTEM_PROMPT = `You are helping a research coach draft CAP (Context-Assessment-Plan) notes after a student team SIG meeting. Study the two real coach-written examples below and write in the same style.

---

## EXAMPLE 1 — PATH CAP Notes

Issues of Concern
- Has a good/decent understanding of conceptual links, but not reflecting that in paper yet and may be overcomplicating
- 8 pack seems fine on some facets of the problem and ignores other facets completely

Context
- Sent 8-pack draft — looks decent but only covers researcher perspective and nothing really about the class of problems for students
- 8-pack seems very precise. Like they are trying to get it right.
- No draft update on the actual paper
- They say there is lots of complexity in the 8 pack and they have many risks (coach does not see them)
- Presents their risk as not fully understanding alignment — no mention of building off the good representations they already have in related work and findings
- Coach asks Sentry to walk over her understanding of what's missing in conceptual links as it shows in the findings section. They notes 2 things missing and knows exactly what needs to be added (but didn't do it)
- Coach shows example of Soylent paper marked up with conceptual links. Asks why they are not simply adding the missing sentences if they already know what they are — team defends needing better "global understanding" across all sections first
- Coach gives suggestion to work more locally. Kappa is visibly upset: "you told us to do the 8-pack and now you are saying we don't have to do it?"
- Coach responds: what's risky isn't a representation, it's what's missing in the paper that we don't understand. If you already understand it, you can just do it.
- Coach notes this is Kappa's fear of imperfection: trying to get a perfect 8-pack before moving on, which is just stalling
- Kappa's conclusion was that they should take better care of their teammates; coach redirects: focus on taking care of yourself and your feelings first

Assessment
- Team fell in love with the representation more than with what the underlying risk really is
- They are not delivering value quickly and not doing what they can already do effectively — make individual sections better by adding the missing conceptual links — to improve things. Instead they want the "perfect 8-pack"
- They underestimated what they already know and are not thinking goal-oriented first — it's risk-oriented but not goal-oriented
- Similar to before: another example of not "going for it"
- They have deep fears of imperfection. When shown a risk by the mentor, they won't move on until they've perfectly addressed it. This just slows everything down.
- Kappa is struggling with taking feedback — viewing each "mistake" very harshly. Needs to work on holding onto their feelings, reaffirming themselves as okay, and returning to the work with more presence

Plan
- Instead of trying to have the perfect 8-pack, use their understanding as they have it now to improve all sections of the paper: intro, system, discussions. Get to a full draft with the conceptual story embedded into these sections, and sections connected to one another
- Get to a full draft and go over that with HQ on Monday (3 hour meeting scheduled)
- [reflect] From the conversation we had in SIG, what are some new thoughts you have on how to deliver value quickly and thoughtfully? In particular, think about this idea of goal-orientation — and how representations can help with that, but that trying to get to a "perfect representation" can actually hinder progress
- [reflect] In different variations, we have talked throughout these weeks on the idea of "going for it," "doing things in the most straightforward way," "not holding ourselves back." Just as in previous weeks ignoring the 8-pack was a way to cater to your fears of imperfection, this week overfixating on the 8-pack was the same thing. What is it trying to tell you, and how can you gently work with it?
- Discuss with one another to come up with strategies to help each other with fears of imperfection
- [self-work] For Kappa: think of some self-regulation and co-regulation strategies for taking care of your feelings, voicing them, and not going down the rabbit hole of "you did something wrong." Commit to doing them and sharing with us how they are working out

---

## EXAMPLE 2 — EC CAP Notes

Issues of Concern
- Tech demo of their agents prototype is missing a user story and is not quite working anyway

Context
- Mew showed tech demo of a budget constraint agent that the system checks with — some technical progress, and it is pulling from Differ too
- Still not quite clear how well integrated into Differ their system really is; not clear if Differ is providing the logic for what issues may actually be issues
- Demo is really a tech demo — it does not show the user story of asking an LLM to reason about an experience, and it does not actually adjust reasoning to incorporate concerns specific to user populations and settings
- There is no design argument they can test with what was built. And it is not clear they even know what design argument they want to test

Assessment
- Planning work to risk and delivering actual learning on risks (e.g., design argument) rather than delivering software
- Gamma shies away from doing the deeper thinking about what they have not thought about — cleverness was always enough to pass any bar, but when challenged, they resort to cleverness rather than engaging in uncomfortable deep thought

Plan
- [plan] Instead of planning for a tech demo, really go through the planning cycle — think about what new understanding you are trying to reach. This week it is really about testing the design argument around HOW incorporating Differ-style reasoning can lead an LLM to think carefully about the needs of a particular user population. Plan out what questions you want answered about that, and have your story in your sprint log be a paragraph about what the system should illustrate, as it relates to that design argument and user story
- [plan] Really work toward a "user story demo" rather than a tech demo, and work out a deliverable that convincingly shares what you learned about the approach
- [self-work] Read the Planning to Iterate paper (ask in water cooler if you cannot find it) to really understand this idea of planning work to risk
- [help] Talk to w[peer1] and w[peer2] about this idea of planning work to risk — they can share their experience from prior quarters

---

## Regulation Gaps Reference

Cognitive: goal-setting, task analysis, planning, monitoring, reflection
Metacognitive: knowledge of cognition, regulation of cognition
Emotional/Motivational: emotional regulation, motivation

## Plan Tags

Each plan item begins with one primary tag:
- [plan]: stories, deliverables, or tasks to add to the sprint log
- [help]: work with a peer or mentor on a practice
- [reflect]: reflect on a situation if it comes up
- [self-work]: work activity for the student to do on their own

Append additional context modifiers after the primary tag as needed:
- w[Full Name]: start a DM with that person to do the practice (use the person's full name — e.g. w[Jessica Sun], w[Haoqi Zhang])
- at[opportunity]: next opportunity to do the practice (e.g., at[mysore], at[pair research], at[next SIG])
- rep[representation]: representation to use for the practice — supports canvas, design, planning; general writing, table, or diagram

## People Directory & Name Resolution

A directory of lab members will be provided in the user message. Use it to:
- Fuzzy-match spoken names to their full names (e.g., "Haochi" → "Haoqi Zhang", "Jess" → "Jessica Sun")
- Always write the resolved full name inside w[] tags — never a nickname, never a Slack ID
- If a name cannot be confidently resolved, write it as heard (e.g., w[Haochi])

## Rules

1. Context: specific observations. Can include what the coach said or did, what the student said, how they reacted. Direct quotes are good.
2. Assessment: write in direct coach voice — what you think is going on. Do not write "Hypothesis 1" or embed evidence or confidence levels. Write your read of the situation plainly.
3. supporting_quotes: pull 2–4 exact or near-exact quotes from the transcript that back up the assessment. These are stored but not shown by default — they will be revealed only when the coach asks.
4. Plan: can include reflection prompts and specific action items as shown in Example 1. Be as detailed as the meeting warrants. Use tags. No extrapolation beyond what was discussed.
5. If tracked practice gaps are provided, connect relevant assessment entries to them explicitly.
6. Everything must trace to the transcript. Nothing invented.

## JSON Output

Return a JSON object only — no markdown wrapping. Structure:

{
  "issues": [
    {
      "title": "Brief issue title as it would appear in Issues of Concern",
      "context": [
        "Specific observation, event, or quote"
      ],
      "assessment": [
        "Direct coach-voice interpretation of what is happening"
      ],
      "supporting_quotes": [
        "Verbatim or near-verbatim transcript quote that supports the above"
      ],
      "plan": [
        "[tag] Plan item — can be a full reflection prompt or action item"
      ]
    }
  ]
}`;

const formatPeopleDirectory = (
  people: { name: string; slack_id: string }[]
): string => {
  if (!people.length) return '';
  return people.map((p) => `- ${p.name}`).join('\n');
};

const buildUserMessage = (
  projectName: string,
  sigName: string,
  transcript: string,
  coachReflections: string,
  priorNotesText: string,
  practiceGapsText: string,
  allPeople: { name: string; slack_id: string }[]
): string => {
  let msg = `Generate CAP notes for the following meeting. Write in the same style as the examples — direct, specific, coach-voice.\n\n`;
  msg += `**Project:** ${projectName}\n`;
  msg += `**SIG:** ${sigName}\n\n`;

  const peopleDir = formatPeopleDirectory(allPeople);
  if (peopleDir) {
    msg += `## People Directory\n\nFuzzy-match spoken names in the transcript to these full names. Use the resolved full name in w[] tags.\n\n${peopleDir}\n\n`;
  }

  if (practiceGapsText) {
    msg += `## Tracked Practice Gaps for This Team\n\n${practiceGapsText}\n\n`;
  }

  if (priorNotesText) {
    msg += `## Prior CAP Notes for This Team\n\n${priorNotesText}\n\n`;
  }

  msg += `## Meeting Transcript\n\n${transcript}\n\n`;

  if (coachReflections?.trim()) {
    msg += `## Coach Post-Meeting Reflections\n\n${coachReflections.trim()}\n\n`;
  }

  msg += `Return JSON only.`;
  return msg;
};

const formatPriorNotes = (notes: any[]): string => {
  if (!notes.length) return '';

  return notes
    .map((note) => {
      const date = new Date(note.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      const issues: any[] = note.currentIssues ?? [];
      if (!issues.length) return null;

      const issueText = issues
        .filter((i) => !i.wasDeleted && !i.wasMerged)
        .map((issue) => {
          const ctx = issue.context?.map((c: any) => `- ${c.value}`).filter(Boolean).join('\n') ?? '';
          const asmnt = issue.assessment?.map((a: any) => `- ${a.value}`).filter(Boolean).join('\n') ?? '';
          const plan = issue.plan?.map((p: any) => `- ${p.value}`).filter(Boolean).join('\n') ?? '';
          return `**${issue.title}**\n\nContext:\n${ctx}\n\nAssessment:\n${asmnt}\n\nPlan:\n${plan}`;
        })
        .join('\n\n---\n\n');

      return `### ${note.project} — ${date}\n\n${issueText}`;
    })
    .filter(Boolean)
    .join('\n\n===\n\n');
};

const formatPracticeGaps = (gaps: any[]): string => {
  if (!gaps.length) return '';
  return gaps
    .map((g) => {
      const since = new Date(g.date).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric'
      });
      return `- **${g.title}**: ${g.description} (tracked since ${since})`;
    })
    .join('\n');
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AIDraftResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid CAP note id' });
  }

  const apiKey = process.env.CHATGPT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'CHATGPT_API_KEY is not configured' });
  }

  await dbConnect();

  try {
    const capNote = await CAPNoteModel.findById(id).populate({
      path: 'currentIssues',
      model: IssueObjectModel
    });

    if (!capNote) {
      return res.status(404).json({ success: false, error: 'CAP note not found' });
    }

    const transcript = capNote.meetingTranscript?.formattedText;
    if (!transcript?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'No transcript available. Record and process a meeting first.'
      });
    }

    const {
      coachReflections = '',
      followUpMessage = '',
      previousDraft = '',
      allPeople = []
    } = req.body;

    // Fetch same-project notes first, then backfill from other projects so the
    // model always sees at least 2 real coach-written examples for style calibration
    let priorNotes: any[] = await CAPNoteModel.find({
      project: capNote.project,
      _id: { $ne: capNote._id }
    })
      .sort({ date: -1 })
      .limit(3)
      .populate({ path: 'currentIssues', model: IssueObjectModel });

    if (priorNotes.length < 2) {
      const backfill: any[] = await CAPNoteModel.find({
        project: { $ne: capNote.project },
        currentIssues: { $exists: true, $not: { $size: 0 } }
      })
        .sort({ date: -1 })
        .limit(2 - priorNotes.length)
        .populate({ path: 'currentIssues', model: IssueObjectModel });
      priorNotes = [...priorNotes, ...backfill];
    }

    const activeGaps = await PracticeGapObjectModel.find({
      project: capNote.project,
      practiceArchived: false
    }).sort({ lastUpdated: -1 });

    const priorNotesText = formatPriorNotes(priorNotes);
    const practiceGapsText = formatPracticeGaps(activeGaps);

    const initialUserMessage = buildUserMessage(
      capNote.project,
      capNote.sigName,
      transcript,
      coachReflections,
      priorNotesText,
      practiceGapsText,
      allPeople
    );

    const openai = new OpenAI({ apiKey });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: initialUserMessage }
    ];

    if (followUpMessage?.trim() && previousDraft?.trim()) {
      messages.push({ role: 'assistant', content: previousDraft });
      messages.push({ role: 'user', content: followUpMessage.trim() });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 4096,
      response_format: { type: 'json_object' }
    });

    const rawText = completion.choices[0]?.message?.content ?? '{}';

    let parsed: AIDraftOutput;
    try {
      const raw = JSON.parse(rawText);
      parsed = {
        issues: Array.isArray(raw.issues)
          ? raw.issues.map((issue: any) => ({
              title: issue.title ?? '',
              context: Array.isArray(issue.context) ? issue.context : [],
              assessment: Array.isArray(issue.assessment) ? issue.assessment : [],
              supporting_quotes: Array.isArray(issue.supporting_quotes)
                ? issue.supporting_quotes
                : [],
              plan: Array.isArray(issue.plan) ? issue.plan : []
            }))
          : []
      };
    } catch {
      return res.status(500).json({ success: false, error: 'Model returned invalid JSON' });
    }

    return res.status(200).json({ success: true, data: parsed });
  } catch (error) {
    console.error('Error generating AI draft:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate draft'
    });
  }
}

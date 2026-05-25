import Link from 'next/link';
import { fetchAllCAPNotes } from '../controllers/capNotes/fetchCAPNotes';
import Head from 'next/head';
import { longDate, shortDate, shortDateFromISO } from '../lib/helperFns';
import { useEffect, useState } from 'react';

export default function Home({ sigs, allSigs, quarterStart, quarterEnd }): JSX.Element {
  // store state for each SIG on whether to show latest or all CAP notes
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // state for the "create new CAP note" form
  const [showNewNoteForm, setShowNewNoteForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  // default date to today (YYYY-MM-DD format) for convenience
  const todayStr = new Date().toISOString().slice(0, 10);
  const [newNoteDate, setNewNoteDate] = useState(todayStr);
  const [creating, setCreating] = useState(false);

  // hardcoded project names from fixtures
  const projects = [
    'Experiential Travel',
    'Experiential Computing Platform',
    'World Learning',
    'PATH',
    'Dialectical Technologies',
    'LLMs for Personal Transformation',
    'LLMs for Transforming Researchers',
    'CAP Notes and Practice Agents'
  ];

  // use state variables for sigs so dates can be updated to locale time
  const [sigsState, setSigsState] = useState(sigs);
  const [allSigsState, setAllSigsState] = useState(allSigs);

  useEffect(() => {
    const format = (rawSigs) =>
      rawSigs.map((sig) => ({
        ...sig,
        capNotes: sig.capNotes
          .map((capNote) => ({
            ...capNote,
            dateDisplay: shortDateFromISO(capNote.date),
            lastUpdatedDisplay: longDate(new Date(capNote.lastUpdated))
          }))
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      }));
    setSigsState(format(sigs));
    setAllSigsState(format(allSigs));
  }, []);

  const displayedSigs = showHistory ? allSigsState : sigsState;

  return (
    <>
      <Head>
        <title>Home</title>
      </Head>
      <div className="container m-auto mt-3 h-dvh w-11/12 overflow-auto">
        <div className="mb-5">
          <h1 className="text-4xl font-bold">
            Welcome to Interactive CAP Notes
          </h1>
        </div>

        {/* buttons to control which notes are shown */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              className="h-10 rounded-full bg-blue-500 px-4 py-1 text-xs font-bold text-white hover:bg-blue-700"
              onClick={() => setShowAllNotes(!showAllNotes)}
            >
              {showAllNotes ? 'Show Most Recent Notes' : 'Show All Notes'}
            </button>
            <button
              className="h-10 rounded-full bg-gray-500 px-4 py-1 text-xs font-bold text-white hover:bg-gray-700"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? 'Current Quarter' : 'Show History'}
            </button>
          </div>
          <button
            className="h-10 rounded-full bg-green-500 px-4 py-1 text-xs font-bold text-white hover:bg-green-700"
            onClick={() => setShowNewNoteForm(!showNewNoteForm)}
          >
            {showNewNoteForm ? 'Hide New Note Form' : 'Add New SIG Meeting'}
          </button>
        </div>

        {showNewNoteForm && (
          <div className="mb-6 rounded border p-4">
            <h3 className="mb-2 font-bold">Create CAP Note</h3>
            <div className="flex flex-col gap-2">
              <label className="text-sm">
                Project Name:
                <select
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="ml-2 rounded border px-2 py-1"
                >
                  <option value="">Select a Project</option>
                  {projects.map(project => (
                    <option key={project} value={project}>{project}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                SIG Date:
                <input
                  type="date"
                  value={newNoteDate}
                  onChange={(e) => setNewNoteDate(e.target.value)}
                  className="ml-2 rounded border px-2 py-1"
                />
              </label>
              <button
                disabled={creating || !newProjectName || !newNoteDate}
                className="mt-2 w-32 rounded-full bg-blue-500 px-4 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={async () => {
                  setCreating(true);
                  try {
                    const [year, month, day] = newNoteDate.split('-').map(Number);
                    const date = new Date(Date.UTC(year, month - 1, day));
                    const iso = date.toISOString();
                    const res = await fetch('/api/soap', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        projectName: newProjectName,
                        noteDate: iso
                      })
                    });
                    const data = await res.json();
                    if (data.success) {
                      // reload to show new note
                      window.location.reload();
                    } else {
                      console.error('Error creating note', data);
                      alert('Failed to create note');
                    }
                  } catch (e) {
                    console.error(e);
                    alert('Failed to create note');
                  } finally {
                    setCreating(false);
                    setNewProjectName('');
                    setNewNoteDate(todayStr);
                  }
                }}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Section for each SIG */}
        {/* TODO: make into a filterable table */}

        <div className="col-span-2 w-full">
          {/* List of SIGs */}
          {displayedSigs.map((sig, i) => (
            <div className="mb-10 w-full" key={sig.abbreviation}>
              {/* Header Info for each SIG */}
              <div className="mb-3 grid w-full auto-rows-auto grid-cols-5 gap-y-5 border-b border-black text-xl font-bold">
                <h2 className="col-span-2">
                  {sig.name} ({sig.abbreviation})
                  <Link href={`/coach-reflections/${sig.abbreviation}`}>
                    <span className="ml-3 text-sm font-normal text-blue-600 underline hover:text-blue-800">
                      Coach Reflections →
                    </span>
                  </Link>
                </h2>
                <h2 className="col-span-1">Student Reflections</h2>
                <h2 className="col-span-1">SIG Date</h2>
                <h2 className="col-span-1">Last Updated</h2>
              </div>
              {/* List of CAP Notes for a SIG */}
              {sig.capNotes
                .filter((capNote) => {
                  // if show all, don't filter out anything; otherwise, only include the latest notes
                  return showAllNotes ? true : capNote.isLatest;
                })
                .map((capNote) => (
                  <div
                    className="grid w-full auto-rows-auto grid-cols-5 gap-y-5 hover:bg-blue-200 hover:font-bold"
                    key={`${capNote.project}-${capNote.date}`}
                  >
                    {/* Project Title and Link to CAP Note */}
                    <div className="col-span-2">
                      <Link href={`/cap-notes/${capNote.id}`}>
                        <h3 className="text-md text-blue-600 underline visited:text-purple-600 hover:text-blue-800">
                          {capNote.project}
                        </h3>
                      </Link>
                    </div>

                    {/* Link to Student Reflection */}
                    <div className="col-span-1">
                      <Link href={`/reflections/${capNote.id}`}>
                        <h3 className="text-md text-blue-600 underline visited:text-purple-600 hover:text-blue-800">
                          Reflection Page
                        </h3>
                      </Link>
                    </div>

                    {/* Date of CAP Note */}
                    <div className="col-span-1">{capNote.dateDisplay}</div>

                    {/* Last Updated for CAP Note*/}
                    <div className="col-span-1">{capNote.lastUpdatedDisplay}</div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// use serverside rendering to generate this page
export const getServerSideProps = async () => {
  const { ensureWeeklyCAPNotesExist } = await import(
    '../lib/server/sigAutopopulate'
  );
  const { quarterStart, quarterEnd } = await ensureWeeklyCAPNotesExist();

  const capNotes = await fetchAllCAPNotes();

  // Groups a sorted array of cap notes into a sigs structure with isLatest flags
  const buildSigs = (notes: typeof capNotes) => {
    const sorted = [...notes].sort(
      (a, b) =>
        a.sigName.localeCompare(b.sigName) ||
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const seen = new Set<string>();
    return sorted.reduce((acc, capNote) => {
      let isLatest = false;
      if (!seen.has(capNote.project)) {
        seen.add(capNote.project);
        isLatest = true;
      }
      const capNoteObj = {
        id: capNote._id.toString(),
        project: capNote.project,
        date: capNote.date.toISOString(),
        lastUpdated: capNote.lastUpdated.toISOString(),
        isLatest
      };
      const sigIndex = acc.findIndex(
        (sig) => sig.abbreviation === capNote.sigAbbreviation
      );
      if (sigIndex === -1) {
        acc.push({
          name: capNote.sigName,
          abbreviation: capNote.sigAbbreviation,
          capNotes: [capNoteObj]
        });
      } else {
        acc[sigIndex].capNotes.push(capNoteObj);
      }
      return acc;
    }, []);
  };

  // Quarter-filtered: only notes within the current (or most recent) quarter
  const quarterNotes =
    quarterStart && quarterEnd
      ? capNotes.filter(
          (note) => note.date >= quarterStart && note.date <= quarterEnd
        )
      : capNotes;

  return {
    props: {
      sigs: buildSigs(quarterNotes),
      allSigs: buildSigs(capNotes),
      quarterStart: quarterStart?.toISOString() ?? null,
      quarterEnd: quarterEnd?.toISOString() ?? null
    }
  };
};

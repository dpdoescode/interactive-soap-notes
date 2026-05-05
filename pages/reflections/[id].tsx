// general imports
import type { GetServerSideProps } from 'next';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { mutate } from 'swr';
import parse from 'html-react-parser';

// helper components
import { Tooltip } from 'flowbite-react';

// utilities
import {
  longDate,
  serializeDates,
  serializeDateOnlyToISO,
  shortDate,
  shortDateFromISO,
  shortenText
} from '../../lib/helperFns';

// data models and controllers
import { fetchCAPNoteById } from '../../controllers/capNotes/fetchCAPNotes';
import { fetchIssueObjectsByIds } from '../../controllers/issueObjects/fetchIssueObject';

// components

// icons
import ArrowPathIcon from '@heroicons/react/24/outline/ArrowPathIcon';
import CheckCircleIcon from '@heroicons/react/24/outline/CheckCircleIcon';
import ExclamationCircleIcon from '@heroicons/react/24/outline/ExclamationCircleIcon';

export default function CAPNote({ capNoteInfo, pastIssues }): JSX.Element {
  // have state for cap note data
  const [noteInfo, setNoteInfo] = useState(capNoteInfo);
  const [lastUpdated, setLastUpdated] = useState(capNoteInfo.lastUpdated);

  // hold data state for issues
  const [pastIssuesData, setPastIssuesData] = useState(pastIssues);

  // let user know that we are saving and if there were any errors
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // hold a ref that checks if first load
  const firstLoad = useRef(true);

  const formatPracticeText = (practiceText) => {
    // replace everything before the first ":" with bolded text in html
    let splitText = practiceText.split(':');
    let remainingText = splitText.slice(1).join(':');

    // replace urls to resources with links
    let urlRegex = /<([^|]+)\|([^>]+)>/g;
    let formattedText = remainingText.replace(
      urlRegex,
      '<a href="$1" target="_blank" className="text-blue-600 underline">$2</a>'
    );

    let output = `<span>
    <span className="font-bold">${splitText[0]}:</span>
    ${formattedText}
  </span>`;

    return <>{parse(output)}</>;
  };

  const generateDidDoPromptForType = (practice) => {
    if (practice.includes('On your own, try to')) {
      return 'Did you do the work practice your mentor suggested?';
    }
    if (practice.includes('At Mysore')) {
      return 'Did you attend Mysore to work on the practice your mentor suggested?';
    }
    if (practice.includes('At Pair Research')) {
      return 'Did you use Pair Research to work on the practice your mentor suggested?';
    }
    if (practice.includes('Reflect on your own')) {
      return 'Did you reflect on what your mentor suggested above?';
    }
    if (practice.includes('With')) {
      return 'Did you meet with the people above to work on the practice your mentor suggested?';
    }
  };

  // TODO: highly repetitive. see if I can create a template instead
  const generateDeliverablePrompt = (practice) => {
    if (practice.includes('On your own, try to')) {
      return (
        <>
          {parse(
            `Share a <span className="font-bold">link</span> to the deliverable that shows what you worked on. This can be a Google Doc, link to a prototype on Figma, code on Github, an image, etc. For images, add the image to a Google Doc and provide a file link below (Right Click → Share → Copy Link). Make sure all links you provide are accessible to anyone (e.g., use “anyone with link” permission on Google Drive).`
          )}
        </>
      );
    }
    if (practice.includes('At Mysore')) {
      return (
        <>
          {parse(
            `Share a <span className="font-bold">link</span> to an image of what you worked on or discussed at <span className="font-bold">Mysore</span>. For images, add the image to a Google Doc and provide a file link below (Right Click → Share → Copy Link). Make sure all links you provide are accessible to anyone (e.g., use “anyone with link” permission on Google Drive).`
          )}
        </>
      );
    }
    if (practice.includes('At Pair Research')) {
      return (
        <>
          {parse(
            `Share a <span className="font-bold">link</span> to the deliverable that shows what you worked on at <span className="font-bold">Pair Research</span>. This can be a Google Doc, link to a prototype on Figma, code on Github, an image, etc. For images, add the image to a Google Doc and provide a file link below (Right Click → Share → Copy Link). Make sure all links you provide are accessible to anyone (e.g., use “anyone with link” permission on Google Drive).`
          )}
        </>
      );
    }
    if (practice.includes('With')) {
      return (
        <>
          {parse(
            `Share a <span className="font-bold">link</span> to the deliverable that shows what you worked on at <span className="font-bold">with the people your mentor suggested.</span>. This can be a Google Doc, link to a prototype on Figma, code on Github, an image, etc. For images, add the image to a Google Doc and provide a file link below (Right Click → Share → Copy Link). Make sure all links you provide are accessible to anyone (e.g., use “anyone with link” permission on Google Drive).`
          )}
        </>
      );
    }
  };

  /**
   * Determine if a string is a valid URL.
   * From: https://stackoverflow.com/a/5717133
   * @param str
   * @returns
   */
  const isValidHttpUrl = (str) => {
    var pattern = new RegExp(
      '^(https?:\\/\\/)?' + // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
        '(\\#[-a-z\\d_]*)?$', // fragment locator
      'i'
    );
    return !!pattern.test(str);
  };

  // on first load, set the dates for noteInfo to be localized to the timezone
  useEffect(() => {
    setPastIssuesData((prevPastIssuesData) => {
      return prevPastIssuesData.map((issue) => {
        return {
          ...issue,
          date: shortDate(new Date(issue.date)),
          lastUpdated: longDate(new Date(issue.lastUpdated))
        };
      });
    });

    setNoteInfo((prevNoteInfo) => ({
      ...prevNoteInfo,
      sigDate: shortDateFromISO(prevNoteInfo.sigDate),
      lastUpdated: longDate(new Date(prevNoteInfo.lastUpdated))
    }));

    setLastUpdated(longDate(new Date(noteInfo.lastUpdated)));
  }, []);

  // listen for changes in pastIssue, currentIssue, or practiceGaps states and do debounced saves to database
  useEffect(() => {
    // don't save on first load
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }

    setIsSaving(true);
    const timeOutId = setTimeout(async () => {
      /**
       * Start by saving the issues
       */
      let pastIssuesToSave = pastIssuesData.map((issue) => {
        return structuredClone({
          id: issue.id,
          title: issue.title,
          date: new Date(issue.date).toISOString(),
          project: issue.project,
          sig: issue.sig,
          lastUpdated: new Date(issue.lastUpdated).toISOString(),
          wasDeleted: issue.wasDeleted,
          wasMerged: issue.wasMerged,
          mergeTarget: issue.mergeTarget,
          context: issue.context,
          assessment: issue.assessment,
          plan: issue.plan,
          followUps: issue.followUps,
          priorInstances: issue.priorInstances
        });
      });

      // make request to save the data to the database
      let noteInfoWithUtc = {
        ...noteInfo,
        sigDate: serializeDateOnlyToISO(noteInfo.sigDate),
        lastUpdated: new Date(noteInfo.lastUpdated).toISOString()
      };
      try {
        // make request to save the reflections on last week's issues
        const pastIssueRes = await fetch(`/api/issues/`, {
          method: 'POST',
          body: JSON.stringify({
            data: [...pastIssuesToSave],
            updateType: 'reflection', // don't use current since that will create a new follow-up object and replace the current one
            noteInfo: noteInfoWithUtc
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        });
        const pastIssueOutput = await pastIssueRes.json();

        // if there's an error, throw an exception
        if (!pastIssueRes.ok) {
          throw new Error(
            `Error from server when saving CurrentIssues: ${pastIssueOutput.error}`
          );
        }

        // otherwise, update the local data without a revalidation
        if (pastIssueOutput.data !== null) {
          mutate(`/api/issues/`, pastIssueOutput.data, false);
        }

        // if there's no error, clear the error state
        setSaveError(null);
      } catch (err) {
        // if there's an error, set the error state
        console.error('Error in saving data: ', err);
        setSaveError(err.message);
      }

      // saving is completed
      setIsSaving(false);
    }, 1000);

    return () => clearTimeout(timeOutId);
  }, [pastIssuesData]);

  // return the page
  return (
    <>
      {/* Set title of the page to be project name */}
      <Head>
        <title>
          {`${shortenText(
            noteInfo.project,
            15
          )} | ${new Date(noteInfo.sigDate).toLocaleString().split(',')[0]}`}
        </title>
      </Head>
      <div className="h-dvh w-full overflow-y-auto">
        {/* Header info for CAP note */}
        <div className="mx-auto mt-2 w-10/12 pl-3 pr-3">
          {/* Back, title, and last updated */}
          <div className="mb-2 flex flex-row flex-nowrap items-center">
            {/* Back button */}
            <div className="mr-1">
              <Link href="/">
                <h3 className="text-base font-bold text-blue-400 visited:text-purple-600 hover:text-blue-500">
                  &#8592;
                </h3>
              </Link>
            </div>

            {/* Title */}
            <div className="mr-2">
              <h1 className="text-base font-bold">
                {noteInfo.project} | Pre-SIG Reflection -- {noteInfo.sigDate}
              </h1>
            </div>

            {/* Save status */}
            {/* Three states of saved: (1) saved without error; (2) saving; (3) save attemped but error */}
            <div className="flex flex-row items-center">
              {/* Saved successfully */}
              {!isSaving && saveError === null ? (
                <>
                  <CheckCircleIcon className="mr-0.5 h-5 w-5 text-green-600" />
                  <h2 className="text-base font-semibold text-green-600">
                    Reflections Saved
                  </h2>
                </>
              ) : (
                <></>
              )}

              {/* Saving */}
              {isSaving ? (
                <>
                  <ArrowPathIcon className="mr-0.5 h-5 w-5 animate-spin text-blue-600" />
                  <h2 className="text-base font-semibold text-blue-600">
                    Saving...
                  </h2>
                </>
              ) : (
                <></>
              )}

              {/* Save attempted but error */}
              {!isSaving && saveError !== null ? (
                <>
                  <Tooltip content={saveError} placement="bottom">
                    <ExclamationCircleIcon className="mr-0.5 h-5 w-5 text-red-600" />
                  </Tooltip>
                  <h2 className="text-base font-semibold text-red-600">
                    Error in saving notes (Last saved: {lastUpdated})
                  </h2>
                </>
              ) : (
                <></>
              )}
            </div>
            <div></div>
          </div>

          {/* Reflection Instructions */}
          <div className="mx-auto w-full">
            <p>
              Hi{' '}
              {noteInfo.students == null ? '' : noteInfo.students.join(' and ')}
              ! Please reflect on the practices your mentor suggested{' '}
              <span className="font-bold">
                by the morning of your SIG meeting
              </span>
              . Enter your short (2-3 sentences, max) reflections in the text
              area after each question. For any questions that are not
              applicable, enter “N/A”. Please make sure to{' '}
              <span className="font-bold">
                scroll all the way down and answer all questions
              </span>
              ; any spaces highlighted in{' '}
              <span className="font-bold text-red-600">red</span> are
              incomplete.
            </p>
          </div>

          {/* TODO: have a summary of which reflections are completed / incomplete */}

          {/* Reflections for each issue */}
          {pastIssuesData.map((issue, issueIndex) => {
            return (
              <div key={issue.id} className="mx-auto mt-3 w-full">
                {/* Issue title and last updated */}
                <div className="flex flex-row items-center border-b border-black text-lg font-bold">
                  <h2 className="mr-2">{issue.title}</h2>
                  <h2 className="text-sm text-green-600">
                    Last Saved: {issue.lastUpdated}
                  </h2>
                </div>

                {/* Within each issue, reflections for each follow-up outcome */}
                {issue.followUps.map((followUp, followUpIndex) => {
                  return (
                    !followUp.practice.includes('[plan]') && (
                      <div
                        key={followUpIndex}
                        className="mx-auto mb-4 mt-2 w-full rounded-lg border border-gray-300 p-2 shadow-sm"
                      >
                        {/* Follow-up title */}
                        <div>
                          <h3 className="mb-2 mr-2 border-b text-base">
                            {formatPracticeText(
                              followUp.parsedPractice.practice
                            )}
                          </h3>
                        </div>

                        {/* Checking if done */}
                        <div className="flex flex-row">
                          <div className="mb-2 w-full">
                            <h3 className="text-sm font-medium">
                              {generateDidDoPromptForType(
                                followUp.parsedPractice.practice
                              )}
                            </h3>
                            <select
                              className={`block w-1/4 rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-sm font-bold focus:border-blue-500 focus:ring-blue-500 ${
                                followUp.outcome.didHappen === null
                                  ? 'text-yellow-400 empty:border-red-600'
                                  : followUp.outcome.didHappen
                                    ? 'text-green-600'
                                    : 'text-red-600'
                              }`}
                              onChange={(e) => {
                                let newValue = null;
                                if (e.target.value === 'true') {
                                  newValue = true;
                                } else if (e.target.value === 'false') {
                                  newValue = false;
                                }

                                setPastIssuesData((prevPastIssuesData) => {
                                  // clone the data before updating it
                                  let newPastIssuesData =
                                    structuredClone(prevPastIssuesData);

                                  // update the current issue's current follow-up's didHappen value
                                  newPastIssuesData[issueIndex].followUps[
                                    followUpIndex
                                  ].outcome.didHappen = newValue;

                                  // update timestamp of edits
                                  newPastIssuesData[issueIndex].lastUpdated =
                                    longDate(new Date());
                                  return newPastIssuesData;
                                });
                              }}
                              value={
                                followUp.outcome.didHappen == null
                                  ? ''
                                  : followUp.outcome.didHappen
                              }
                            >
                              <option value="">Select an option</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          </div>
                        </div>

                        {/* Ask for Deliverables */}
                        {followUp.outcome.didHappen !== null &&
                          followUp.outcome.didHappen &&
                          !followUp.practice.includes('[reflect]') && (
                            <div className="flex w-full flex-col">
                              {/* Description of what deliverable to provide */}
                              <h3 className="text-sm font-medium">
                                {generateDeliverablePrompt(
                                  followUp.parsedPractice.practice
                                )}
                              </h3>

                              {(followUp.outcome.deliverableLink !== null &&
                                followUp.outcome.deliverableLink === '') ||
                                (!isValidHttpUrl(
                                  followUp.outcome.deliverableLink
                                ) && (
                                  <h4 className={`text-xs italic text-red-600`}>
                                    Please enter a single, valid link to your
                                    deliverable. Add additional links to
                                    deliverables in the description section
                                    below.
                                  </h4>
                                ))}

                              {/* Text Area to add link */}
                              <textarea
                                className="mb-2 h-7 w-full rounded-lg border border-gray-400 p-1 text-xs leading-4 empty:border-red-600"
                                placeholder="Paste link here"
                                value={followUp.outcome.deliverableLink}
                                onChange={(e) => {
                                  setPastIssuesData((prevPastIssuesData) => {
                                    // clone the data before updating it
                                    let newPastIssuesData =
                                      structuredClone(prevPastIssuesData);

                                    // update the current issue's current follow-up's deliverable link
                                    newPastIssuesData[issueIndex].followUps[
                                      followUpIndex
                                    ].outcome.deliverableLink = e.target.value;

                                    // update timestamp of edits
                                    newPastIssuesData[issueIndex].lastUpdated =
                                      longDate(new Date());
                                    return newPastIssuesData;
                                  });
                                }}
                              ></textarea>

                              {/* Description of what deliverable to provide */}
                              <h3 className="text-sm font-medium">
                                Describe your deliverable
                              </h3>
                              <h3 className="font-base text-xs italic">
                                What should your mentor look at? What does this
                                deliverable show?
                              </h3>

                              {/* Text Area to describe deliverable */}
                              <textarea
                                className="mb-2 h-16 w-full rounded-lg border border-gray-400 p-1 text-xs leading-4 empty:border-red-600"
                                placeholder="Enter a short description of your deliverable here"
                                value={followUp.outcome.deliverableNotes}
                                onChange={(e) => {
                                  setPastIssuesData((prevPastIssuesData) => {
                                    // clone the data before updating it
                                    let newPastIssuesData =
                                      structuredClone(prevPastIssuesData);

                                    // update the current issue's current follow-up's deliverable notes
                                    newPastIssuesData[issueIndex].followUps[
                                      followUpIndex
                                    ].outcome.deliverableNotes = e.target.value;

                                    // update timestamp of edits
                                    newPastIssuesData[issueIndex].lastUpdated =
                                      longDate(new Date());
                                    return newPastIssuesData;
                                  });
                                }}
                              ></textarea>
                            </div>
                          )}

                        {/* Follow-up reflection */}
                        {followUp.outcome.didHappen !== null &&
                          followUp.outcome.reflections[
                            followUp.outcome.didHappen ? 1 : 0
                          ].map((reflection, reflectionIndex) => {
                            return (
                              <div key={reflection.id}>
                                <h3 className="text-sm font-medium">
                                  {reflection.prompt}
                                </h3>
                                <textarea
                                  className="mb-2 h-24 w-full rounded-lg border border-gray-400 p-1 text-xs leading-4 empty:border-red-600"
                                  placeholder="Enter a short reflection here"
                                  value={reflection.response}
                                  onChange={(e) => {
                                    setPastIssuesData((prevPastIssuesData) => {
                                      // clone the data before updating it
                                      let newPastIssuesData =
                                        structuredClone(prevPastIssuesData);

                                      // update the current issue's current follow-up's reflection response for the current reflection index based on if didHappen is true or false
                                      newPastIssuesData[issueIndex].followUps[
                                        followUpIndex
                                      ].outcome.reflections[
                                        followUp.outcome.didHappen ? 1 : 0
                                      ][reflectionIndex].response =
                                        e.target.value;

                                      // update timestamp of edits
                                      newPastIssuesData[
                                        issueIndex
                                      ].lastUpdated = longDate(new Date());
                                      return newPastIssuesData;
                                    });
                                  }}
                                ></textarea>
                              </div>
                            );
                          })}
                      </div>
                    )
                  );
                })}

                {/* if no follow-up reflections asked for, specifically with only plans */}
                {issue.followUps.every((followUp) => {
                  return followUp.practice.includes('[plan]');
                }) && (
                  <div>
                    <h3 className="text-sm font-medium italic">
                      No reflections needed for this issue.
                    </h3>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// use serverside rendering to generate this page
export const getServerSideProps: GetServerSideProps = async (query) => {
  // helper function to convert mongo ids to strings
  const mongoIdFlattener = {
    transform: function (doc, ret) {
      if (ret?._id != null) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
    }
  };

  // get the sig name and date from the query
  let capNoteId = query.params?.id as string;

  /**
   *
   * fetch CAP note for the given sig and date, and format for display
   */
  let currentCAPNote = await fetchCAPNoteById(capNoteId);
  let currentCAPNoteFlattened = serializeDates(
    currentCAPNote.toJSON(mongoIdFlattener)
  );

  // TODO: temp fix -- switches this to currentIsuses so each reflection page is for the NEW isuses that the mentor has observed.
  // This should make it clearer that, for a given cap note, there's (1) the prior issues the student had; (2) the new diagnosed issues and practices; and (3) the reflections on those practices
  let pastIssues = await fetchIssueObjectsByIds(
    currentCAPNote.currentIssues.map((issue) => issue._id)
  );

  // remove issues where the mentor created them but didn't delete or merge them with another issue
  pastIssues = pastIssues.filter(
    (issue) => !issue.wasDeleted && !issue.wasMerged
  );

  let pastIssuesFlattened = pastIssues.map((issue) => {
    let flattenedData = serializeDates(issue.toJSON(mongoIdFlattener));
    flattenedData.priorInstances = issue.priorInstances.map((instance) => {
      return instance.toString();
    });
    return flattenedData;
  });

  // From studio api, get info about the project (like the studnets on it) for display purposes
  let projectData = null;
  const projectDataRes = await fetch(
    `${process.env.STUDIO_API}/projects/byName?` +
      new URLSearchParams({
        projectName: currentCAPNoteFlattened.project,
        populateTools: 'true'
      })
  );
  projectData = await projectDataRes.json();

  let students = null;
  if (projectData) {
    students = projectData.students.map((student) => {
      return student.name.split(' ')[0];
    });
  }

  // create data object for display
  const capNoteInfo = {
    id: currentCAPNoteFlattened.id,
    project: currentCAPNoteFlattened.project,
    students: students,
    sigName: currentCAPNoteFlattened.sigName,
    sigAbbreviation: currentCAPNoteFlattened.sigAbbreviation,
    sigDate: currentCAPNoteFlattened.date,
    lastUpdated: currentCAPNoteFlattened.lastUpdated,
    pastIssues: currentCAPNoteFlattened.pastIssues.map((issue) => {
      return issue.toString();
    })
  };

  // setup the page with the data from the database
  const pastWeekIssues = pastIssuesFlattened;

  // print before returning if in development
  const env = process.env.NODE_ENV;
  if (env == 'development') {
    console.log('capNoteInfo', JSON.stringify(capNoteInfo, null, 2));
    console.log('pastWeekIssues', JSON.stringify(pastWeekIssues, null, 2));
  }

  return {
    props: {
      capNoteInfo: capNoteInfo,
      pastIssues: pastWeekIssues
    }
  };
};

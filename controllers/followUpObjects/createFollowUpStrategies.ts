import crypto from 'crypto';

/**
 * Converts a date to a different timezone.
 * @param {Date | string} date - Date to convert, either as a Date object or a string in ISO format.
 * @param {string} tzString - Timezone string, e.g., 'America/Chicago'.
 * @returns {Date} Converted date, returned as a Date object.
 */
function convertTZ(date: Date | string, tzString: string) {
  return new Date(
    (typeof date === 'string' ? new Date(date) : date).toLocaleString('en-US', {
      timeZone: tzString
    })
  );
}

const getDatePartsForTimezone = (date: Date, timezone: string) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  return formatter
    .formatToParts(date)
    .reduce((parts, part) => {
      if (part.type !== 'literal') {
        parts[part.type] = Number(part.value);
      }
      return parts;
    }, {} as Record<string, number>);
};

const buildUtcDateForTimezone = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string
) => {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const localizedParts = getDatePartsForTimezone(utcGuess, timezone);
  const localizedUtcValue = Date.UTC(
    localizedParts.year,
    localizedParts.month - 1,
    localizedParts.day,
    localizedParts.hour,
    localizedParts.minute,
    localizedParts.second
  );
  const targetUtcValue = Date.UTC(year, month - 1, day, hour, minute, second);

  return new Date(utcGuess.getTime() - (localizedUtcValue - targetUtcValue));
};

const computeExplicitPreSigOpportunity = (
  nextSigDate: string,
  orgObjs: any
) => {
  const sigVenue = orgObjs?.venues?.find((venue) => venue.kind === 'SigMeeting');
  if (!sigVenue) {
    return null;
  }

  const nextSigDateObj = new Date(nextSigDate);
  if (Number.isNaN(nextSigDateObj.getTime())) {
    return null;
  }

  const previousDay = new Date(nextSigDateObj.getTime());
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);

  const [startHour, startMinute, startSecond] = sigVenue.startTime
    .split(':')
    .map(Number);

  return buildUtcDateForTimezone(
    previousDay.getUTCFullYear(),
    previousDay.getUTCMonth() + 1,
    previousDay.getUTCDate(),
    startHour,
    startMinute,
    startSecond,
    sigVenue.timezone
  ).toISOString();
};

const computeFallbackNextSigDate = (noteDate: string) => {
  const nextWeekDate = new Date(noteDate);
  if (Number.isNaN(nextWeekDate.getTime())) {
    return null;
  }

  nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7);
  return nextWeekDate.toISOString();
};

/**
 * Generates a post-SIG message with all practice agents the mentor suggested for the current CAP Note.
 * @param {string} noteId - ID of the CAP note
 * @param {string} projName - Name of the project
 * @param {string} noteDate - Date of the CAP note, in ISO string format
 * @param {Object} practiceAgents - Practice agents for the CAP note
 * @param {Object} orgObjs - Organizational objects for the CAP note
 * @returns {Object} New active issue object to send to Orchestration Engine
 */
export const createPostSigMessage = (
  noteId: string,
  projName: string,
  noteDate: string,
  practiceAgents: Object,
  orgObjs: Object
) => {
  let noteDateJS = new Date(noteDate);
  let weekFromCurrDate = new Date(noteDateJS.getTime());
  weekFromCurrDate.setDate(weekFromCurrDate.getDate() + 7);

  let newActiveIssue = {
    scriptId: crypto
      .createHash('md5')
      .update(`${noteId}-post-sig`)
      .digest('hex')
      .slice(0, 24),
    scriptName: `plan follow-up after SIG for ${projName} on ${noteDate}`,
    dateTriggered: noteDateJS,
    expiryTime: weekFromCurrDate,
    shouldRepeat: false,
    issueTarget: {
      targetType: 'project',
      name: projName
    },
    strategyToEnact: {
      name: `plan follow-up after SIG for ${projName} on ${noteDate}`,
      description: '',
      strategy_function: ''
    },
    updateIfExists: true // used to update an already created active issue
  };

  // build up strategy message by looping over practice agents
  let strategy =
    "Here's some practices for you to work on from SIG meeting.\\n\\n";
  for (let issueKey in practiceAgents) {
    let currentContent = `> ${issueKey}`;

    // sort practice agents by practice
    // from: https://stackoverflow.com/a/14872766
    let ordering = {};
    let sortOrder = ['plan', 'self-work', 'help', 'reflect'];
    for (var i = 0; i < sortOrder.length; i++) ordering[sortOrder[i]] = i;
    practiceAgents[issueKey].sort(
      (a, b) =>
        ordering[a.practice.match(/\[(.*?)\]\s*(.*)/).slice(1)[0]] -
          ordering[b.practice.match(/\[(.*?)\]\s*(.*)/).slice(1)[0]] ||
        a.followUpObject.parsedPractice.practice.localeCompare(
          b.followUpObject.parsedPractice.practice
        )
    );

    // add practice content for each practice agent
    for (let practiceAgent of practiceAgents[issueKey]) {
      currentContent += `\\n- ${practiceAgent.followUpObject.parsedPractice.practice}`;
    }
    strategy += currentContent + '\\n\\n';
  }
  strategy +=
    '---\\n' +
    "Let your mentor know if you have any challenges in doing these practices. I'll remind you about opportunities to practice later in the week (e.g., mysore, pair research).";
  strategy = strategy.replace(/[\""]/g, '\\"');

  // create the function to actually deliver the message
  let strategyFunction = async function () {
    return await this.messageChannel({
      message: strategyTextToReplace,
      projectName: projectNameForNote,
      opportunity: async function () {
        return await this.hoursAfter('currDate', 1);
      }.toString()
    });
  }.toString();

  strategyFunction = strategyFunction.replace(
    'currDate',
    new Date().toISOString() // use the current timestamp so it's sent 1 hour after editing is complete
  );
  strategyFunction = strategyFunction.replace(
    'projectNameForNote',
    `'${orgObjs.project.name}'`
  );
  strategyFunction = strategyFunction.replace(
    'strategyTextToReplace',
    '"' + strategy + '"'
  );

  // add to newActiveIssue and return
  newActiveIssue.strategyToEnact.strategy_function = strategyFunction;
  return newActiveIssue;
};

/**
 * Creates a pre-SIG reflection message for the current CAP Note.
 * @param {string} noteId - ID of the CAP note
 * @param {string} projName - Name of the project
 * @param {string} noteDate - Date of the CAP note, in ISO string format
 * @param {Object} orgObjs - Organizational objects for the CAP note
 * @returns {Object} New active issue object to send to Orchestration Engine
 */
export const createPreSigReflectionMessage = (
  noteId: string,
  projName: string,
  noteDate: string,
  orgObjs: any,
  nextSigDate?: string | null
) => {
  let noteDateJS = new Date(noteDate);
  let weekFromCurrDate = new Date(noteDateJS.getTime());
  weekFromCurrDate.setDate(weekFromCurrDate.getDate() + 7);

  let newActiveIssue = {
    scriptId: crypto
      .createHash('md5')
      .update(`${noteId}-pre-sig-reflection`)
      .digest('hex')
      .slice(0, 24),
    scriptName: `pre-sig reflection for ${projName} on previous ${noteDate} SIG`,
    dateTriggered: noteDateJS,
    expiryTime: weekFromCurrDate,
    shouldRepeat: false,
    issueTarget: {
      targetType: 'project',
      name: projName
    },
    strategyToEnact: {
      name: `pre-sig reflection for ${projName} on previous ${noteDate} SIG`,
      description: '',
      strategy_function: ''
    },
    updateIfExists: true // used to update an already created active issue
  };

  // create the function to actually deliver the message
  const reflectionUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reflections/${noteId}`;
  let strategy = `You have SIG tomorrow! Please take some time to reflect on the practices your mentor suggested last week: <${reflectionUrl}|Reflection Page>.`;
  strategy = strategy.replace(/[\""]/g, '\\"');

  const effectiveNextSigDate = nextSigDate ?? computeFallbackNextSigDate(noteDate);
  const explicitOpportunity = effectiveNextSigDate
    ? computeExplicitPreSigOpportunity(effectiveNextSigDate, orgObjs)
    : null;
  const opportunityExpression = explicitOpportunity
    ? `new Date('${explicitOpportunity}')`
    : `await this.daysBeforeVenue(
        await this.venues.find(this.where('kind', 'SigMeeting')),
        1
      )`;

  let strategyFunction = `async function () {
    return await this.messageChannel({
      message: strategyTextToReplace,
      projectName: projectNameForNote,
      opportunity: async function () {
        return ${opportunityExpression};
      }.toString()
    });
  }`;
  strategyFunction = strategyFunction.replace(
    'projectNameForNote',
    `'${orgObjs.project.name}'`
  );
  strategyFunction = strategyFunction.replace(
    'strategyTextToReplace',
    '"' + strategy + '"'
  );
  // add to newActiveIssue and return
  newActiveIssue.strategyToEnact.strategy_function = strategyFunction;
  return newActiveIssue;
};

/**
 * Creates reflection questions for the current practices for the following week.
 * @param {Object} parsedPractice - Parsed practice object
 * @returns {Array[Array[Object]]} Array of two arrays of reflection questions
 */
export const computeReflectionQuestions = (parsedPractice) => {
  // get reflection questions based on the plan entry
  let questionsIfNotDone = [];
  let questionsIfDone = [];

  if (parsedPractice.practiceTag === 'plan') {
    // do nothing
  } else if (parsedPractice.practiceTag === 'reflect') {
    questionsIfDone = [
      {
        prompt:
          'Enter your reflections on the prompt your mentor suggested above.',
        responseType: 'string'
      },
      {
        prompt:
          'How did this reflection help you understand how you currently practice and why that happens, and how your practices could change? What was helpful? What obstacles or concerns do you still have?',
        responseType: 'string'
      }
    ];
  } else if (parsedPractice.practiceTag === 'self-work') {
    questionsIfDone = [
      {
        prompt:
          'How did your understanding change? What new risk(s) do you see?',
        responseType: 'string'
      },
      {
        prompt: 'What obstacles came up in trying to do it, if any?',
        responseType: 'string'
      }
    ];

    questionsIfNotDone = [
      {
        prompt:
          "What prevented you from doing this work practice? Why did this prevent you from doing it? For example, didn't have time; not important after addressing another risk; etc.",
        responseType: 'string'
      },
      {
        prompt:
          'Are there other strategies that you could have tried? For example, could your mentor or your peers have helped you? Why or why not?',
        responseType: 'string'
      }
    ];
  } else if (parsedPractice.practiceTag === 'help') {
    // check if at mysore
    if (parsedPractice.parsedPracticePrefix.includes('Mysore')) {
      questionsIfDone = [
        {
          prompt:
            'How did Mysore help progress your understanding? What new risk(s) did it reveal?',
          responseType: 'string'
        },
        {
          prompt: 'What obstacles came up during Mysore, if any?',
          responseType: 'string'
        }
      ];

      questionsIfNotDone = [
        {
          prompt:
            'Did anything prevent you from attending Mysore this week? If so, why?',
          responseType: 'string'
        },
        {
          prompt:
            'Did anything prevent you from working on the suggested practice at Mysore? If so, why?',
          responseType: 'string'
        }
      ];
    } else if (parsedPractice.parsedPracticePrefix.includes('Pair Research')) {
      questionsIfDone = [
        {
          prompt:
            'What did working with a peer help you accomplish? How did that help you progress your sprint?',
          responseType: 'string'
        },
        {
          prompt:
            'Were you able to complete your help-request? If not, what obstacles came up? For example, was the help-request not sliced enough?',
          responseType: 'string'
        }
      ];

      questionsIfNotDone = [
        {
          prompt:
            'Did anything prevent you from attending Pair Research this week? If so, why?',
          responseType: 'string'
        },
        {
          prompt:
            'Did anything prevent you from working on the suggested practice at Pair Research? If so, why? For example, did you do the activity to help plan a slice of a task that a peer could help with?',
          responseType: 'string'
        }
      ];
    } else if (parsedPractice.parsedPracticePrefix.includes('With')) {
      questionsIfDone = [
        {
          prompt:
            'What did working with people your mentor suggested help you accomplish? How did that help you progress your sprint?',
          responseType: 'string'
        },
        {
          prompt:
            'Were you able to complete your help-request? If not, what obstacles came up? For example, did a new issue come while you were help-seeking?',
          responseType: 'string'
        }
      ];

      questionsIfNotDone = [
        {
          prompt:
            'Did anything prevent you from asking the people your mentor suggested for help? If so, why?',
          responseType: 'string'
        }
      ];
    }
  }

  return [questionsIfNotDone, questionsIfDone];
};

/**
 * Parses the practice text into a parsed practice object. Currently supports plan, reflect, self-work, and help practices. Each practice can include rep[] tags for representations and w[] tags for people.
 *
 * @param {string} practice - String of practice text
 * * Example:
 * "[plan] Update your Sprint Log"
 * "[reflect] Reflect on your own"
 * "[self-work] On your own, try to"
 * "[help] Help seek"
 * "[help] Help seek with [person1] and [person2]"
 * @returns {Object} Object with practiceTag, parsedPracticePrefix, content, opportunity, and representations
 */
// TODO: include Plan text that doesn't have an agent tag associated with it BUT not messages that don't have anything OR have an agent tag without the agent info
export const parsePracticeText = (practice) => {
  // split the practice text into [practice] and content
  let [practiceTag, content] = practice.match(/\[(.*?)\]\s*(.*)/).slice(1);
  let output = {
    practiceTag: practiceTag,
    parsedPracticePrefix: '',
    content: content,
    opportunity: {},
    representations: []
  };

  // create the parsed practice based on the practice tag
  switch (practiceTag) {
    case 'plan':
      output.parsedPracticePrefix =
        'Update your <${this.project.tools.sprintLog.url}|Sprint Log>: ';
      break;
    case 'reflect':
      output.parsedPracticePrefix = 'Reflect on your own: ';
      break;
    case 'self-work':
      output.parsedPracticePrefix = 'On your own, try to: ';
      break;
    case 'help':
      // check if content contains @mysore
      if (output.content.toLowerCase().includes('at[mysore]')) {
        output.parsedPracticePrefix = 'At Mysore: ';
        output.content = output.content.replace(/at\[mysore\]/gi, 'Mysore');

        // update opportunity
        output.opportunity = {
          type: 'venue',
          value: ['Mysore']
        };
      } else if (output.content.toLowerCase().includes('at[pair research]')) {
        output.parsedPracticePrefix = 'At Pair Research: ';
        output.content = output.content.replace(
          /at\[pair research\]/gi,
          'Pair Research'
        );

        // update opportunity
        output.opportunity = {
          type: 'venue',
          value: ['Pair Research']
        };
      } else if (output.content.toLowerCase().match(/w\[.*?\]/g)) {
        // use regex to get all people referened by w[] tags
        const pattern = /w\[(.*?)\]/g;
        let matches;
        let people = [];
        while ((matches = pattern.exec(output.content)) !== null) {
          people.push(matches[1]);
        }
        output.parsedPracticePrefix = `With ${people.join(', ')}:`;

        // remove the w[] tags from the content, but keep the people's names
        output.content = output.content.replace(pattern, (match, p1) => p1);

        // update opportunity
        output.opportunity = {
          type: 'people',
          value: people
        };
      } else {
        output.parsedPracticePrefix = 'Help seek: '; // TODO: allow for including people
      }
      break;
    default:
      break;
  }

  // now work on representations
  if (output.content.toLowerCase().match(/rep\[.*?\]/g)) {
    // use regex to get all representations referenced by rep[] tags
    const pattern = /rep\[(.*?)\]/g;
    let matches;
    let representations = [];
    while ((matches = pattern.exec(output.content)) !== null) {
      let matchSplit = matches[1];
      representations.push({
        name: matchSplit.trim()
      });
    }
    // remove the rep[] tags from the content, but keep the people's names
    output.content = output.content.replace(pattern, (match, p1) => p1);

    // add representations
    for (let rep of representations) {
      // check if representation is in the representationObjects
      if (representationObjects[rep.name]) {
        let repName = rep.name;

        output.representations.push(representationObjects[rep.name]);

        // now replace the representations with actual links
        output.content = output.content.replace(
          `${repName}`,
          `<${representationObjects[repName].link}|${repName}>`
        );
      } else {
        // just replace the representation with the name
        // TODO: this should be done before the rep[] tags are removed
        output.content = output.content.replace(
          `${rep.name}`,
          `representation, "${rep.name},"`
        );
      }
    }
    // TODO: special cases for no links
    // 'write: __', // drafting a section
    //   'table: __',
    //   'diagram: __'
  }

  return output;
};

export const representationObjects = {
  'problem statement': {
    type: 'canvas',
    link: 'https://docs.google.com/presentation/d/12I7GImAqqgMN5UHzzgSUz_IWvLTSb4-OUqw24EHoCeI/edit?slide=id.gcbd9fbfbdf_0_8#slide=id.gcbd9fbfbdf_0_8'
  },
  'design argument': {
    type: 'canvas',
    link: 'https://docs.google.com/presentation/d/12I7GImAqqgMN5UHzzgSUz_IWvLTSb4-OUqw24EHoCeI/edit?slide=id.gcbd9fbfbdf_0_14#slide=id.gcbd9fbfbdf_0_14'
  },
  'interface argument': {
    type: 'canvas',
    link: 'https://docs.google.com/presentation/d/12I7GImAqqgMN5UHzzgSUz_IWvLTSb4-OUqw24EHoCeI/edit?slide=id.gcbd9fbfbdf_0_26#slide=id.gcbd9fbfbdf_0_26'
  },
  'system argument': {
    type: 'canvas',
    link: 'https://docs.google.com/presentation/d/12I7GImAqqgMN5UHzzgSUz_IWvLTSb4-OUqw24EHoCeI/edit?slide=id.gcbd9fbfbdf_0_32#slide=id.gcbd9fbfbdf_0_32'
  },
  'user testing plan': {
    type: 'canvas',
    link: 'https://docs.google.com/presentation/d/12I7GImAqqgMN5UHzzgSUz_IWvLTSb4-OUqw24EHoCeI/edit?slide=id.gcbd9fbfbdf_0_71#slide=id.gcbd9fbfbdf_0_71'
  },
  'testing takeaways': {
    type: 'canvas',
    link: 'https://docs.google.com/presentation/d/12I7GImAqqgMN5UHzzgSUz_IWvLTSb4-OUqw24EHoCeI/edit?slide=id.g10e508e5387_0_11#slide=id.g10e508e5387_0_11'
  },
  'approach tree': {
    type: 'canvas',
    link: 'https://docs.google.com/presentation/d/12I7GImAqqgMN5UHzzgSUz_IWvLTSb4-OUqw24EHoCeI/edit?slide=id.gcbd9fbfbdf_0_142#slide=id.gcbd9fbfbdf_0_142'
  },
  '8-pack': {
    type: 'canvas',
    link: 'https://docs.google.com/presentation/d/12I7GImAqqgMN5UHzzgSUz_IWvLTSb4-OUqw24EHoCeI/edit?slide=id.gf296502525_0_7#slide=id.gf296502525_0_7'
  },
  'journey map': {
    type: 'design',
    link: 'https://www.nngroup.com/articles/customer-journey-mapping/'
  },
  storyboard: {
    type: 'design',
    link: 'http://hci.stanford.edu/courses/cs147/2009/assignments/storyboard_notes.pdf'
  },
  'risk assessment': {
    type: 'planning',
    link: 'https://docs.google.com/presentation/d/12I7GImAqqgMN5UHzzgSUz_IWvLTSb4-OUqw24EHoCeI/edit?slide=id.gcbd9fbfbdf_0_117#slide=id.gcbd9fbfbdf_0_117'
  }
};

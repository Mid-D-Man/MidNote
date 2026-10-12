// Example entries a FRESH install starts with: two notes, a todo and a board, so every tab
// shows what it can do instead of an empty page.
//
// Two details matter for the "delete the app, install the new build, restore my backup"
// routine (Settings -> Advanced settings -> Backup & restore):
//
//  1. FIXED ids. Restore is a merge keyed by id. If the examples got a fresh random id on every
//     install, each reinstall + restore would pile up one more copy of every example (the new
//     install's, plus the ones that were saved in the backup). With fixed ids the restore finds
//     "already here" and adds nothing.
//  2. A FIXED, OLD last-modified time. Restore keeps whichever copy is newer. A freshly seeded
//     example stamped "now" would always beat the backup's copy and silently undo your edits to
//     it (or put a trashed example back). Stamped with this fixed time, any change you made to an
//     example - which stamps it with the real time - is newer and wins.
//
// Pure TypeScript (types only, no store or storage imports) so it can run in Node tests.
import { NO_THEME } from "../types/entry";
import type { Board, Note, Todo } from "../types/entry";

/** The time every untouched example carries. Never "now" - see point 2 above. */
export const SAMPLE_LAST_MODIFIED = "2026-10-01T00:00:00.000Z";

/** localStorage flag: set once the first-run decision has been made (examples added, or the app already had entries), so emptying the app never brings the examples back. */
export const SAMPLES_DECIDED_KEY = "midnote:samples-decided";
export const SAMPLES_DECIDED_VALUE = "examples-decided";

export const SAMPLE_IDS = {
  noteShopping: "sample-note-shopping-list",
  noteMeeting: "sample-note-meeting-notes",
  todoTrip: "sample-todo-weekend-trip",
  boardLaunch: "sample-board-launch-plan",
} as const;

/**
 * What to do at startup, once storage has loaded.
 *  "seed"  first ever start and nothing is stored: add the examples (then remember it).
 *  "mark"  first start since this existed but the user already has entries (an app update):
 *          add nothing, just remember it, so emptying the app later doesn't bring examples back.
 *  "skip"  already decided before.
 */
export function decideSeeding(entryCount: number, alreadyDecided: boolean): "seed" | "mark" | "skip" {
  if (alreadyDecided) return "skip";
  return entryCount === 0 ? "seed" : "mark";
}

const base = () => ({
  lastModified: SAMPLE_LAST_MODIFIED,
  isBookmarked: false,
  encrypted: false,
  struck: false,
  isPinned: false,
  headerTheme: { ...NO_THEME },
  bodyTheme: { ...NO_THEME },
  icon: null,
  lockKeyMode: null,
  lockedPayload: null,
  lockedKeyFile: null,
  deletedAt: null,
  reminderAt: null,
  reminderRepeat: null,
  comments: [],
});

function sampleNotes(): Note[] {
  return [
    {
      ...base(),
      id: SAMPLE_IDS.noteShopping,
      type: "regular",
      title: "Shopping List",
      content: "Milk, eggs, bread, butter",
      pages: [],
      page1Name: null,
      tags: ["Personal"],
      isBookmarked: true,
    },
    {
      ...base(),
      id: SAMPLE_IDS.noteMeeting,
      type: "regular",
      title: "Meeting Notes",
      content: "Discussed project timeline and deliverables",
      pages: [],
      page1Name: null,
      tags: ["Work"],
    },
  ];
}

function sampleTodo(): Todo {
  const step = (n: number, category: string, title: string, content: string, done: boolean) => ({
    id: `sample-todo-step-${n}`,
    category,
    title,
    content,
    done,
  });
  return {
    ...base(),
    id: SAMPLE_IDS.todoTrip,
    type: "todo",
    title: "Plan a weekend trip",
    tags: ["Personal"],
    categories: ["Before you go", "Packing"],
    steps: [
      step(1, "Before you go", "Pick the dates", "Check the weather first", true),
      step(2, "Before you go", "Book the bus", "Early seats are cheaper", false),
      step(3, "Before you go", "Tell a friend", "Share the plan and the return time", false),
      step(4, "Packing", "Charger and power bank", "", false),
      step(5, "Packing", "Toothbrush", "", false),
      step(6, "Packing", "Rain jacket", "", false),
    ],
    annotations: [{ id: "sample-todo-note-1", category: "Packing", title: "Budget", content: "Keep it to one bag." }],
  };
}

function sampleBoard(): Board {
  const node = (id: string, x: number, y: number, label: string, body: string) => ({
    id,
    kind: "text" as const,
    x,
    y,
    label,
    body,
    customIconId: null,
  });
  const edge = (id: string, source: string, target: string, label: string | null) => ({
    id,
    source,
    target,
    label,
    directed: true,
  });
  return {
    ...base(),
    id: SAMPLE_IDS.boardLaunch,
    type: "board",
    title: "Launch plan",
    tags: ["Work"],
    nodes: [
      node("sample-board-n1", 0, 120, "Idea", "A notes app that works offline"),
      node("sample-board-n2", 240, 0, "Research", "Talk to five people"),
      node("sample-board-n3", 240, 240, "Build", "Notes first, then boards"),
      node("sample-board-n4", 480, 120, "Launch", "Share it with friends"),
    ],
    edges: [
      edge("sample-board-e1", "sample-board-n1", "sample-board-n2", "then"),
      edge("sample-board-e2", "sample-board-n1", "sample-board-n3", "and"),
      edge("sample-board-e3", "sample-board-n2", "sample-board-n4", null),
      edge("sample-board-e4", "sample-board-n3", "sample-board-n4", "when ready"),
    ],
    // null = fit the whole board on screen the first time it opens.
    viewport: null,
  };
}

/** A fresh copy of every example entry, in the order they are added. */
export function buildSampleEntries(): Array<Note | Todo | Board> {
  return [...sampleNotes(), sampleTodo(), sampleBoard()];
}

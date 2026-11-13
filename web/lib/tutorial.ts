// The first-time guided tour: one sample repo and a short list of guiding questions.
// To use a different sample project, change TUTORIAL_REPO and adjust the steps to match it.

/** The sample project is this tool's own code, so students explore the thing they are using. */
export const TUTORIAL_REPO = "Lville-Innovation/codeexplorer";
export const TUTORIAL_HREF = `/talk?repos=${encodeURIComponent(TUTORIAL_REPO)}&tour=1`;

export type TourAction =
  | { kind: "start" }
  | { kind: "ask"; label: string; question: string }
  /** Something the student does by hand, with a question to fall back on. */
  | { kind: "self"; instruction: string; label: string; question: string }
  | { kind: "finish" };

export interface TourStep {
  title: string;
  /** Why this step matters, in a sentence or two. */
  goal: string;
  action: TourAction;
  /** What to look at on screen while Pixel answers. */
  notice: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Meet Pixel",
    goal: "Pixel is the fox who has read every file in the sample project. Start a session so the two of you can talk.",
    action: { kind: "start" },
    notice: "Your browser may ask to use your microphone. Say yes to talk out loud, or say no and type your questions instead. The label under Pixel tells you when it is listening.",
  },
  {
    title: "Get the big picture",
    goal: "Before reading any code, find out what the project is for. The sample project is the code behind this very website.",
    action: { kind: "ask", label: "What does this project do?", question: "What does this project do, in simple words?" },
    notice: "Everything you and Pixel say appears under Conversation. New words Pixel explains show up as cards under Words to know, on the right.",
  },
  {
    title: "Read the welcome page",
    goal: "Almost every project has a file called README. It is the welcome page, and it is the best place to start in any codebase.",
    action: { kind: "ask", label: "Show me the README", question: "Show me the README and tell me what it says." },
    notice: "The file opens in the Code window in the middle of the screen. The lines Pixel is talking about are highlighted, with a short note above them.",
  },
  {
    title: "Tour the folders",
    goal: "Folder names are like labels on drawers. They tell you where each kind of thing lives.",
    action: { kind: "ask", label: "Tour the folders", question: "Give me a tour of the folders and what each one is for." },
    notice: "The file list sits on the left side of the Code window. This project has two main folders: one for the website and one for Pixel.",
  },
  {
    title: "Follow one feature",
    goal: "The best way to learn a codebase is to pick one thing it does and find the code behind it. Find out where Pixel gets its personality.",
    action: { kind: "ask", label: "Where is Pixel's personality written?", question: "Where in the code is Pixel's personality and way of talking written? Show me that code." },
    notice: "Listen for how Pixel found it, such as searching for a word. The link at the top right of the Code window opens the same lines on GitHub.",
  },
  {
    title: "Open a file yourself",
    goal: "Now you drive. Pick a file from the file list and ask Pixel what it is for.",
    action: {
      kind: "self",
      instruction: "In the file list, tap the folder web, then lib, then the file parse.ts.",
      label: "Or let Pixel open it",
      question: "Show me the file web/lib/parse.ts and explain what it does.",
    },
    notice: "Tapping any file asks Pixel to show it and explain its job. You never have to understand every line; ask about the part that looks interesting.",
  },
  {
    title: "Meet the people",
    goal: "Code is written by people, one saved change at a time. Each saved change is called a commit.",
    action: { kind: "ask", label: "Who works on this?", question: "Who has worked on this project, and what changed most recently?" },
    notice: "Open the People tab on the right to see how active the project is and who has made the most changes.",
  },
  {
    title: "Your turn",
    goal: "That is the whole method: big picture, welcome page, folders, then follow one feature. Ask anything you like, or try it on a project you picked.",
    action: { kind: "finish" },
    notice: "Stuck for ideas? Ask how Pixel remembers a project it has already read, what happens when you paste a link, or which file would be the easiest one to change.",
  },
];

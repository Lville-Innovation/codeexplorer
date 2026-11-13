# First-time tutorial

This walkthrough takes about five minutes. It uses a sample project and a short list of guiding questions to show you how to explore any codebase with Pixel.

The same tour is built into the site and runs by itself. The first time someone opens the site in a browser, they are taken straight to it. They press **Begin the tour** once, and Pixel then walks through every step: it asks each guiding question, puts the right file in the Code window, opens the right panel, and moves on when it has finished talking. A red banner across the top of the page shows the current step, with Pause, Back, Next and Skip buttons. The student can interrupt with their own question at any time.

To run it again later, press **Start the tour** on the home page. This page is the written version, for teachers and for anyone who wants to read ahead.

## The sample project

The sample is this project's own code: `https://github.com/Lville-Innovation/codeexplorer`. You will be exploring the code behind the very site you are using. It is a good first project because it is small, it has two clearly separate parts, and you already know what it does.

## Before you start

- Use a laptop or desktop with a recent browser.
- Headphones help, so Pixel does not hear itself.
- You can talk out loud or type. Both work the whole way through.

## The screen

| Area | Where | What it is for |
| --- | --- | --- |
| Pixel | Top left | The fox you talk to. The label underneath says whether Pixel is listening, thinking, or talking. |
| Guided tour | Red banner across the top | The current step of this tutorial, what to notice, and the tour controls. |
| Try asking | Below Pixel | Questions you can tap at any time. |
| Code window | Middle | A file list on the left, and the file Pixel is showing on the right, with the important lines highlighted. |
| Conversation | Below the code | Everything you and Pixel have said, plus a box for typing. |
| Words to know, About, People | Right | New words explained, a summary of the project, and who works on it. |

## The steps

### 1. Meet Pixel

Press **Start talking**. Your browser may ask to use your microphone. Say yes to talk, or no to type instead. Pixel can take up to 20 seconds to arrive the first time.

### 2. Get the big picture

Ask: **"What does this project do, in simple words?"**

Before reading any code, find out what the project is for. Notice that the answer appears under Conversation, and that new words show up as cards under Words to know.

### 3. Read the welcome page

Ask: **"Show me the README and tell me what it says."**

Almost every project has a README. It is the welcome page and the best place to start. Notice that the file opens in the Code window with the lines Pixel is talking about highlighted.

### 4. Tour the folders

Ask: **"Give me a tour of the folders and what each one is for."**

Folder names are like labels on drawers. This project has two main ones: `web` (the website) and `agent` (Pixel). Find them in the file list.

### 5. Follow one feature

Ask: **"Where in the code is Pixel's personality and way of talking written? Show me that code."**

The best way to learn a codebase is to pick one thing it does and find the code behind it. Listen for how Pixel found the answer. The link at the top right of the Code window opens the same lines on GitHub.

### 6. Open a file yourself

In the file list, tap `web`, then `lib`, then `parse.ts`. Tapping a file asks Pixel to show it and explain its job. You never have to understand every line.

### 7. Meet the people

Ask: **"Who has worked on this project, and what changed most recently?"**

Code is written by people, one saved change at a time. Each saved change is called a commit. Open the People tab to see how active the project is.

### 8. Your turn

Ask anything. Some ideas:

- How does Pixel remember a project it has already read?
- What happens, step by step, when I paste a link?
- Which file would be the easiest one to change?
- What is the hardest part of this code to understand, and why?

## The method, in one line

Big picture, then the welcome page, then the folders, then follow one feature. It works on any project.

## Try it on another project

Go back to the home page and paste a link to any public GitHub or gitlab.com project. Then run the same four moves.

## For teachers: changing the sample

The sample project and the steps live in `web/lib/tutorial.ts`. Change `TUTORIAL_REPO` to use a different project, and edit the questions so they match what that project contains. Each step can also name the file Pixel should show (`direct`) and the side panel to open (`tab`).

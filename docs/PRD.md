# Product requirements: EduHub, first release

## What it is

A personal workspace for one teacher. Not a file drive and not a school-management system.
It holds the teacher's profile, subjects, classes, semesters, units, files, videos, slides, images,
lesson plans, worksheets, links, and an AI assistant that works inside that structure.

## Who uses it

Teachers, many of them not comfortable with technology. One role exists: `TEACHER`.
The role column is an enum so other roles can be added later; none has any screen or logic today.

## Out of scope

Secretary, principal, supervisor, school directories, school codes, official school lists, approvals,
phone numbers, sharing between teachers.

## Registration

Three short steps, then a code:

1. Four-part name, gender, national ID.
2. Email, password, confirm password.
3. School name (typed by the teacher, stored as typed, editable later), subjects, grades, academic year.
4. A 6-digit code is emailed. Entering it creates the workspace.

Language and theme are switches in the page header and are saved with the account.

## Sign-in

- Email and password, with "Remember me" (up to 180 days on that device).
- Google. A first Google sign-in leads to "Complete your teaching profile", which asks for everything
  in steps 1 and 3 above and never for the email again.
- Facebook is not built. The sign-in code has one place where another provider plugs in.

## Email codes

One service issues every code: confirming an email, resetting a password, changing the email.
Six random digits, ten minutes, five wrong tries, single use, a new code cancels the old one,
60 seconds between sends and five sends an hour. Codes are never shown on screen.

## Structure

Teacher → subject → grade → semester → unit → resource sections → resources.

- A class is one subject in one grade for one academic year. Registration creates one class for every
  chosen subject and grade; more can be added, and a class can be archived.
- Every class has two semesters. Every semester starts with units 1 to 12; units can be added,
  named and, while empty, removed.
- Every unit starts with the default sections (videos, files, images, presentations, lesson plans,
  worksheets, posters, links). The teacher can add, rename, restyle and, while empty, delete sections.
- Inside a section the teacher adds, edits, moves, duplicates, reorders and trashes resources.
- Subjects and default sections are rows in the database, seeded by a migration.

## Resources

Uploads: PDF, PPT/PPTX, DOC/DOCX, XLS/XLSX, PNG/JPG/WEBP, MP4/MOV. Links: YouTube, Canva, Gamma,
Google Docs/Slides/Drive, or any other site. Each section type declares what it accepts and the
"add" dialog adapts. Every resource is shown as a card with a preview where one exists.

Adding from inside a section never asks where the resource belongs. Adding from elsewhere reads the
file name and proposes class, unit, section and topic; the teacher approves, edits or cancels.

## Finding things

One search across everything: titles, tags, topics, file names, and the unit, section and subject a
resource sits in. Favourites, recently used, and a trash with restore.

## Assistant

Knows the teacher, subject, grade, semester, unit, section and open resource. Generates lesson plans,
quizzes, worksheets and more as drafts that are previewed, edited and saved as notes. Reads the
contents of the current place's files only when the teacher ticks the consent box.

## Experience

Few steps, plain words, large buttons, breadcrumbs on every page, Arabic and English with full
RTL/LTR, light and dark themes, phone-first, installable.

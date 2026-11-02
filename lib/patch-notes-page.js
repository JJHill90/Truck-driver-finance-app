/**
 * Public Updates page for Go Taxation Suite (gotaxationsuite.com/updates).
 */
const { listPatchNotes, currentPatchNote } = require("./patch-notes");

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNoteDate(isoDate) {
  const [year, month, day] = String(isoDate || "").split("-").map((part) => Number(part));
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function versionSlug(version) {
  return String(version || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function renderNotes() {
  return listPatchNotes()
    .map((note, index) => {
      const items = note.items.map((item) => `<li>${esc(item)}</li>`).join("\n            ");
      const current = index === 0 ? " patch-current" : "";
      return `        <article class="patch-note${current}" id="${esc(versionSlug(note.version))}">
          <header>
            <h2>${esc(note.version)}</h2>
            <time datetime="${esc(note.date)}">${esc(formatNoteDate(note.date))}</time>
          </header>
          <ul>
            ${items}
          </ul>
        </article>`;
    })
    .join("\n");
}

function renderPatchNotesPage() {
  const current = currentPatchNote();
  const currentLabel = current ? current.version : "";
  return `<!DOCTYPE html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Updates — Go Taxation Suite</title>
    <link rel="canonical" href="https://gotaxationsuite.com/updates" />
    <meta
      name="description"
      content="Patch notes for Go Taxation Suite. Each shipped version is listed with a short summary of what changed. Contact support@godriverhub.com."
    />
    <link rel="icon" type="image/png" href="/suite/icon-512.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Saira+Condensed:wght@700;800&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/welcome.css" />
  </head>
  <body class="welcome-page welcome-suite">
    <header class="welcome-bar">
      <a class="welcome-brand-link" href="/">
        <img class="welcome-mark" src="/suite/icon-512.png" width="40" height="40" alt="" />
        <div class="welcome-brand">Go Taxation Suite</div>
      </a>
      <div class="welcome-bar-spacer"></div>
      <nav class="welcome-nav" aria-label="Website">
        <a href="/">Overview</a>
        <a href="/#about">About</a>
        <a href="/updates" aria-current="page">Updates</a>
        <a href="/support">Support</a>
      </nav>
      <a class="btn primary" data-welcome-app href="/suite/">Open the app</a>
    </header>

    <main class="welcome-main">
      <section class="hero">
        <h1>Updates</h1>
        <p class="hero-lead">
          What changed in each version shipped to this website. The current release is
          <strong>${esc(currentLabel)}</strong>. A new entry is added here whenever that version
          goes live.
        </p>
      </section>

      <section class="patch-list" aria-label="Version history">
${renderNotes()}
      </section>

      <section class="support-panel patch-contact" aria-labelledby="contact-heading">
        <h2 id="contact-heading">Contact</h2>
        <p>
          If an update does not look right, email
          <a href="mailto:support@godriverhub.com">support@godriverhub.com</a>
          or send a message below. We reply to the email you enter. Help topics and the FAQ
          are on the <a href="/support">Support</a> page.
        </p>
        <form id="support-contact-form" class="welcome-form">
          <label>Name
            <input type="text" name="name" id="support-name" autocomplete="name" required placeholder="Your name" />
          </label>
          <label>Email
            <input type="email" name="email" id="support-email" autocomplete="email" required placeholder="Reply-to address" />
          </label>
          <label class="span-2">Phone number
            <input type="tel" name="phone" id="support-phone" autocomplete="tel" placeholder="Optional — for a call back" />
          </label>
          <label class="span-2">Message
            <textarea name="message" id="support-message" rows="6" required placeholder="Which version, and what happened?"></textarea>
          </label>
          <div class="span-2">
            <button type="submit" class="btn primary" id="support-send">Send message</button>
          </div>
        </form>
        <div id="support-contact-status" role="status" aria-live="polite"></div>
      </section>

      <p class="disclaimer">
        Not tax advice and not an official ATO product. The app does not lodge a BAS or tax return.
        You (or your registered agent) lodge with the ATO.
      </p>
    </main>

    <footer class="welcome-foot">
      <a href="/privacy">Privacy</a>
      ·
      <a href="/terms">Terms</a>
      ·
      <a href="/support">Support</a>
      ·
      <a href="mailto:support@godriverhub.com">support@godriverhub.com</a>
    </footer>
    <script src="/welcome.js"></script>
  </body>
</html>
`;
}

module.exports = {
  renderPatchNotesPage,
  formatNoteDate,
};

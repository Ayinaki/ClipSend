# Privacy Policy

**Effective date:** August 2026

ClipSend is a free, open-source desktop video tool for Windows. This policy
explains what information the app collects, how it is used, and how to contact
the maintainer.

## Short version

- All video and audio processing happens **locally on your device**. Your media
  files are never uploaded or transmitted.
- The app contacts GitHub only to check for and download updates.
- The optional in-app feedback form sends the text you submit to a Discord
  webhook owned by the maintainer.
- No analytics, no tracking, no advertising, and no accounts.

## Data handling

### Media files — processed locally only

All trimming, merging, exporting, cropping, waveform, and thumbnail generation
is performed on your own device using bundled FFmpeg binaries. ClipSend does
not upload, transmit, or store your media files on any server.

### Update checks

On startup, ClipSend contacts GitHub's Releases API to check whether a newer
version is available, and downloads the installer from the project's public
GitHub Releases page when you choose to update. This involves only the
technical requests needed for the update check and download; no personal data
is sent.

### Feedback

The in-app **Send Feedback** form (Bug Report / Feature Request / General
Feedback) sends the text you type to a Discord webhook operated by the
maintainer. It may include any contact information you choose to provide.
Media files are never attached. Submissions are stored in the maintainer's
Discord server and may be used to improve the app; you can request deletion by
opening an issue on GitHub.

### Settings and local data

Preferences (such as the default export folder, volume, and toggle states) are
stored locally on your device via `electron-store`. Update-status markers and
diagnostic logs are written to the app's local user-data folder. None of this
data is transmitted.

## Third parties

- **GitHub** — update checks and release downloads. GitHub's own
  [Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement)
  applies to those interactions.
- **Discord** — receives optional feedback submissions. Discord's own
  [Privacy Policy](https://discord.com/privacy) applies to that data.

## Children

ClipSend is not directed at children under 13, and we do not knowingly collect
personal information from children.

## Changes to this policy

If this policy changes, the effective date above will be updated and the change
will be noted in the repository release notes.

## Contact

To ask questions about this policy, request removal of a feedback submission,
or report a privacy concern, open an issue at
<https://github.com/Ayinaki/ClipSend/issues>.

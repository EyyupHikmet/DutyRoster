# DutyRoster

[Türkçe](README.md) · **English**

Offline desktop app that builds fair monthly teacher duty rosters from each
teacher's availability and monthly target, then exports them to Excel. Built
with Tauri, React and SQLite.

> **The user interface is currently Turkish only.** The app was built for
> Turkish school principals, who assign teachers to *nöbet* (supervision duty)
> days each month. Adding an i18n layer and an English locale is the project's
> top open issue — see [Contributing](#contributing). The code, the comments
> and the technical documentation are all in English.

## What problem it solves

In a school with 25–30 teachers, deciding who is on duty each day of the month
is a tedious manual job. Teachers have monthly targets and days they prefer,
can accept, or cannot work at all. Doing this by hand produces unfair rosters
and takes hours; doing it in a spreadsheet does not enforce the constraints.

DutyRoster models the month as a constraint satisfaction problem and solves it,
or tells you in plain language exactly why no valid roster exists — for
example, that a given Tuesday has nobody marked available.

## Features

- **Roster management** — add, edit and remove teachers, each with a monthly
  duty target and a seniority/priority weight. No cap on roster size.
- **Per-teacher availability calendar** — mark each date as preferred,
  available, or unavailable.
- **Excel/CSV import** for the roster, so you do not retype it every year.
  Either a table with name, target and seniority columns, or just a single
  column of names — in which case target and seniority take their defaults.
- **Four solving strategies**: distribute duties evenly, weight by seniority,
  pin specific teachers to specific days, or fill remaining days randomly.
- **Hard monthly targets** — optionally guarantee that no teacher is ever
  given more duties than their monthly target. If the roster cannot cover the
  month, days are left open rather than targets exceeded; open days are
  reported when the schedule is generated, and confirmed before you export.
- **Flexible month shape** — weekdays by default; toggle individual weekend
  days or holidays in or out, and set a different number of teachers on
  different days.
- **Draft persistence** — a month's configuration is saved even if you never
  generate a roster for it, and you are prompted before leaving a month with
  unsaved changes.
- **Excel export** with a native Save-As dialog, a versioned default filename,
  and a confirmation that offers to open the file or its folder.
- **Actionable diagnostics** — when no roster is possible, the error names the
  specific date and constraint that made it impossible.
- **Fully offline.** No account, no server, no telemetry. All data lives in a
  local SQLite file.

## Installing

Download the latest installer for your platform from the
[Releases](https://github.com/EyyupHikmet/DutyRoster/releases) page:

- **Windows** — either the `.msi` or the `-setup.exe`. They install the same
  application; pick whichever you prefer.
- **macOS** — the `.dmg`. It's a universal build that runs natively on both
  Apple Silicon and Intel Macs.

Neither build is code-signed (that requires a paid certificate the project
does not have yet), so both platforms will warn you before the app runs the
first time. This is expected — see below for how to get past it, and how to
verify the download yourself if you'd rather not just take that on faith.

### "Windows protected your PC"

Windows shows this the first time you run the installer. It may also appear as
*"Microsoft Defender SmartScreen prevented an unrecognised app from starting"*.

**To continue: click _More info_, then _Run anyway_.**

This happens because the installer is not code-signed, so Windows does not
recognise the publisher. It is not a virus warning, and it does not mean
anything was found in the file — an unsigned installer from a small project
gets this message whatever it contains.

### "Apple could not verify ... is free of malware" (macOS)

macOS shows this, or the similar *"DutyRoster is damaged and can't be
opened"*, because the app isn't notarized by Apple. Despite the alarming
wording, nothing is actually wrong with the file — this is macOS refusing to
run an unsigned app downloaded from the internet, and every unnotarized app
gets some version of this message. Right-click → Open does not offer a bypass
here, since that shortcut only helps for apps that are signed but not
notarized, not fully unsigned ones like this build. Two ways past it instead:

**Terminal, once:**

```bash
xattr -cr /Applications/DutyRoster.app
```

Then open the app normally.

**Or via System Settings**, no Terminal needed: System Settings → Privacy &
Security → scroll to the Security section → you'll see *"'DutyRoster.app' was
blocked to protect your Mac"* with an **Open Anyway** button. Click it,
authenticate, then open the app again and confirm **Open** in the follow-up
dialog.

### Verifying a download

Every release includes a `SHA256SUMS-windows.txt` and a `SHA256SUMS-macos.txt`.
Compare your download against the matching one:

```powershell
# Windows (PowerShell)
Get-FileHash .\DutyRoster_0.4.0_x64-setup.exe -Algorithm SHA256
```

```bash
# macOS (Terminal)
shasum -a 256 DutyRoster_0.4.0_universal.dmg
```

If the hash matches that file's line in the corresponding `SHA256SUMS-*.txt`,
your download is byte-for-byte the file GitHub built from the tagged source.

Prefer to build it yourself? See below.

## Building from source

**Prerequisites**

| | |
|---|---|
| Node.js | 20 or newer |
| Rust toolchain | stable, via [rustup](https://rustup.rs) |
| WebView2 runtime | Windows only, and preinstalled on Windows 11 |
| Xcode Command Line Tools | macOS only — `xcode-select --install` |

Tauri compiles a Rust host around the web frontend, so the Rust toolchain is
required even though almost all the application code is TypeScript.

```bash
npm install
npm run tauri dev     # run the real desktop app
npm run tauri build   # produce a native installer
```

On Windows you can also just double-click `run.cmd`, which checks the
prerequisites and starts the app. `run.sh` does the same on macOS and Linux.

> **`npm run dev` alone is not enough.** It starts the Vite dev server, but the
> app is then running in a plain browser with no Tauri IPC bridge — the
> database, the file dialogs and the Excel export will all fail. Anything that
> touches persistence or the filesystem has to be exercised through
> `npm run tauri dev`.

Development has been on Windows, and macOS has now been built, run and tested
as well. Tauri also supports Linux and nothing in the code is
platform-specific, but Linux hasn't been tried — reports welcome.

## Tests

```bash
npm test              # vitest, with coverage
npx tsc --noEmit      # type check
```

The suite covers the solver, the persistence hooks, the Excel helpers and the
React components, and mocks the Tauri plugin layer so it runs without a
desktop session.

## How it works

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design, the database schema and
how the solver works, and [docs/decisions/](docs/decisions/) for the reasoning
behind the significant technical choices.

## How this was built

Most of the code in this repository was written by AI agents working under
human direction. Each piece of work was specified, reviewed and tested by a
person before it was accepted; the design decisions recorded in
[docs/decisions/](docs/decisions/) are human decisions; and the app has been
run against a real school's roster rather than only against test data.

This is stated because you should know what you are installing and
contributing to. It changes nothing about the licence or the upkeep of the
project — issues and pull requests are read and answered by a person.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Adding
internationalisation so the app can ship in languages other than Turkish is the
highest-value contribution available right now.

## License

[MIT](LICENSE).

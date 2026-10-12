# Personal Keyviz fork

This fork is maintained at <https://github.com/adampush-arena/keyviz>.
The original project is <https://github.com/mulaRahul/keyviz>.
Keep the upstream copyright notices and GPL-3.0-or-later license.

## Branches and remotes

- `origin` points to this fork and is the default push destination.
- `upstream` points to the original project.
- `main` follows `upstream/main` and stays free of personal changes.
- `personal` contains the tested changes used for local builds.
- `codex/*` branches hold individual fixes or enhancements.

The initial personal changes are:

- `365de0f`: correct mouse indicator coordinates on scaled external macOS displays.
- `b96f9e1`: keep key combinations together and start their shared timeout after
  the final key is released.

Start general fixes from `main` when they might be contributed upstream. Start
personal enhancements from `personal`. Test a feature branch before merging it
into `personal`. An upstream pull request is optional; open it explicitly against
`mulaRahul/keyviz` when desired. The GitHub CLI default repository is this fork.

## Build and install on macOS

With dependencies installed, run these checks from the repository root:

```sh
npm test
npm run build
```

Build the application bundle from `personal`:

```sh
git switch personal
npm run tauri -- build --bundles app
```

The app is generated at `src-tauri/target/release/bundle/macos/keyviz.app`.
Fully quit the running Keyviz, replace the installed Applications copy with that
bundle, and launch the Applications copy.

Locally signed rebuilds can invalidate macOS's saved Input Monitoring approval.
Keyviz checks access at startup and while running, and opens its settings when
input access is blocked. Use **Open Input Monitoring** to reach the macOS pane.
If Keyviz is already enabled there, expand **Already enabled, but still not
working?** and choose **Renew approval**. This clears only Keyviz's Input
Monitoring approval. **Show this app in Finder** identifies the running copy to
add and enable. Use **Restart Keyviz** after granting access to reconnect the
input listener. Check Accessibility approval as well if needed.

Close the settings window when testing expiry: indicators intentionally remain
visible while settings are open.

## Indicator controls

- **Keycap → Indicator size** resizes the keypress cards, labels, and icons.
- **Mouse → Cursor Highlight** has independent left- and right-click colors.
  Existing settings keep their old highlight color for left clicks; right clicks
  default to orange-red. The click color stays consistent through release and
  fade.

## Bring in upstream updates

Finish or save working changes before switching branches. Update the upstream
baseline, then merge it into the personal branch:

```sh
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch personal
git merge main
npm test
npm run build
git push origin personal
```

If a merge reports conflicts, resolve them and rerun the checks before pushing or
rebuilding the installed app. If upstream later accepts one of this fork's fixes,
reconcile the duplicate change when bringing that update into `personal`.

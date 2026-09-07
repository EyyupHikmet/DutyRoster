**What this changes**

<!-- And why. Link the issue if there is one. -->

**How it was verified**

- [ ] `npx tsc --noEmit` is clean
- [ ] `npm test` passes
- [ ] If this touches the database, file dialogs, or anything else native:
      I ran the real app with `npm run tauri dev` and exercised it. What I did:

<!-- The test suite mocks the Tauri plugin layer, so it cannot catch a broken
     database call or a missing capability grant. If your change crosses into
     the native layer, please say what you actually clicked and saw. -->

**Anything to watch out for**

<!-- New user-facing strings (they should be Turkish), a new Tauri capability
     grant, or anything a reviewer should look at closely. -->

# CareBridge

CareBridge is a no-backend browser workbench for rehearsing a week of shared oncology or recovery care. It uses fictional data only. It is not a medical device, a diagnosis tool, a treatment plan, or a substitute for a clinician, a pharmacist, or emergency services.

## Run it

```sh
npm start
```

Open `http://127.0.0.1:4173/`. Node 22 or later is sufficient; there is nothing to install. For static hosting, serve the project over HTTPS. The first visit needs the same-origin app assets; once the page reports offline readiness, it can reload without a connection as long as the browser keeps its cache. A fresh device must visit once to open the app offline later. The app does not persist the demo session or check-ins. Export anything you want to keep. Do not enter real health information.

## Three things to try

1. Start on **Post-chemo week**. The primary-first baseline and the balanced solver both cover all 12 shifts. Maya goes from 28 hours to 7, and workload Gini moves from 0.715 to 0.061 on this fictional roster.
2. Switch to **Understaffed crisis week**. The exact solver covers 7 of 11 shifts versus the baseline's 5. See separate gaps for availability, skills, and cap/rest limits. Restore Ana to preview 10 of 11; one cap/rest gap remains.
3. Open **Handoff**. Choose a caregiver, preview the binder in English or Spanish, print one page, export a calendar, or make a synthetic handoff link. The link recipient does not need an account.

## What the rules actually mean

- **Scheduling.** The optimizer maximizes the number of covered shifts before minimizing absolute workload inequality among active caregivers, including active caregivers assigned zero hours. An equal objective keeps the first solution in chronological shift and caregiver-ID order. The primary-first greedy comparison uses the same inputs, active roster, caps and rest constraints. The number of hours worked can rise when more shifts are covered. Gini is not a diagnosis of burnout. Timing uses nominal week minutes; all shipped weeks avoid a clock transition. The exact solver rejects oversized work rather than calling a partial answer optimal.
- **Symptoms.** The exercise uses the CDC first-reading call threshold for chemotherapy, 100.4 F or 38.0 C, and flags signs of infection even without fever. The formal IDSA oral definition is shown separately. It uses 38.3 C or the published Fahrenheit counterpart of 101.0 F once, or 38.0 C / 100.4 F sustained for at least 60 minutes. The two published high cutoffs are not mathematically identical. The app compares the entered unit without rounding across a threshold, and never advises waiting an hour. The trend demo picks strictly increasing symptoms across three days; that heuristic is not a clinical standard. A missing alert never rules out illness.
- **Medication.** The same-day model flags worked examples of possible fever masking, NSAID bleeding risk, and imatinib with grapefruit or St. John's wort. Exact timing comparisons are for the named ciprofloxacin and levothyroxine tablet examples, not all antibiotics or thyroid medications. It does not assess adjacent days, every product, dosing, organ function, or the suitability of any prescription. Do not use it to change, skip, add, or time a real dose.
- **Handoff.** Web Crypto seals each card with a fresh 256-bit AES-GCM key and random 96-bit IV. The cipher and key travel in the URL fragment, which is not sent with the HTTP request. Anyone with the entire link can read it or create a replacement. It is not sender authentication and has no expiration or revocation. Browser history, chat previews, or copy tools can still expose a full link. Only preset aliases, shift roles, dates and fixed note choices can be shared. It is not built to hold health records.
- **Exports.** Calendar dates are resolved from the scenario's America/Chicago wall time into RFC 5545 UTC values, independent of the host time zone. Nonexistent or repeated times are rejected rather than guessed. No `.ics` is offered for an empty handoff because RFC 5545 requires at least one calendar component. CSV escaping and formula neutralization are distinct steps. The JSON digest is SHA-256 over UTF-8 JSON with recursively sorted object keys and ECMA-262 serialization semantics for values. It detects byte-equivalent canonical payload changes when compared with a trusted digest; it is not a signature.

## Sources

- [CDC, Watch Out for Fever](https://www.cdc.gov/cancer-preventing-infections/patients/fever.html) and [Know the Signs and Symptoms of Infection](https://www.cdc.gov/cancer-preventing-infections/patients/symptoms.html)
- [IDSA fever and neutropenia guideline](https://doi.org/10.1093/cid/cir073), definition of fever
- [MedlinePlus, Recognizing medical emergencies](https://medlineplus.gov/ency/article/001927.htm)
- [NCI, Infection and Neutropenia during Cancer Treatment](https://www.cancer.gov/about-cancer/treatment/side-effects/infection), fever masking and calling the care team
- DailyMed label examples for [ibuprofen](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=faebc392-0fd9-4c71-8471-beba10dda022), [naproxen](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=8dd7fade-d750-49ce-b798-a1d3615e57b7), [imatinib](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=559dd8e5-11f9-70cd-3fb0-9f9eb8484a37), [ciprofloxacin tablets](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=5723eaf9-8659-4730-b792-4e4c33690ccb&type=display) and [levothyroxine tablets](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=f31ba297-e042-187a-e053-2a95a90a4861)
- [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545), [ECMAScript JSON serialization](https://tc39.es/ecma262/#sec-json.stringify), and [WCAG Character Key Shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html)

## Verify

```sh
nice -n 15 npm test
nice -n 15 npm run test:browser
nice -n 15 npm run test:browser -- --capture
```

The browser check needs Chrome. Set `CHROME_BIN` if Chrome is not in the default location. It uses a separate local browser profile and serves the app under `/carebridge/` to exercise a static-site subdirectory. Screen captures land in `docs/` only with `--capture`. The repository does not include patient data, production deployment credentials, or a backend. The examples have not been clinically validated.

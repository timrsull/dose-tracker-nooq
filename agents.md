# Dose Tracker - Agent Documentation

## What This App Does
A medication tracking app that allows users to:
- Add medications with optional dosing intervals
- Search medications via typeahead/lookahead filtering
- Record when doses are taken (now or custom time)
- See when the next dose is available based on the interval

## Key Features
1. **Medication Management**: Add, edit, delete medications
2. **Dose Interval Tracking**: Optional "hours between doses" for each medication
3. **Typeahead Search**: Real-time filtering as you type (debounced 200ms)
4. **Next Dose Countdown**: Shows time until next available dose
5. **Dose History**: Records each dose with timestamp

## Architecture Decisions

### Separation of Concerns
- `logic.js`: All database interactions via Actions (mutations) and Views (queries)
- `app.js`: UI rendering and event handling only
- This allows testing logic independently from UI

### Local State Management
- After mutations, we update local state directly instead of re-fetching
- This avoids hitting rate limits and provides instant UI feedback
- Full refresh only happens on search or initial load

### Query Design
- `listMedications` uses a subquery to get the last dose in one query
- `searchMedications` uses the `filters` feature for optional LIKE clause
- Keeps query count minimal

### Time Handling
- All times stored as ISO 8601 UTC strings
- Client-side formatting for display
- Countdown updates every 60 seconds via setInterval

### No External Dependencies
- Pure vanilla JS (CSP doesn't allow CDN imports anyway)
- All date/time formatting done with native APIs

## Schema

### medications
- `id`: INTEGER PRIMARY KEY
- `name`: TEXT NOT NULL
- `dose_interval_hours`: REAL (nullable - hours between doses)
- `created_at`: TEXT (ISO 8601)

### doses
- `id`: INTEGER PRIMARY KEY
- `medication_id`: INTEGER NOT NULL
- `taken_at`: TEXT NOT NULL (ISO 8601 - when dose was taken)
- `created_at`: TEXT (ISO 8601 - when record was created)

## Future Improvements
- Notification reminders (would need service worker)
- Dose history view per medication
- Export/import data
- Multiple dose schedules (e.g., twice daily at specific times)

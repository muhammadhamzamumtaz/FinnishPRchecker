# Migri Appointment Availability Checker

This project checks the Finnish Immigration Service appointment booking page for open appointment slots and sends an email alert when it finds a matching slot.

It only notifies you. It does not book, reserve, or submit anything.

## What It Checks

- Site: <https://migri.vihta.com/public/migri/#/reservation>
- Category: `Residence permit`
- Sub-category: `Permanent residence permit`
- Offices: Helsinki first, then the fallback city list in `src/check-migri.js`
- Date window: from 1 week through 3 weeks from the day the check runs

The checker stops at the first office, in priority order, that has an open slot.

## Important First Step: Calibrate Locally

Migri's booking site is an Angular single-page app. The script uses Playwright so it can load and interact with the real page, but the exact labels and calendar markup may change.

The values most likely to need adjustment are at the top of `src/check-migri.js`:

- `categoryText`
- `subCategoryText`
- `officesInPriorityOrder`
- `calendar.candidateSlotSelector`
- `calendar.nextMonthButtonNames`
- `calendar.unavailableTextPatterns`

Run in visible browser mode first:

```bash
npm install
npx playwright install chromium
HEADLESS=false SLOW_MO_MS=250 npm run check
```

On Windows PowerShell, use:

```powershell
npm install
npx playwright install chromium
$env:HEADLESS="false"; $env:SLOW_MO_MS="250"; npm run check
```

Watch the browser and confirm each click-through step works. If it fails to find a category, sub-category, office, or slot, update the configuration values at the top of `src/check-migri.js`.

## Email Setup With Gmail

Use a Gmail app password, not your normal Gmail password.

1. Enable 2-Step Verification on the Gmail account.
2. Open your Google Account security settings.
3. Create an app password for this checker.
4. Save the generated 16-character password somewhere safe temporarily.

The script expects these environment variables:

- `GMAIL_USER`: the Gmail address sending the alert
- `GMAIL_APP_PASSWORD`: the Gmail app password
- `ALERT_TO_EMAIL`: the recipient email address

For a local test:

```powershell
$env:GMAIL_USER="your-gmail-address@gmail.com"
$env:GMAIL_APP_PASSWORD="your-app-password"
$env:ALERT_TO_EMAIL="recipient@example.com"
$env:HEADLESS="false"
npm run check
```

No email is sent when no matching slot is found.

## GitHub Actions Setup

The workflow is in `.github/workflows/migri-appointment-check.yml`.

It runs:

- every 30 minutes by cron
- manually with `workflow_dispatch`

Do not schedule this more frequently than every 10-15 minutes. This is a government website, so keep checks respectful.

## Add GitHub Secrets

In your GitHub repository:

1. Go to **Settings**.
2. Go to **Secrets and variables**.
3. Open **Actions**.
4. Add these repository secrets:
   - `GMAIL_USER`
   - `GMAIL_APP_PASSWORD`
   - `ALERT_TO_EMAIL`

Never commit these values to the repository.

## Test the Workflow Manually

After pushing the project to GitHub:

1. Open the repository on GitHub.
2. Go to **Actions**.
3. Select **Migri appointment availability check**.
4. Choose **Run workflow**.
5. Open the run logs and confirm the checker reaches the calendar.

If it fails, run locally in headed mode again and adjust the configuration at the top of `src/check-migri.js`.

## Notes

- The checker logs successful runs when no slot is found.
- It sends an email only when at least one slot is found in the configured date window.
- It stops after the first matching office in the priority list.
- It does not attempt authentication or booking.

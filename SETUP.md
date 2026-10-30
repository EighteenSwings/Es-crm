# Eighteen Swings CRM: setup guide

The CRM is a small web app you own outright. It runs on GitHub Pages (free), installs on your phone like an app, works offline, and keeps its master copy of all client data in GBI Mitchell's Google Drive. Nothing in it depends on Claude or any AI service.

Allow about 30 minutes for the first setup. Google and GitHub occasionally rename menu items, so if a label below doesn't match exactly, look for the nearest equivalent.

---

## How your data is stored

- **On each device:** every change is saved on the phone or laptop immediately, so it works with no signal.
- **In Google Drive:** when online, the app syncs to a file called `eighteen-swings-crm.json` in a folder called **Eighteen Swings CRM**. This is the master copy.
- **On GitHub:** only the app's code. No client data is ever stored there.

If two devices edit different bookings, both changes are kept. If they edit the same booking, the most recent edit wins. Deletions sync too.

---

## Step 1. Put the app on GitHub Pages (free)

1. Create a free account at github.com (or sign in).
2. Click **New repository**. Name it `es-crm`, set it to **Public**, tick **Add a README**, and create it.
   Public is required for free Pages hosting. It's fine: the code contains no client data.
3. In the repository, click **Add file → Upload files**. Drag in everything from this folder: `index.html`, `styles.css`, `app.js`, `config.js`, `sw.js`, `manifest.webmanifest`, and the `icons` and `fonts` folders. Click **Commit changes**.
4. Go to **Settings → Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, Branch to **main** and folder **/ (root)**. Save.
5. After a minute or two, your app is live at
   `https://YOUR-GITHUB-USERNAME.github.io/es-crm/`
   Note this address. You need it in step 2.

**Never upload backups, exports or anything containing client details to this repository.**

---

## Step 2. Let the app use GBI Mitchell's Google Drive

Do this signed in with your **GBI Mitchell Google Workspace** account.

1. Go to **console.cloud.google.com**. Create a new project called `Eighteen Swings CRM`.
2. Open **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.
3. Open **Google Auth Platform** (also called **OAuth consent screen**) and click **Get started**:
   - App name: `Eighteen Swings CRM`
   - Support email: your email
   - Audience / User type: **Internal**. This means only GBI Mitchell accounts can ever sign in, and Google doesn't need to review the app.
   - Contact email: your email. Finish.
4. Under **Data access** (or **Scopes**), add the scope `https://www.googleapis.com/auth/drive` and save.
5. Under **Clients** (or **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**
   - Name: `ES CRM web`
   - **Authorised JavaScript origins:** add `https://YOUR-GITHUB-USERNAME.github.io`
     (just the domain, no `/es-crm` and no trailing slash)
   - Leave redirect URIs empty. Create.
6. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
7. Back on GitHub, open `config.js`, click the pencil icon to edit, paste the Client ID between the quotes on the `googleClientId` line, and commit.

---

## Step 3. Install it on your phone

- **iPhone:** open the app address in **Safari**, tap **Share**, then **Add to Home Screen**.
- **Android:** open it in **Chrome**, tap **⋮**, then **Install app** (or **Add to Home screen**).

Then open it from the home screen, go to the **Data** tab and tap **Connect Google Drive**. Choose your GBI Mitchell account and allow access. The app creates the **Eighteen Swings CRM** folder in your Drive and syncs.

After that, the dot in the top corner shows the sync status. Edits sync on their own while you're online. Google sign-ins last about an hour, so if it says "Changes to sync", tap it and it will sign in and sync.

---

## Step 4. Give Georgie access (optional)

1. Georgie needs a GBI Mitchell Google account, because the app is set to Internal.
2. Better still, create a **Shared drive** called `Eighteen Swings` in Google Drive, add Georgie as a member, and move the **Eighteen Swings CRM** folder into it. The data then belongs to the company rather than to your personal account, which also makes the later move to ES's own account cleaner.
3. Georgie installs the app on her phone (step 3) and taps **Connect Google Drive**. The app finds the existing data file automatically.

---

## Step 5. Website enquiry form (Squarespace)

Each enquiry from the website goes to **info@eighteenswings.co.uk** and drops into the CRM's "New enquiry" column on its own. Squarespace does both for free; the CRM just reads the Sheet.

1. In Squarespace, add a **Form block** to your contact or booking page. Give it these fields (the CRM matches them by name, so keep the wording close):
   - **Name** (Name field)
   - **Partner's name or company** (Text, optional)
   - **Email** and **Phone**
   - **Event date** (Date field)
   - **Type of event** (Dropdown: Wedding morning, Wedding drinks reception, Wedding morning and reception, Corporate, Private party, Other)
   - **Venue** and **Venue postcode** (Text)
   - **Number of guests** (Number)
   - **How did you hear about us?** (Dropdown, optional)
   - **Message** (Text area)
2. Open the form block's **Storage** settings:
   - **Email:** set it to `info@eighteenswings.co.uk`.
   - **Google Drive:** connect it, signed in to the same Google account the CRM uses. Squarespace creates a Google Sheet for the responses.
3. Submit one test enquiry on the live site, then open the new Sheet in Google Drive and copy its link from the address bar.
4. In the CRM: **Data → Website enquiries**, paste the link, tap **Save link**, then **Check for new enquiries**. The test should appear in "New enquiry" with a green WEBSITE tag. Delete it once you've checked it; it won't come back.

From then on, the CRM checks the Sheet every time it syncs. Don't rename the Sheet's column headings, and never delete rows you haven't imported yet.

Squarespace's date field reads month/day/year. The CRM reads it that way, and keeps the date exactly as entered in the notes so you can double-check.

---

## Step 6. Business details, quotes and invoices

Go to **Packages** and fill in **Business details**: trading name, email, phone, the legal company name and number, registered address, and bank details. These appear on quotes and invoices. Bank details only show on invoices.

- **Quote PDF** and **Invoice** (deposit or balance) are at the bottom of each booking. Tap **Print or save PDF**, then choose "Save as PDF". This works best from a computer.
- **Email** opens a ready-written email in your email app, filled in with the client's details. Edit the wording under **Packages → Email templates**.
- **Distance** is worked out from your base postcode (GL19 4HW, changeable under Packages) using free services: postcodes.io for postcodes and OpenStreetMap for the driving route and map. It needs a connection; offline, the mileage stays as typed.

---

## Step 7. Optional: use your own domain

Once eighteenswings.co.uk is live, you can serve the app at `crm.eighteenswings.co.uk`:

1. GitHub: **Settings → Pages → Custom domain**, enter `crm.eighteenswings.co.uk`, save, and tick **Enforce HTTPS** once available.
2. Squarespace (Domains → DNS settings): add a **CNAME** record with host `crm` pointing to `YOUR-GITHUB-USERNAME.github.io`.
3. Google Cloud (step 2.5): add `https://crm.eighteenswings.co.uk` as another Authorised JavaScript origin.
4. Reinstall the app on your phone from the new address and connect Drive again. Your data comes back from Drive.

---

## Moving to Eighteen Swings' own Google account later

1. In the app, **Data → Sync now**, then **Download backup**.
2. Set up the Google Cloud project again (step 2) under the new ES Workspace, and put the new Client ID in `config.js`.
3. On your phone: **Data → Disconnect**, then **Clear data on this device**.
4. Tap **Connect Google Drive** with the new ES account, then **Import backup** and choose the file from step 1. It syncs into the new Drive.
5. Once you've checked everything is there, delete the old folder from GBI Mitchell's Drive (and empty its trash).

---

## Updating the app

When you get new versions of the files, upload them to GitHub the same way (they replace the old ones). Always change the `VERSION` line at the top of `sw.js` (e.g. `es-crm-v1` → `es-crm-v2`) so phones pick up the update. Close and reopen the app once to see it.

Don't overwrite `config.js` with a blank copy, or you'll lose your Client ID.

---

## GDPR notes

I'm not a lawyer; these are practical pointers, not legal advice.

- **Where data lives:** on each signed-in device, and in Google Drive. List both in your privacy notice and record of processing ("client contact and event details, stored in Google Workspace and on staff devices").
- **Distance lookups:** only the venue postcode is sent to postcodes.io and the OpenStreetMap route service. No names or contact details leave the app.
- **Google as processor:** in the Google Workspace Admin console, check that the **Cloud Data Processing Addendum** is accepted (usually under Account → Legal and compliance).
- **Who controls the data:** while bookings sit in GBI Mitchell's Drive for an ES business, make sure your privacy notice names the right company, and update it when ES moves to its own Limited company and Workspace.
- **Access requests:** **Data → Update Google Sheet** produces a readable spreadsheet of everything held, which makes "what do you hold on me?" requests quick to answer.
- **Erasure requests:** delete the booking in the app and sync. Drive also keeps older versions of the data file for a while (typically 30 days). To remove someone immediately, open the file in Drive → **Manage versions** and delete older versions, and re-export the Sheet.
- **Retention:** decide how long you keep details after an event (for example two years for accounts and referrals) and delete older bookings periodically.
- **Devices:** use a passcode on any phone with the app. If a phone is lost, remove its access in your Google account's security settings, and change the Workspace password.

---

## Troubleshooting

- **"Error 400: origin_mismatch" when connecting:** the app's address isn't in Authorised JavaScript origins (step 2.5). Add it exactly, with `https://` and no path.
- **"Access blocked" or "This app is restricted to users within its organisation":** you're signed in with an account outside GBI Mitchell. Choose the Workspace account.
- **Nothing happens when tapping Connect:** allow pop-ups for the site, or open the app in Safari/Chrome rather than an in-app browser.
- **The app says "Drive sync isn't switched on yet":** the Client ID isn't in `config.js`, or the phone still has the old version. Check the file on GitHub, change `VERSION` in `sw.js`, and reopen the app.

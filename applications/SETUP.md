# MSRP Application Review: Setup (one-time + each Google Form)

## 1. Roles and channel
Review channel: `1563809877359337603`
Foundership role: `1547525713853288448`
Game Staff acceptance role: `1563761372272009297`
Support Staff acceptance role: `1556203938427183105`

The bot requires View Channel, Send Messages, Attach Files, Read Message History, Manage Messages (to delete transport messages), and Manage Roles (its highest role must be above both application roles). It must also be able to mention Foundership (Mention Everyone permission or a mentionable Foundership role).

## 2. Make a Discord webhook
Create a Discord channel webhook for the **review channel** (or a separate PRIVATE staging channel). Copy the webhook URL and keep it secret. The channel must be readable by the bot. The webhook is a secure transport; the bot removes transport messages after importing submissions.

The webhook URL is like `https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_SECRET`.

## 3. Bot environment variables
Set in the bot's host environment (`.env` or hosting Variables):

```
MSRP_FORMS_WEBHOOK_ID=WEBHOOK_ID_FROM_URL
MSRP_FORMS_SECRET=A_RANDOM_SHARED_SECRET_AT_LEAST_32_CHARACTERS
MSRP_FOUNDER_IDS=FIRST_FOUNDER_DISCORD_ID,SECOND_FOUNDER_DISCORD_ID,THIRD_FOUNDER_DISCORD_ID
```

If the webhook is in a separate queue/staging channel (recommended), also set:

```
MSRP_FORMS_QUEUE_CHANNEL_ID=YOUR_STAGING_CHANNEL_ID
```

**Exactly three** different Discord IDs must be configured as founders. Each also must hold the Foundership role to approve, deny, or force approve. This prevents other people with the same role from substituting for a required founder.

Use a cryptographically generated random secret, e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` on your computer. Store the secret privately; do not commit it to GitHub.

## 4. Configure forms in Discord
Run `/form-manage manage:Add name:Game Staff link:YOUR_GOOGLE_FORM_LINK` (or Update if it already exists).
Run `/form-manage manage:Update name:Support Staff link:YOUR_SECOND_GOOGLE_FORM_LINK`.
Approval role is optional for these two existing types because their roles are preconfigured.
Future form types: use the optional Approval Role field when adding them.

The main Information Dashboard's Applications menu uses the registered form links when someone opens it.

## 5. Connect each Google Form
1. Open the form in edit mode. **Question 1 must ask for the Discord User ID**, required, not the username.
2. In the form, open **Extensions → Apps Script** (or create a script project bound to the form).
3. Paste `GoogleAppsScript.gs`.
4. In Project Settings → Script Properties, add:
   - `MSRP_DISCORD_WEBHOOK_URL`: full URL from step 2
   - `MSRP_FORMS_SECRET`: the same secret as in bot config
   - `MSRP_FORM_NAME`: `Game Staff` (for Game Staff) or `Support Staff` (for Support Staff), matching `/form-manage` exactly
5. In Apps Script Triggers, **add trigger** for `onFormSubmit`, event source **From form**, event type **On form submit**, then authorise it.
6. Repeat separately for the other form (same code, different `MSRP_FORM_NAME`).
7. Submit a test response. The bot should delete the transport webhook message and post its own Components V2 review message.

A published Google Form *link* cannot install a trigger for you. Changing only the public link of the same form does not require reinstalling the trigger. Replacing a form with a new Google Form does require setting up the trigger on the new form.

## 6. Enable the new slash command
Set `MSRP_REGISTER_COMMANDS=1` for one bot restart, then restore it to `0` and restart. This registers `/form-manage` without repeatedly replacing all commands.

## 7. Review behaviour
- Every verified bridge submission creates a single persistent application record.
- New applications ping the Foundership role.
- Each of the **three configured founders** must approve (3/3) for automatic acceptance-role assignment.
- A configured founder may Force Approve (reason required) to bypass votes.
- Denying (reason required) attempts to DM the applicant; the decision is retained even if the DM cannot be delivered.
- Buttons disable after a final decision. Repeated submissions with the same Google Form response ID are ignored.
- All applications remain stored in `applications/applications.runtime.json`; registered form links in `applications/forms.runtime.json`. Preserve these runtime files across redeployments! Ensure the host filesystem is persistent or mount a persistent data volume.

**Security note:** A Discord User ID typed into a Google Form does NOT prove the submitter owns that account. Foundership should confirm applicant identity before accepting, particularly for high-trust roles. In future, an optional DM account-verification step can enforce this automatically.

The ZIP also includes an updated `.gitignore` entry for `applications/*.runtime.json` so applications and responses are not accidentally pushed to GitHub.

**Important:** Application answers contain personal data. Restrict visibility of the review and transport channels. Keep the Discord webhook URL and shared secret private, and remove access for former reviewers.

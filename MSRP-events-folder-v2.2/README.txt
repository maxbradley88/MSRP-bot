MSRP Event Lifecycle v2.2 - Full events folder rebuild

Replace your entire existing events/ source folder with the events/ folder in this ZIP.

Included:
- events/eventSystem.js
- events/eventData.js
- events/eventIcons.js

Do NOT copy an old events.runtime.json over this folder. eventData.js will create it automatically when needed.
If you already have a live events.runtime.json you want to preserve, keep that file when replacing the source files.

Changes in v2.2:
- Keeps the fixed /event-vote required-option order.
- Adds a dedicated Waiting for session phase when the event start time arrives while MSRP is not SSU.
- Waiting card uses the requested text and keeps the event controls visible.
- Start Event is disabled in Staff Actions unless the user is the host AND MSRP is SSU.
- The host sees an explicit explanation that Start Event is locked until SSU.
- Server-side session checks prevent stale Start Event controls from bypassing the SSU rule.
- Once a session becomes SSU, the event returns to the start-ready card for the host.

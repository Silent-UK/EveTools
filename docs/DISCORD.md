# Discord integration

Configure Admin > Discord separately for each EveTools installation. Do not share credentials between installations. No separate bot process or Gateway connection is needed. Enable Server Members Intent in the Discord Developer Portal if you use the optional Sync Pilots name scan. A successful Test Connection means the REST API credentials/server permissions work; the bot can appear offline in Discord.

1. Create an application at https://discord.com/developers/applications. Copy Application ID and OAuth2 Client Secret. Create/reset the Bot Token under Bot. Keep secrets private.
2. Enable Discord Developer Mode (User Settings > Advanced), then Copy Server ID from the intended server. Enter all four values in Admin > Discord.
3. Add the exact callback shown on that page under OAuth2 > Redirects, then save it in Discord.
4. Enable the integration and save. Use the generated Invite Bot link with the bot scope. Manage Roles is needed only when role management is enabled; it can remain off while you test notifications. Enable Guild Install under Installation if required.
5. In Server Settings > Roles, move the bot above the roles Tools will manage. Do not grant it Administrator. Run Test Connection. The setup notice can then be hidden; instructions remain expandable and reappear after credential changes.
6. Under Admin > Groups, optionally paste a Discord Role ID (right-click a role > Copy Role ID). Blank means no Discord role. Mapped roles must be unmanaged, below the bot and cannot grant Administrator, Manage Server or Manage Roles.
7. Players join the Discord server themselves, then link their Discord account in Tools > Settings. OAuth requests identify only. No email, message access or auto-join scope is used.

Approved site Group membership grants the mapped role; pending/rejected membership does not. Restricted membership rechecks the same requirements as site access. Removing a mapping/group/membership removes roles managed by Tools. Shared roles stay while another approved Group requires them. The bot owns the mapped roles, including a mapped role the player already had; do not map unrelated manually maintained roles. Other roles are never changed.

The worker processes one account every 15 seconds, checking accounts again after five minutes. Large installations take longer. API errors are retained on the account and retried, and Discord rate limits are respected. Changes to site membership are checked through the ordinary whitelist. Temporary membership lookup failures do not strip roles. Deleted accounts retain a minimal Discord ID/role ledger until their managed roles are removed.

Disabling integration pauses linking and role changes; existing Discord roles remain in place. Unlinking removes managed roles first, so a working integration is required when there are outstanding roles. Application/Server IDs cannot change while accounts or tracked roles remain linked. Bot Token/Client Secret rotation is supported.

Secrets are encrypted with the site's existing encryption key and never returned through the API. Back up this key and the application database using the normal procedure. Each installation requires its own Discord settings.

# Link aliases

Admin > Links accepts either an HTTP(S) destination or a bare domain (defaults to HTTPS). An optional Short Path such as Google creates https://<this-tools-site>/Google, which redirects to the destination. It does not proxy the external page or provision another hostname. Paths are case insensitive and unique, and application paths are reserved. A blank Short Path preserves direct links. Public alias URLs can be shared without sign-in, like their external destinations.

# Users directory

Admin > Users can search mains, linked pilots, IDs, corporations and Group names. Role filters cover Owner/Admin/Member/Recruit and approved site Groups. Sort by name, last online (unknown dates last), or linked-character count in either direction. Discord Connected/Not Connected appears beneath corporation only when integration is enabled; it means a Discord identity is linked.

Check Whitelist queues a review of account login mains, four at a time. Refresh Status shows results. Individual alts are never cleanup candidates. Only confirmed denied accounts receive the whole-account cleanup action; Unknown is shown when ESI cannot verify membership. Only the site owner can execute deletion, with an explicit confirmation. The login main is rechecked immediately before wiping the account, and admins, the acting account and active recruitment applications are protected. Linked pilots, saved data, credentials and sessions are wiped together using the existing account-deletion routine; Discord role cleanup follows the existing deletion ledger. Nothing is deleted automatically.

## Corporation Den timers

With **Include Den timers** enabled, the Discord Timerboard includes reinforced
Dens belonging to accounts whose login main is verified in the site's corporation,
including those accounts' linked alts. A linked Discord account is not required to
show these shared timers. The site Timerboard uses the same corporation source
alongside the viewer's own Dens and keeps its existing structure visibility checks.
Existing personal Discord alert and owner-mention eligibility is unchanged.
Saved timers remain eligible until their normal end time/grace period even if the
pilot's latest snapshot is older than two hours. A newer Den snapshot replaces the
old data; a confirmed departure removes the account from corporation sharing.

## Structure Anchoring notifications

In **Admin > Discord > Notifications**, enable **Structure Anchoring** and set its
Channel ID. This is independent of Structure Attacked, Structure Reinforced and
the Discord Timerboard. It is off by default. Alerts use saved corporation
anchoring timers (moon drill notifications/calendar data and structure snapshots
for citadels) and show the structure, location, icon and expected completion time
with a Discord countdown. Notification-derived estimates are labelled Estimated.
Only future, non-manual timers are sent; destroyed structures are excluded. Each
structure/completion pair is sent once per destination channel, with failed sends
retried by the normal publisher. No new ESI scopes or Discord role management are
required.

## Moon readiness and fracture

**Admin > Discord > Notifications** has two independent options, off by default:
**Moon Ready to Fracture** and **Moon Fractured**. Each accepts its own Channel ID.
The former uses `MoonminingExtractionFinished`; the latter uses
`MoonminingLaserFired` and `MoonminingAutomaticFracture` and labels the cause.
These are observed in-game notifications, not predictions from extraction dates.
They reuse the verified corporation director notification sync and require its
existing notification access. No new polling schedule or scope is added.

Events are retained for six hours across director polls. Only structures present
in the corporation snapshot are published, excluding destroyed structures. Later
fracture evidence suppresses obsolete readiness notices. Delivery is deduplicated
per structure, event phase, event time and destination, and failures are retried.
The settings use three desktop columns, two on smaller screens and one on mobile.

CCP/ESI notification identifiers: https://github.com/esi/eve-glue/blob/master/eve_glue/notification_type.py

## Grouped settings and corporation joiners

Notification options are grouped into six rows in this order: Dens, Structures,
Moons, Pilots, Groups, Fuel. Each row retains the three-column desktop layout
and adapts to two/one columns at narrower widths. Group actions are ordered
Join, Leave, Request. Existing toggle values and Channel IDs are preserved.

**Pilot joined corporation** is independent from **Pilot left corporation**, with
its own toggle and channel. Both compare the corporation member roster, covering
in-game membership changes even for pilots without a Tools account. A first check
after enabling/changing channel quietly records the current roster. Newer observed
rosters then identify joins/departures; failed or older responses never invent a
change. Each option checks at most every five minutes, shares a roster read with
the other when due together, and follows ESI caching. Successful sends are
remembered, while failed sends remain queued for retry. No new scopes are added.

## Structure Destroyed

The first notification row is Den reinforced, Den under attack, Structure Destroyed.
The new option is off by default and has its own Channel ID. It covers confirmed
corporation structures and Mercenary Dens belonging to corporation members,
without requiring a linked Discord account. Existing scope and settings remain.

The existing corporation/pilot notification sync captures structure destruction,
skyhook and matching sovereignty destruction notices. Structure-class victim loss
reports cover additional losses, including POS and customs offices; ordinary ship
reports are excluded. Public killmail details supply location and corporation
verification when available. Personal Den reports are owner checked, and stale,
future and unrelated-corporation evidence is rejected.

Confirmed losses are retained for twelve hours independently of the current
structure/Den inventory. Delivery retries use stable event keys to avoid duplicate
posts. Den location history also keeps a two-hour notification watch after the
last Den disappears; the watch does not renew indefinitely for an empty list.
No destruction is inferred merely because a structure/Den is missing or moved.
This uses the existing notifications scope and polling cache; no new SSO scope is
required. In-game notification availability and ESI sync/cache timing still apply.

## Tower under attack

Enable **Tower under attack** and its Channel ID after **Moon Fractured** in Admin > Discord > Notifications. It is independent of Structure Attacked and off by default. POS attacks use the dedicated destination; existing citadel and other structure attacks retain their existing setting.

The corporation notification sync now accepts native `TowerAlertMsg` data identified by moon, solar system and tower type, without requiring a structure ID that may not be present. Matching POS snapshots and public universe lookups provide names where available. A single compact embed shows the tower icon/type, moon/system, reported time and available shield/armour/hull percentages; missing health values remain unknown.

Saved attacks are retained for twelve hours; only notices from the last hour are eligible for Discord delivery. Duplicate director observations and successful sends are deduplicated, failed sends retry, known destroyed towers and future notices are skipped, and no role or mass mentions are sent. Existing settings and notification scopes are preserved.

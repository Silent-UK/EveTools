# Installation and Dashboard administration

## Installation Setup

Admins can view **Admin -> Installation Setup**. Only the installation owner can save identity settings or create starter groups. The owner remains `OWNER_CHARACTER_ID` in the private environment; this page never transfers ownership or displays secrets.

For a fresh public installation, set `SITE_NAME`, `CORPORATION_ID`, `CORPORATION_NAME`, `CORPORATION_TICKER` and optionally `ALLIANCE_TICKER` in the server environment before first startup, alongside the existing EVE client, encryption key, base URL and owner settings. These identity defaults are persisted on first start. Fresh installations allow their configured corporation only; extra organisations must be added deliberately.

The setup page shows the callback URL, required normal-login scopes, and readiness of the owner account, EVE configuration, corporation authorisation and saved corporation data. Use its links to connect corporation access, configure allowed organisations, choose plugins and set group permissions. Projects still uses its separate optional scope/connection. The checklist checks configured state; a successful live connection is established through the existing EVE authorisation flow.

Site name and logo come from installation settings. Changing the corporation ID on an unconnected installation requires a service restart before using the new corporation. Once corporation authorisations, connections or snapshots exist, corporation identity is locked. Use an independent database/installation for a different corporation. This is a single-corporation deployment, not a multi-tenant hosting service.

**Create starter groups** adds Members (open) and Leadership (approval) if their names do not already exist. It does not change existing groups, enrol members or grant privileged pages. Configure the intended permissions in Group Setup.

## Needs your action

Dashboard collects relevant reconnection issues, SRP/Buyback balances and review/payment queues, Logistics quotes/requests, pending group requests and recruitment applications. It honours plugin availability, the user's reviewer rights and page preferences. Personal tasks belong to the signed-in account; staff queues appear as corporation tasks. Completed/in-progress updates remain in the existing plugin sections.

The new sections can be hidden in Settings -> Dashboard, and use the existing remembered collapse behaviour. Announcements appear first, followed by attacks and reinforcement alerts, then the action list. Open Dashboards refresh their sections every two minutes while visible, preserving the current scroll position. Other workspace checks keep their existing interval.

## Announcements

Admins publish a title, plain-text message, expiry (EVE time/UTC), and an audience: all members, or approved members of a selected group. Group requests do not grant visibility. Deleting a group leaves its notices hidden, never public. Expired notices stop appearing on Dashboard.

**Mark as read** hides a notice for that account only. Admin deletion removes it for everyone. Recruit accounts cannot access member announcements; inspection cannot publish, delete or mark notices as read. Use Corporation Management -> Announcements to edit or delete current notices. Editing a title, message or audience makes the notice unread again; changing only its expiry preserves read status.

## Audit Log

Admins can search and page through successful API mutations recorded since this release. Entries contain the actor, UTC timestamp, an action label and target route, plus a small allowlist of status/amount/identifier fields where supplied. Request bodies, message content, tokens, secrets, query strings and arbitrary errors are not recorded. Failed requests and inspection writes are not logged as successful actions.

This is an application activity log, not a reconstruction of older activity or a tamper-proof external logging service. Background ESI reconciliation is not represented as a human API change. Audit records survive account removal because they do not reference users through a cascading foreign key. The API has no edit/delete operation for audit entries.
